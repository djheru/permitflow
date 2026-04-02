# PermitFlow — Design Spec

## Overview

Fork the `durable-lambda` loan demo into a standalone product: **PermitFlow**, a building permit application tracker for general contractors and builders. Same architecture (AWS Lambda Durable Functions, CDK, React TypeScript, blue/green deployment), new domain.

**Source repo:** `durable-lambda` (loan approval demo)
**Target repo:** `permitflow` (new standalone repository)
**Approach:** Surgical reskin — copy repo, replace domain-specific files, keep infrastructure and generic utilities unchanged.

## Product Context

**Target user:** General contractors and builders (5-50 person firms)
**Problem:** Tracking building permit applications across multiple agencies (building dept, fire dept, zoning board) is done via email and spreadsheets. Steps get dropped, follow-ups are missed, and every delayed permit costs $500-2000+/day in crew idle time.
**Solution:** Real-time permit application tracker with automated agency submission simulation, plan review approval gates, and site inspection callbacks.

## Architecture

Identical to the loan demo:
- **Backend:** TypeScript Lambda functions with Durable Execution SDK, DynamoDB progress table, HTTP API Gateway
- **Frontend:** React 19 + Vite + TypeScript SPA
- **Infrastructure:** CDK v2 with BackendStack, FrontendStack, BackendPipelineStack (CDK Pipelines), FrontendPipelineStack (blue/green CodePipeline)
- **Deployment:** Blue/green SPA deployment via Lambda@Edge + S3 dual buckets

## Workflow Steps

9-step progression (same count as loan demo):

| Step | Name | Description | Durable Pattern |
|------|------|-------------|----------------|
| 1 | Filed | Application received and queued | Initial state |
| 2 | Validating | Validate project details, address, scope | `context.step` |
| 3 | Agency Review | Submit to 3 agencies in parallel | `context.map` over agencies |
| 4 | Review Consolidation | Aggregate agency responses, determine overall status | `context.step` |
| 5 | Plan Review | Human approval gate for new construction / commercial | `context.waitForCallback` (conditional) |
| 6 | Site Inspection | External inspector completes site visit | `context.waitForCallback` (async Lambda) |
| 7 | Generating Permit | Create permit document with conditions | `context.step` |
| 8 | Issuing | Finalize and record permit | `context.step` |
| 9 | Complete | Terminal state | Return result |

### Step-to-Step Mapping from Loan Demo

| Loan Demo Step | PermitFlow Step | What Changes |
|---------------|-----------------|-------------|
| Validate Application | Validate Permit Application | Different fields (project type, address, cost vs. name, SIN, amount) |
| Pull Credit Reports (3 bureaus) | Submit to Agencies (3 agencies) | Replace credit bureaus with agencies. Same `context.map()` pattern. |
| Calculate Risk Score | Consolidate Reviews | Aggregate agency approvals instead of credit scores |
| Manager Approval (≥ $100K) | Plan Review (new construction / commercial) | Same `waitForCallback`. Triggered by project type instead of dollar threshold. Adds "Request Revision" as third action. |
| Fraud Check (external callback) | Site Inspection (external callback) | Same async Lambda + callback pattern |
| Generate Loan Offer | Generate Permit | Replace offer details with permit number, conditions, expiry |
| Disburse Funds | Issue Permit | Replace disbursement ref with permit issuance record |

## Domain Types

### PermitApplication (replaces LoanApplication)

```typescript
export type ProjectType =
  | 'residential_remodel'
  | 'residential_new_construction'
  | 'commercial_renovation'
  | 'commercial_new_construction'
  | 'commercial_addition';

export interface PermitApplication {
  readonly projectType: ProjectType;
  readonly projectAddress: string;
  readonly projectDescription: string;
  readonly estimatedCost: number;
  readonly applicantName: string;
  readonly applicantPhone: string;
  readonly applicantEmail: string;
}
```

### ApplicationStatus (UNCHANGED)

```typescript
export type ApplicationStatus =
  | 'submitted'
  | 'processing'
  | 'pending_approval'
  | 'approved'
  | 'denied'
  | 'failed';
```

### WorkflowStep (renamed values)

```typescript
export type WorkflowStep =
  | 'submitted'
  | 'validating'
  | 'agency_review'
  | 'review_consolidation'
  | 'plan_review'
  | 'site_inspection'
  | 'generating_permit'
  | 'issuing'
  | 'complete';
```

