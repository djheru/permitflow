# PermitFlow

A building permit application tracker for general contractors and builders — submit applications, track agency reviews, and manage approvals from a single dashboard.

## What it does

PermitFlow gives GCs and builders a real-time view into the permit lifecycle. Submit an application, track its progress through building department, fire department, and zoning board reviews, respond to plan review requests, and receive your issued permit — all without calling city hall.

The workflow engine handles the complexity: parallel agency submissions, plan review callbacks for new construction and commercial projects, site inspection coordination, and automatic permit generation once all approvals are in hand.

## Architecture overview

PermitFlow is built on AWS durable execution — each permit application runs as a long-lived, resumable workflow that survives Lambda restarts and handles multi-day review cycles reliably.

```
                    ┌─────────────┐
   POST /apply ───► │ API Lambda  │ ◄── GET /status/{id}
                    └──────┬──────┘     POST /approve/{id}
                           │ invoke
                    ┌──────▼──────────────────────┐
                    │   Permit Workflow Lambda      │
                    │  (Durable Execution)          │
                    │                              │
                    │  1. Filed                    │
                    │  2. Validating               │
                    │  3. Agency Review ──────────►│─── Building Dept
                    │     (parallel)               │─── Fire Dept
                    │                              │─── Zoning Board
                    │  4. Consolidation            │
                    │  5. Plan Review (callback) ◄─┼── Human approval
                    │  6. Site Inspection (callback)◄── Inspector result
                    │  7. Generating Permit        │
                    │  8. Issuing                  │
                    │  9. Complete                 │
                    └──────────────────────────────┘
                           │
                    ┌──────▼──────┐
                    │  DynamoDB   │  (progress checkpoints)
                    └─────────────┘

   Site Inspection ──► SiteInspection Lambda (async callback)
```

## Project structure

```
permitflow/
├── backend/
│   ├── src/
│   │   ├── api/
│   │   │   ├── handler.ts                  # HTTP API entry point
│   │   │   └── routes/
│   │   │       ├── apply.ts
│   │   │       ├── approve.ts
│   │   │       └── status.ts
│   │   ├── permit-workflow/
│   │   │   ├── handler.ts                  # Durable workflow entry point
│   │   │   └── steps/
│   │   │       ├── validate-application.ts
│   │   │       ├── submit-to-agency.ts
│   │   │       ├── consolidate-reviews.ts
│   │   │       ├── generate-permit.ts
│   │   │       └── issue-permit.ts
│   │   ├── site-inspection/
│   │   │   └── handler.ts                  # Async inspection callback
│   │   ├── shared/
│   │   │   └── progress-logger.ts
│   │   ├── config/
│   │   │   └── index.ts
│   │   └── types.ts
│   └── tests/
│       ├── api/
│       ├── permit-workflow/
│       │   ├── handler.test.ts
│       │   └── steps/
│       └── site-inspection/
├── frontend/
│   └── src/
│       ├── App.tsx
│       ├── main.tsx
│       └── types.ts
└── infra/
    ├── bin/
    │   └── app.ts
    └── lib/
        ├── backend/
        │   ├── backend-stack.ts
        │   └── backend-stage.ts
        ├── backend-pipeline-stack.ts
        ├── frontend/
        │   └── frontend-stack.ts
        └── frontend-pipeline-stack.ts
```

## Prerequisites

- **Node.js 22+** and npm
- **AWS CLI** configured with credentials for your target account
- **CDK CLI**: `npm install -g aws-cdk`
- **AWS CodeStar connection** (GitHub) — for pipeline source
- **Route 53 hosted zone** for your domain (e.g., `permitflow.cypherchat.io`)

## Getting started

```bash
# Clone the repository
git clone <repo-url>
cd permitflow

# Install all workspace dependencies
npm install

# Copy environment configuration
cp .env.example .env
# Edit .env and fill in your AWS account, region, domain, and CodeStar connection ARN
```

## Local development

**Frontend dev server**

```bash
cd frontend
npm run dev
# Runs at http://localhost:5173
```

**Backend type checking and linting**