### Agency Types (replace Credit Bureau types)

```typescript
export type Agency = 'building_dept' | 'fire_dept' | 'zoning_board';

export type AgencyDecision = 'approved' | 'conditional' | 'denied';

export interface AgencyReview {
  readonly agency: Agency;
  readonly decision: AgencyDecision;
  readonly conditions: string[];
  readonly reviewId: string;
  readonly reviewerName: string;
}

export interface ReviewConsolidation {
  readonly overallDecision: AgencyDecision;
  readonly approvedCount: number;
  readonly conditionalCount: number;
  readonly deniedCount: number;
  readonly allConditions: string[];
  readonly reviews: AgencyReview[];
}
```

### Permit Types (replace Loan Offer / Result types)

```typescript
export interface PermitDocument {
  readonly permitNumber: string;
  readonly issuedDate: string;
  readonly expiryDate: string;
  readonly conditions: string[];
  readonly inspectionRequired: boolean;
}

export interface PermitResult {
  readonly application_id: string;
  readonly applicant_name: string;
  readonly status: 'approved' | 'denied';
  readonly denial_reason?: string;
  readonly permit_number?: string;
  readonly issued_date?: string;
  readonly expiry_date?: string;
  readonly conditions?: string[];
  readonly project_address?: string;
  readonly project_type?: string;
}
```

### Callback Types

```typescript
export interface PlanReviewPayload {
  readonly approved: boolean;
  readonly revisionRequired?: boolean;
  readonly conditions?: string[];
  readonly reason?: string;
}

export interface InspectionEvent {
  readonly callbackId: string;
  readonly applicationId: string;
  readonly projectAddress: string;
}

export interface InspectionResult {
  readonly inspectionPassed: boolean;
  readonly findings: string[];
  readonly inspectorId: string;
}
```

### ValidatedApplication

```typescript
export interface ValidatedApplication {
  readonly applicationId: string;
  readonly projectType: ProjectType;
  readonly projectAddress: string;
  readonly projectDescription: string;
  readonly estimatedCost: number;
  readonly applicantName: string;
  readonly applicantPhone: string;
  readonly applicantEmail: string;
  readonly requiresPlanReview: boolean;
}
```

### DynamoDB Item Schema

Same structure as loan demo — only field names in the `result` object change:

```typescript
interface PermitProgressItem {
  application_id: string;          // PK - "PERMIT-{timestamp}-{random}"
  status: ApplicationStatus;       // Same 6 states
  current_step: WorkflowStep;     // New 9 step values
  applicant_name: string;
  project_type: string;
  project_address: string;
  estimated_cost: number;
  callback_id?: string;
  logs: ProgressLogEntry[];        // Same structure
  result?: PermitResult;
  created_at: string;
  updated_at: string;
}
```

## Demo Profiles

| Profile | Project Type | Address | Est. Cost | Outcome |
|---------|-------------|---------|-----------|---------|
| Kitchen Remodel | residential_remodel | 742 Evergreen Terrace, Springfield | $45,000 | Auto-approved, no plan review |
| New Home Build | residential_new_construction | 1600 Pennsylvania Ave, Washington DC | $350,000 | Approved with plan review + inspection |
| Commercial Expansion | commercial_addition | 100 Main St (Residential Zone), Anytown | $200,000 | Denied — zoning violation |

### Scenario Logic

Based on `projectType`:
- `residential_remodel`: All agencies approve. No plan review. Inspection passes. → Approved
- `residential_new_construction`: All agencies approve. Requires plan review (triggers callback). Inspection passes. → Approved
- `commercial_addition`: Zoning board denies (residential zone). → Denied at review consolidation

## Agency Simulation (replaces credit score simulation)

Each agency returns a simulated review with realistic delays:

| Agency | Delay | Kitchen Remodel | New Home Build | Commercial Expansion |
|--------|-------|----------------|----------------|---------------------|
| Building Dept | 2s | Approved | Approved, conditions: ["Structural engineer review"] | Approved |
| Fire Dept | 3s | Approved | Approved, conditions: ["Smoke detectors per code"] | Approved |
| Zoning Board | 4s | Approved | Approved | **Denied**: "Commercial use not permitted in residential zone" |

## Plan Review Gate

Triggered when `projectType` is `residential_new_construction`, `commercial_new_construction`, or `commercial_addition` (but for `commercial_addition` the workflow is already denied before reaching this step).

The plan review modal offers 3 actions (vs. 2 in loan demo):
- **Approve Plans** → `{ approved: true }`
- **Request Revision** → `{ approved: false, revisionRequired: true, reason: "..." }`
- **Deny** → `{ approved: false, reason: "..." }`

Timeout: 30 minutes (intentionally shorter than the loan demo's 24-hour timeout — plan reviews happen in real-time during demos, and a shorter timeout creates a better demo experience). On timeout: workflow fails with "Plan review timed out".

### Revision Flow

When "Request Revision" is selected (`{ approved: false, revisionRequired: true, reason: "..." }`), the workflow treats it as a **denial with a distinct reason**. The result status is `'denied'` with `denial_reason` set to `"Revision requested: {reason}"`. In a production version, this would loop back to an earlier step for resubmission, but for the demo/MVP, revision = denial with a specific reason is sufficient. The frontend displays revision requests differently from outright denials (amber styling vs. red) so the user understands the distinction.

## Site Inspection (replaces Fraud Check)

Same async Lambda + callback pattern:
1. Workflow calls `waitForCallback`
2. Submitter async invokes SiteInspectionFunction with `{ callbackId, applicationId, projectAddress }`
3. SiteInspectionFunction simulates 5s inspection
4. Returns `{ inspectionPassed: true/false, findings: [...], inspectorId: "INS-xxx" }`
5. Sends `SendDurableExecutionCallbackSuccessCommand` to resume workflow

All demo scenarios pass inspection.

## Frontend Changes

### Form Fields

| Loan Demo | PermitFlow |
|-----------|-----------|
| Full Name | Applicant Name |
| Address | Project Address |
| Phone | Phone |
| SIN (last 4) | Applicant Email |
| Loan Amount | Estimated Project Cost |
| — | Project Type (dropdown) |
| — | Project Description (textarea) |

### Result Display

**Approved:** Permit number, issued date, expiry date, conditions list, project address
**Denied:** Denial reason, which agency denied, project details

### Approval Modal

Three buttons instead of two:
- Approve Plans (green)
- Request Revision (amber)
- Deny (red)

Shows project summary (type, address, cost) in the modal body.

### Branding

- Title: "PermitFlow" with subtitle "Building Permit Tracker"
- Primary color: #2563eb (blue)
- Demo profiles use color-coded borders (green/blue/red for outcome hints)

## File Change Map

### Files Copied Unchanged (19 files)

**Note:** `progress-logger.ts` imports `ApplicationStatus`, `LogLevel`, and `WorkflowStep` from `../types`. It works unchanged because the replacement `types.ts` exports the same type names — only the values within `WorkflowStep` change, and `progress-logger` accepts them as string parameters without referencing specific values.

```
backend/jest.config.ts
backend/tsconfig.json
backend/src/shared/progress-logger.ts
frontend/tsconfig.json
frontend/tsconfig.node.json
frontend/vite.config.ts
frontend/src/main.tsx
frontend/src/vite-env.d.ts
infra/tsconfig.json
infra/cdk.json
infra/lib/backend/backend-stage.ts
infra/lib/backend-pipeline-stack.ts
infra/lib/frontend/frontend-stack.ts
infra/lib/frontend-pipeline-stack.ts
infra/src/edge-handlers/viewer-request.ts
infra/src/edge-handlers/origin-request.ts
tsconfig.base.json
.gitignore
backend/package.json                               (name field changes but scripts and deps are the same — decide at implementation whether to rename)
```

### Files Replaced (16 files — new domain logic)

```
backend/src/types.ts                              → Permit types
backend/src/permit-workflow/handler.ts             → Durable permit workflow
backend/src/permit-workflow/steps/validate-application.ts
backend/src/permit-workflow/steps/submit-to-agency.ts
backend/src/permit-workflow/steps/consolidate-reviews.ts
backend/src/permit-workflow/steps/generate-permit.ts
backend/src/permit-workflow/steps/issue-permit.ts
backend/src/site-inspection/handler.ts             → External callback Lambda
backend/src/api/handler.ts                         → Same structure, different routes
backend/src/api/routes/apply.ts                    → New input fields
backend/src/api/routes/status.ts                   → One-line import change (type name)
backend/src/api/routes/approve.ts                  → Add revision option
frontend/src/types.ts                              → Permit types + demo profiles + ApplicationState
frontend/src/App.tsx                               → New form, step labels, results
frontend/src/App.css                               → PermitFlow branding
frontend/index.html                                → Title change
```

### Files With Moderate Edits (5 files)

```
package.json                                       → name: "permitflow"
.env.example                                       → SERVICE_NAME=permitflow, DOMAIN_NAME=permitflow.cypherchat.io
backend/src/config/index.ts                        → serviceName: 'permitflow', metricsNamespace: 'PermitFlow', rename fraudCheckFunctionName → siteInspectionFunctionName, rename env var FRAUD_CHECK_FUNCTION_NAME → SITE_INSPECTION_FUNCTION_NAME
infra/bin/app.ts                                   → serviceName = 'permitflow'
infra/lib/backend/backend-stack.ts                 → Rename construct IDs (LoanWorkflowFunction → PermitWorkflowFunction, FraudCheckFunction → SiteInspectionFunction, LoanApiFunction → PermitApiFunction), change entry paths (loan-workflow → permit-workflow, fraud-check → site-inspection), rename env vars (FRAUD_CHECK_FUNCTION_NAME → SITE_INSPECTION_FUNCTION_NAME), update POWERTOOLS_SERVICE_NAME values, update POWERTOOLS_METRICS_NAMESPACE to 'PermitFlow', rename log group names, rename SSM parameter path
```

### Test Files (replaced with permit-specific tests)

```
backend/tests/permit-workflow/handler.test.ts
backend/tests/permit-workflow/steps/validate-application.test.ts
backend/tests/permit-workflow/steps/submit-to-agency.test.ts
backend/tests/permit-workflow/steps/consolidate-reviews.test.ts
backend/tests/permit-workflow/steps/generate-permit.test.ts
backend/tests/permit-workflow/steps/issue-permit.test.ts
backend/tests/site-inspection/handler.test.ts
backend/tests/api/handler.test.ts
backend/tests/shared/progress-logger.test.ts        → Minor edit: change 'credit_check' to 'agency_review' on line 37
```

### Frontend Types (ApplicationState for PermitFlow)

The frontend `types.ts` must include the `ApplicationState` interface for PermitFlow:

```typescript
export interface ApplicationState {
  application_id: string;
  status: ApplicationStatus;
  current_step: WorkflowStep;
  applicant_name: string;
  project_type: string;
  project_address: string;
  estimated_cost: number;
  callback_id?: string;
  logs: ProgressLogEntry[];
  result?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}
```

### Scenario Determinism

Demo scenario branching is driven by `projectType` enum values (replacing the loan demo's SIN-based matching). The logic lives in two places:
- `submit-to-agency.ts` — each agency's response varies based on `projectType` (e.g., zoning board denies `commercial_addition`)
- `consolidate-reviews.ts` — aggregates agency decisions and applies overrides (e.g., any denial → overall denied)

## Infrastructure

### CDK Resource Naming

| Resource | Name |
|----------|------|
| DynamoDB Table | `permitflow-{stage}-progress` |
| Workflow Lambda | `permitflow-{stage}-workflow` |
| API Lambda | `permitflow-{stage}-api` |
| Inspection Lambda | `permitflow-{stage}-site-inspection` |
| HTTP API | `permitflow-{stage}` |
| SSM Parameter | `/permitflow/{stage}/api-url` |
| Pipeline (backend) | `permitflow-backend` |
| Pipeline (frontend) | `permitflow-frontend` |

### Domain Configuration

| Env Var | Value |
|---------|-------|
| SERVICE_NAME | permitflow |
| DOMAIN_NAME | permitflow.cypherchat.io (or configure separately) |
| HOSTED_ZONE_NAME | cypherchat.io |

## Dependencies

Same as loan demo. No new packages required.

## API Routes

Same 3 routes, same patterns:

| Route | Behavior |
|-------|----------|
| POST /apply | Validate body (projectType, projectAddress, estimatedCost, applicantName required), generate `PERMIT-{timestamp}-{random}` ID, create DDB item, async invoke workflow, return 201 |
| GET /status/{applicationId} | Read DDB item, return full progress |
| POST /approve/{applicationId} | Read callbackId, send callback (now supports 3 actions: approve, revision, deny), clear callbackId |

## Observability

Same Powertools integration (Logger, Tracer, Metrics):
- Metrics namespace: `PermitFlow`
- Metric names: `ApplicationsSubmitted`, `ApprovalsProcessed`
- Service names: `permit-workflow`, `permit-api`, `site-inspection`