```bash
npm run type-check
npm run lint
```

**Run tests**

```bash
npm run test
# Runs 37 tests across 9 suites with coverage
```

## Deployment

Bootstrap CDK (once per account/region):

```bash
cd infra
cdk bootstrap aws://<ACCOUNT_ID>/<REGION>
```

Deploy in order:

```bash
# 1. Backend infrastructure + API
cdk deploy BackendStack

# 2. Frontend infrastructure (CloudFront, S3, Route 53)
cdk deploy FrontendStack

# 3. Backend CI/CD pipeline (self-mutating, includes dev + prod stages with manual approval gate)
cdk deploy BackendPipelineStack

# 4. Frontend CI/CD pipeline (blue/green SPA deployment)
cdk deploy FrontendPipelineStack

# Or deploy everything at once
cdk deploy --all
```

## Testing

```bash
npm run test
```

**37 tests across 9 suites** covering:

- Permit workflow handler (durable execution lifecycle: checkpoint, replay, suspend, resume)
- Individual workflow steps: validation, agency submission, review consolidation, permit generation, permit issuance
- API routes: apply, status, approve
- Site inspection callback handler

## Demo scenarios

Three pre-built application profiles demonstrate the full range of permit outcomes.

### Kitchen Remodel (residential_remodel — $45K)
- All three agencies auto-approve
- No plan review required (residential renovation scope)
- Proceeds directly to site inspection, then permit issuance
- **Demonstrates:** happy path, parallel agency review, fast-track residential workflow

### New Home Build (residential_new_construction — $350K)
- All agencies approve
- Plan review is triggered (new construction requires engineer sign-off)
- Callback accepts "Approve Plans" action before continuing
- **Demonstrates:** human-in-the-loop plan review gate, callback resume pattern

### Commercial Expansion (commercial_addition — $200K)
- Zoning Board returns a **denied** decision (zoning violation)
- Workflow consolidates results, detects denial, halts before permit generation
- **Demonstrates:** multi-agency conflict resolution, denial handling, conditional branch logic

## How the permit workflow works

PermitFlow uses the AWS durable execution SDK to run each permit application as a stateful, resumable process:

1. **Checkpoint** — After each workflow step completes (validation, agency reviews, etc.), progress is persisted to DynamoDB. If the Lambda function restarts mid-workflow, it resumes from the last checkpoint rather than starting over.

2. **Replay** — On resume, the SDK replays completed steps using stored results — no re-executing work that already happened, no duplicate agency submissions.

3. **Suspend** — When human input is needed (plan review approval, site inspection result), the workflow suspends. The Lambda exits cleanly. DynamoDB holds the suspended state.

4. **Resume** — A callback (via `POST /approve/{id}`) delivers the human decision. The workflow resumes from the suspension point, incorporating the reviewer's action (approve/revise/deny), and continues to completion.

This makes the workflow correct by construction across multi-day review cycles — no polling loops, no orphaned state, no lost progress on cold starts.

## Tech stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 22, TypeScript 5 |
| Workflow engine | `@aws/durable-execution-sdk-js` |
| Compute | AWS Lambda |
| API | HTTP API Gateway (v2) |
| Database | DynamoDB (pay-per-request) |
| Observability | AWS Lambda Powertools (Logger, Tracer, Metrics) |
| Frontend | React 19, Vite, TypeScript |
| Infrastructure | AWS CDK v2 |
| Frontend hosting | S3 + CloudFront + Lambda@Edge + Route 53 + ACM |
| CI/CD | CDK Pipelines (backend), CodePipeline blue/green (frontend) |
| Testing | Jest, aws-sdk-client-mock |

## Based on

This project is forked from [durable-lambda](https://github.com/aws-samples/durable-lambda), a loan approval workflow demo built with the AWS durable execution SDK for JavaScript. The permit domain replaces the loan domain while preserving the same architectural patterns.

The original Python reference implementation for durable execution patterns is available in the [AWS durable execution documentation](https://docs.aws.amazon.com/lambda/latest/dg/durable-execution.html).
