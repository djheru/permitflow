# PermitFlow Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fork the durable-lambda loan demo into PermitFlow, a building permit application tracker for general contractors, by surgically replacing domain-specific files while keeping infrastructure unchanged.

**Architecture:** Copy the entire durable-lambda repo into a new `permitflow` directory, delete loan-specific domain files, then create permit-specific replacements. Same tech stack, same CDK stacks, same blue/green pipeline — only business logic and UI content change.

**Tech Stack:** TypeScript 5+, AWS CDK v2, Lambda Durable Functions SDK (`@aws/durable-execution-sdk-js`), Lambda Powertools, DynamoDB, HTTP API Gateway, CloudFront, Lambda@Edge, React 19, Vite

**Spec:** `docs/superpowers/specs/2026-04-02-permitflow-design.md` (in the durable-lambda repo)

---

## Chunk 1: Fork & Rename

### Task 1: Create the new repo and strip loan-specific files

**Files:**
- Create: `/Users/pdamra/Workspace/permitflow/` (new repo)
- Delete: loan-specific source and test files
- Modify: naming and config files

- [ ] **Step 1: Copy the repo**

```bash
cp -r /Users/pdamra/Workspace/durable-lambda /Users/pdamra/Workspace/permitflow
cd /Users/pdamra/Workspace/permitflow
rm -rf .git
git init
```

- [ ] **Step 2: Delete loan-specific domain files**

```bash
rm -rf backend/src/loan-workflow/
rm -rf backend/src/fraud-check/
rm -rf backend/tests/loan-workflow/
rm -rf backend/tests/fraud-check/
rm -rf backend/tests/api/
rm backend/src/types.ts
rm backend/src/api/routes/apply.ts
rm backend/src/api/routes/approve.ts
rm backend/src/api/handler.ts
rm frontend/src/types.ts
rm frontend/src/App.tsx
rm frontend/src/App.css
rm -rf docs/superpowers/specs/2026-04-01-*
rm -rf docs/superpowers/plans/2026-04-01-*
```

Keep: `backend/src/api/routes/status.ts`, `backend/src/shared/`, `backend/src/config/`, all infra files, all frontend config files.

- [ ] **Step 3: Update root package.json**

Change `name` from `"durable-lambda"` to `"permitflow"`.

- [ ] **Step 4: Update .env.example**

```
# AWS
CDK_DEFAULT_ACCOUNT=123456789012
CDK_DEFAULT_REGION=us-east-1

# GitHub (CodeStar)
CODESTAR_CONNECTION_ARN=arn:aws:codestar-connections:us-east-1:123456789012:connection/xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
GITHUB_OWNER=your-github-username
GITHUB_REPO=permitflow
GITHUB_BRANCH=main

# Domain
DOMAIN_NAME=permitflow.cypherchat.io
HOSTED_ZONE_NAME=cypherchat.io

# Slack (optional)
SLACK_WORKSPACE_ID=T123ABC456
SLACK_CHANNEL_ID=C123ABC456

# Service
SERVICE_NAME=permitflow
```

- [ ] **Step 5: Update backend/src/config/index.ts**

```typescript
export const config = {
  progressTableName: process.env.PROGRESS_TABLE_NAME ?? '',
  siteInspectionFunctionName: process.env.SITE_INSPECTION_FUNCTION_NAME ?? '',
  workflowFunctionName: process.env.WORKFLOW_FUNCTION_NAME ?? '',
  serviceName: 'permitflow',
  metricsNamespace: 'PermitFlow',
} as const;
```

- [ ] **Step 6: Update frontend/index.html title**

Change `<title>` to `Loan Approval Demo — Lambda Durable Functions` → `PermitFlow — Building Permit Tracker`

- [ ] **Step 7: Update infra/bin/app.ts defaults**

Change default `serviceName` from `'loan-demo'` to `'permitflow'`, default `domainName` from `'workflow.cypherchat.io'` to `'permitflow.cypherchat.io'`, and default `githubRepo` from `'durable-lambda'` to `'permitflow'`.

- [ ] **Step 8: Install dependencies and verify structure**

```bash
npm install
```

Expected: installs successfully (same deps, just renamed).

- [ ] **Step 9: Initial commit**

```bash
git add -A
git commit -m "feat: fork durable-lambda into permitflow with loan-specific files removed"
```

---

## Chunk 2: Backend Types & Config

### Task 2: Create permit-specific types

**Files:**
- Create: `backend/src/types.ts`

- [ ] **Step 1: Create backend/src/types.ts**

```typescript
// --- Project Types ---

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

// --- Status Types (unchanged from loan demo) ---

export type ApplicationStatus =
  | 'submitted'
  | 'processing'
  | 'pending_approval'
  | 'approved'
  | 'denied'
  | 'failed';

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

export type LogLevel = 'info' | 'warn' | 'error' | 'replay';

export interface ProgressLogEntry {
  readonly timestamp: string;
  readonly step: string;
  readonly message: string;
  readonly level: LogLevel;
}

export interface PermitProgressItem {
  readonly application_id: string;
  readonly status: ApplicationStatus;
  readonly current_step: WorkflowStep;
  readonly applicant_name: string;
  readonly project_type: string;
  readonly project_address: string;
  readonly estimated_cost: number;
  readonly callback_id?: string;
  readonly logs: ProgressLogEntry[];
  readonly result?: PermitResult;
  readonly created_at: string;
  readonly updated_at: string;
}

// --- Agency Types ---

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

// --- Validation Types ---

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

// --- Permit Types ---

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

// --- Callback Types ---

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

- [ ] **Step 2: Verify types compile**

Run: `cd backend && npx tsc --noEmit src/types.ts`
Expected: No errors.

- [ ] **Step 3: Fix progress-logger test**

Edit `backend/tests/shared/progress-logger.test.ts` line 37: change `'credit_check'` to `'agency_review'`.

- [ ] **Step 4: Run progress-logger tests**

Run: `cd backend && npx jest tests/shared/progress-logger.test.ts --no-coverage`
Expected: 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/types.ts backend/tests/shared/progress-logger.test.ts
git commit -m "feat: add permit-specific domain types"
```

---

## Chunk 3: Workflow Step Functions

### Task 3: Implement validate-application step

**Files:**
- Create: `backend/src/permit-workflow/steps/validate-application.ts`
- Create: `backend/tests/permit-workflow/steps/validate-application.test.ts`

- [ ] **Step 1: Write the test**

```typescript
import { validateApplication } from '../../../src/permit-workflow/steps/validate-application';

describe('validateApplication', () => {
  const validInput = {
    application_id: 'PERMIT-123',
    projectType: 'residential_remodel' as const,
    projectAddress: '742 Evergreen Terrace, Springfield',
    projectDescription: 'Full kitchen renovation',
    estimatedCost: 45000,
    applicantName: 'John Builder',
    applicantPhone: '555-0101',
    applicantEmail: 'john@builder.com',
  };

  it('should return validated application for residential remodel', async () => {
    const result = await validateApplication(validInput);
    expect(result.applicationId).toBe('PERMIT-123');
    expect(result.projectType).toBe('residential_remodel');
    expect(result.requiresPlanReview).toBe(false);
  });

  it('should require plan review for new construction', async () => {
    const result = await validateApplication({
      ...validInput,
      projectType: 'residential_new_construction',
    });
    expect(result.requiresPlanReview).toBe(true);
  });

  it('should require plan review for commercial projects', async () => {
    const result = await validateApplication({
      ...validInput,
      projectType: 'commercial_addition',
    });
    expect(result.requiresPlanReview).toBe(true);
  });

  it('should throw on missing applicantName', async () => {
    await expect(
      validateApplication({ ...validInput, applicantName: '' })
    ).rejects.toThrow('Missing required fields');
  });

  it('should throw on missing projectAddress', async () => {
    await expect(
      validateApplication({ ...validInput, projectAddress: '' })
    ).rejects.toThrow('Missing required fields');
  });

  it('should throw on non-positive estimatedCost', async () => {
    await expect(
      validateApplication({ ...validInput, estimatedCost: 0 })
    ).rejects.toThrow('Estimated cost must be positive');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest tests/permit-workflow/steps/validate-application.test.ts --no-coverage`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement validate-application**

```typescript
import type { ProjectType, ValidatedApplication } from '../../types';

interface ValidationInput {
  readonly application_id: string;
  readonly projectType: ProjectType;
  readonly projectAddress: string;
  readonly projectDescription: string;
  readonly estimatedCost: number;
  readonly applicantName: string;
  readonly applicantPhone: string;
  readonly applicantEmail: string;
}

const SIMULATED_DELAY_MS = 2000;

const PLAN_REVIEW_REQUIRED: readonly ProjectType[] = [
  'residential_new_construction',
  'commercial_new_construction',
  'commercial_addition',
] as const;

export const validateApplication = async (
  input: ValidationInput
): Promise<ValidatedApplication> => {
  await new Promise((resolve) => setTimeout(resolve, SIMULATED_DELAY_MS));

  const missingFields: string[] = [];
  if (!input.applicantName) missingFields.push('applicantName');
  if (!input.projectAddress) missingFields.push('projectAddress');
  if (!input.projectType) missingFields.push('projectType');
  if (missingFields.length > 0) {
    throw new Error(`Missing required fields: ${missingFields.join(', ')}`);
  }

  if (input.estimatedCost <= 0) {
    throw new Error('Estimated cost must be positive');
  }

  const requiresPlanReview = PLAN_REVIEW_REQUIRED.includes(input.projectType);

  return {
    applicationId: input.application_id,
    projectType: input.projectType,
    projectAddress: input.projectAddress,
    projectDescription: input.projectDescription,
    estimatedCost: input.estimatedCost,
    applicantName: input.applicantName,
    applicantPhone: input.applicantPhone,
    applicantEmail: input.applicantEmail,
    requiresPlanReview,
  };
};
```

- [ ] **Step 4: Run tests**

Run: `cd backend && npx jest tests/permit-workflow/steps/validate-application.test.ts --no-coverage`
Expected: 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/permit-workflow/ backend/tests/permit-workflow/
git commit -m "feat: add validate-application step for permit workflow"
```

### Task 4: Implement submit-to-agency step

**Files:**
- Create: `backend/src/permit-workflow/steps/submit-to-agency.ts`
- Create: `backend/tests/permit-workflow/steps/submit-to-agency.test.ts`

- [ ] **Step 1: Write the test**

```typescript
import { submitToAgency } from '../../../src/permit-workflow/steps/submit-to-agency';

describe('submitToAgency', () => {
  it('should approve building dept for residential remodel', async () => {
    const result = await submitToAgency('building_dept', 'residential_remodel');
    expect(result.agency).toBe('building_dept');
    expect(result.decision).toBe('approved');
    expect(result.reviewId).toMatch(/^REV-/);
  });

  it('should approve with conditions for new construction', async () => {
    const result = await submitToAgency('building_dept', 'residential_new_construction');
    expect(result.decision).toBe('conditional');
    expect(result.conditions.length).toBeGreaterThan(0);
  });

  it('should deny zoning for commercial addition', async () => {
    const result = await submitToAgency('zoning_board', 'commercial_addition');
    expect(result.decision).toBe('denied');
    expect(result.conditions).toContain('Commercial use not permitted in residential zone');
  });

  it('should approve zoning for residential remodel', async () => {
    const result = await submitToAgency('zoning_board', 'residential_remodel');
    expect(result.decision).toBe('approved');
  });

  it('should approve fire dept for all residential projects', async () => {
    const result = await submitToAgency('fire_dept', 'residential_remodel');
    expect(result.decision).toBe('approved');
  });

  it('should add fire conditions for new construction', async () => {
    const result = await submitToAgency('fire_dept', 'residential_new_construction');
    expect(result.decision).toBe('conditional');
    expect(result.conditions).toContain('Smoke detectors per code');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

- [ ] **Step 3: Implement submit-to-agency**

```typescript
import type { Agency, AgencyDecision, AgencyReview, ProjectType } from '../../types';

const DELAYS: Record<Agency, number> = {
  building_dept: 2000,
  fire_dept: 3000,
  zoning_board: 4000,
};

interface ScenarioOutcome {
  readonly decision: AgencyDecision;
  readonly conditions: string[];
}

const SCENARIOS: Record<ProjectType, Record<Agency, ScenarioOutcome>> = {
  residential_remodel: {
    building_dept: { decision: 'approved', conditions: [] },
    fire_dept: { decision: 'approved', conditions: [] },
    zoning_board: { decision: 'approved', conditions: [] },
  },
  residential_new_construction: {
    building_dept: { decision: 'conditional', conditions: ['Structural engineer review required'] },
    fire_dept: { decision: 'conditional', conditions: ['Smoke detectors per code'] },
    zoning_board: { decision: 'approved', conditions: [] },
  },
  commercial_renovation: {
    building_dept: { decision: 'conditional', conditions: ['ADA compliance review'] },
    fire_dept: { decision: 'conditional', conditions: ['Fire suppression system required'] },
    zoning_board: { decision: 'approved', conditions: [] },
  },
  commercial_new_construction: {
    building_dept: { decision: 'conditional', conditions: ['Structural engineer review required', 'Environmental impact assessment'] },
    fire_dept: { decision: 'conditional', conditions: ['Fire suppression system required', 'Emergency exit plan'] },
    zoning_board: { decision: 'conditional', conditions: ['Commercial zoning variance required'] },
  },
  commercial_addition: {
    building_dept: { decision: 'approved', conditions: [] },
    fire_dept: { decision: 'approved', conditions: [] },
    zoning_board: { decision: 'denied', conditions: ['Commercial use not permitted in residential zone'] },
  },
};

const REVIEWER_NAMES: Record<Agency, string> = {
  building_dept: 'J. Thompson, Building Inspector',
  fire_dept: 'M. Rodriguez, Fire Marshal',
  zoning_board: 'S. Patel, Zoning Administrator',
};

export const submitToAgency = async (
  agency: Agency,
  projectType: ProjectType
): Promise<AgencyReview> => {
  await new Promise((resolve) => setTimeout(resolve, DELAYS[agency]));

  const outcome = SCENARIOS[projectType]?.[agency] ?? {
    decision: 'approved' as const,
    conditions: [],
  };

  return {
    agency,
    decision: outcome.decision,
    conditions: outcome.conditions,
    reviewId: `REV-${agency.toUpperCase().slice(0, 3)}-${Date.now().toString(36)}`,
    reviewerName: REVIEWER_NAMES[agency],
  };
};
```

- [ ] **Step 4: Run tests**

Expected: 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/permit-workflow/steps/submit-to-agency.ts backend/tests/permit-workflow/steps/
git commit -m "feat: add submit-to-agency step with scenario outcomes"
```

### Task 5: Implement consolidate-reviews step

**Files:**
- Create: `backend/src/permit-workflow/steps/consolidate-reviews.ts`
- Create: `backend/tests/permit-workflow/steps/consolidate-reviews.test.ts`

- [ ] **Step 1: Write the test**

```typescript
import { consolidateReviews } from '../../../src/permit-workflow/steps/consolidate-reviews';
import type { AgencyReview } from '../../../src/types';

const makeReviews = (decisions: Array<{ agency: string; decision: string; conditions?: string[] }>): AgencyReview[] =>
  decisions.map(({ agency, decision, conditions }) => ({
    agency: agency as AgencyReview['agency'],
    decision: decision as AgencyReview['decision'],
    conditions: conditions ?? [],
    reviewId: `REV-${agency}`,
    reviewerName: 'Test Reviewer',
  }));

describe('consolidateReviews', () => {
  it('should return approved when all agencies approve', async () => {
    const reviews = makeReviews([
      { agency: 'building_dept', decision: 'approved' },
      { agency: 'fire_dept', decision: 'approved' },
      { agency: 'zoning_board', decision: 'approved' },
    ]);
    const result = await consolidateReviews(reviews);
    expect(result.overallDecision).toBe('approved');
    expect(result.approvedCount).toBe(3);
    expect(result.deniedCount).toBe(0);
  });

  it('should return conditional when some agencies have conditions', async () => {
    const reviews = makeReviews([
      { agency: 'building_dept', decision: 'conditional', conditions: ['Structural review'] },
      { agency: 'fire_dept', decision: 'conditional', conditions: ['Smoke detectors'] },
      { agency: 'zoning_board', decision: 'approved' },
    ]);
    const result = await consolidateReviews(reviews);
    expect(result.overallDecision).toBe('conditional');
    expect(result.allConditions).toContain('Structural review');
    expect(result.allConditions).toContain('Smoke detectors');
  });

  it('should return denied when any agency denies', async () => {
    const reviews = makeReviews([
      { agency: 'building_dept', decision: 'approved' },
      { agency: 'fire_dept', decision: 'approved' },
      { agency: 'zoning_board', decision: 'denied', conditions: ['Zoning violation'] },
    ]);
    const result = await consolidateReviews(reviews);
    expect(result.overallDecision).toBe('denied');
    expect(result.deniedCount).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

- [ ] **Step 3: Implement consolidate-reviews**

```typescript
import type { AgencyReview, ReviewConsolidation } from '../../types';

const SIMULATED_DELAY_MS = 2000;

export const consolidateReviews = async (
  reviews: AgencyReview[]
): Promise<ReviewConsolidation> => {
  await new Promise((resolve) => setTimeout(resolve, SIMULATED_DELAY_MS));

  const approvedCount = reviews.filter((r) => r.decision === 'approved').length;
  const conditionalCount = reviews.filter((r) => r.decision === 'conditional').length;
  const deniedCount = reviews.filter((r) => r.decision === 'denied').length;
  const allConditions = reviews.flatMap((r) => r.conditions);

  let overallDecision: ReviewConsolidation['overallDecision'];
  if (deniedCount > 0) {
    overallDecision = 'denied';
  } else if (conditionalCount > 0) {
    overallDecision = 'conditional';
  } else {
    overallDecision = 'approved';
  }

  return {
    overallDecision,
    approvedCount,
    conditionalCount,
    deniedCount,
    allConditions,
    reviews,
  };
};
```

- [ ] **Step 4: Run tests**

Expected: 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/permit-workflow/steps/consolidate-reviews.ts backend/tests/permit-workflow/steps/
git commit -m "feat: add consolidate-reviews step"
```

### Task 6: Implement generate-permit and issue-permit steps

**Files:**
- Create: `backend/src/permit-workflow/steps/generate-permit.ts`
- Create: `backend/src/permit-workflow/steps/issue-permit.ts`
- Create: `backend/tests/permit-workflow/steps/generate-permit.test.ts`
- Create: `backend/tests/permit-workflow/steps/issue-permit.test.ts`

- [ ] **Step 1: Write generate-permit test**

```typescript
import { generatePermit } from '../../../src/permit-workflow/steps/generate-permit';

describe('generatePermit', () => {
  it('should generate a permit document', async () => {
    const result = await generatePermit(
      'residential_remodel',
      ['Structural review required']
    );
    expect(result.permitNumber).toMatch(/^PRM-/);
    expect(result.conditions).toContain('Structural review required');
    expect(result.inspectionRequired).toBe(true);
    expect(result.issuedDate).toBeDefined();
    expect(result.expiryDate).toBeDefined();
  });

  it('should set inspectionRequired to false for simple remodels with no conditions', async () => {
    const result = await generatePermit('residential_remodel', []);
    expect(result.inspectionRequired).toBe(false);
  });

  it('should always require inspection for new construction', async () => {
    const result = await generatePermit('residential_new_construction', []);
    expect(result.inspectionRequired).toBe(true);
  });
});
```

- [ ] **Step 2: Write issue-permit test**

```typescript
import { issuePermit } from '../../../src/permit-workflow/steps/issue-permit';
import type { PermitDocument } from '../../../src/types';

describe('issuePermit', () => {
  const permit: PermitDocument = {
    permitNumber: 'PRM-TEST123',
    issuedDate: '2026-04-02',
    expiryDate: '2027-04-02',
    conditions: ['Structural review'],
    inspectionRequired: false,
  };

  it('should return an approved permit result', async () => {
    const result = await issuePermit('PERMIT-123', 'John Builder', permit, 'residential_remodel', '742 Evergreen Terrace');
    expect(result.application_id).toBe('PERMIT-123');
    expect(result.status).toBe('approved');
    expect(result.permit_number).toBe('PRM-TEST123');
    expect(result.project_address).toBe('742 Evergreen Terrace');
    expect(result.conditions).toContain('Structural review');
  });
});
```

- [ ] **Step 3: Implement generate-permit**

```typescript
import type { ProjectType, PermitDocument } from '../../types';

const SIMULATED_DELAY_MS = 2000;
const PERMIT_VALIDITY_DAYS = 365;

const NEW_CONSTRUCTION_TYPES: readonly ProjectType[] = [
  'residential_new_construction',
  'commercial_new_construction',
] as const;

export const generatePermit = async (
  projectType: ProjectType,
  conditions: string[]
): Promise<PermitDocument> => {
  await new Promise((resolve) => setTimeout(resolve, SIMULATED_DELAY_MS));

  const now = new Date();
  const expiry = new Date(now);
  expiry.setDate(expiry.getDate() + PERMIT_VALIDITY_DAYS);

  const inspectionRequired =
    conditions.length > 0 || NEW_CONSTRUCTION_TYPES.includes(projectType);

  return {
    permitNumber: `PRM-${Date.now().toString(36).toUpperCase()}`,
    issuedDate: now.toISOString().split('T')[0],
    expiryDate: expiry.toISOString().split('T')[0],
    conditions,
    inspectionRequired,
  };
};
```

- [ ] **Step 4: Implement issue-permit**

```typescript
import type { PermitDocument, PermitResult } from '../../types';

const SIMULATED_DELAY_MS = 2000;

export const issuePermit = async (
  applicationId: string,
  applicantName: string,
  permit: PermitDocument,
  projectType: string,
  projectAddress: string
): Promise<PermitResult> => {
  await new Promise((resolve) => setTimeout(resolve, SIMULATED_DELAY_MS));

  return {
    application_id: applicationId,
    applicant_name: applicantName,
    status: 'approved',
    permit_number: permit.permitNumber,
    issued_date: permit.issuedDate,
    expiry_date: permit.expiryDate,
    conditions: permit.conditions,
    project_address: projectAddress,
    project_type: projectType,
  };
};
```

- [ ] **Step 5: Run all step tests**

Run: `cd backend && npx jest tests/permit-workflow/steps/ --no-coverage`
Expected: All step tests pass.

- [ ] **Step 6: Commit**

```bash
git add backend/src/permit-workflow/steps/ backend/tests/permit-workflow/steps/
git commit -m "feat: add generate-permit and issue-permit steps"
```

---

## Chunk 4: Handlers

### Task 7: Implement permit workflow durable handler

**Files:**
- Create: `backend/src/permit-workflow/handler.ts`
- Create: `backend/tests/permit-workflow/handler.test.ts`

- [ ] **Step 1: Implement the handler**

Follow the exact same structure as the loan demo handler at `durable-lambda/backend/src/loan-workflow/handler.ts`, with these substitutions:

1. Import permit steps instead of loan steps
2. Replace `CREDIT_BUREAUS` with `AGENCIES: readonly Agency[] = ['building_dept', 'fire_dept', 'zoning_board']`
3. Replace `MANAGER_APPROVAL_THRESHOLD` with `validated.requiresPlanReview` boolean check
4. Replace `context.map` over bureaus with `context.map` over agencies calling `submitToAgency(agency, validated.projectType)`
5. Replace `calculateRiskScore` with `consolidateReviews(agencyReviews)`
6. Check `consolidation.overallDecision === 'denied'` instead of `!riskAssessment.approval_recommended`
7. Replace manager approval `waitForCallback<ManagerApprovalPayload>` with plan review `waitForCallback<PlanReviewPayload>` — handle `revisionRequired` in denial path
8. Replace fraud check with site inspection — same `waitForCallback<InspectionResult>` pattern, invoke `config.siteInspectionFunctionName`
9. Replace `generateLoanOffer` with `generatePermit(validated.projectType, consolidation.allConditions)`
10. Replace `disburseFunds` with `issuePermit(applicationId, validated.applicantName, permit, validated.projectType, validated.projectAddress)`
11. Update all progress log messages and step names (`'agency_review'`, `'review_consolidation'`, `'plan_review'`, `'site_inspection'`, `'generating_permit'`, `'issuing'`)
12. Use `config.siteInspectionFunctionName` instead of `config.fraudCheckFunctionName`
13. Change timeout from `{ hours: 24 }` to `{ minutes: 30 }` for plan review

- [ ] **Step 2: Write the denial path test**

Same pattern as loan demo — test the `commercial_addition` scenario (denied by zoning). Use `LocalDurableTestRunner` with `skipTime: true`. Mock progress-logger and Lambda client.

- [ ] **Step 3: Run tests**

Expected: Denial test passes.

- [ ] **Step 4: Commit**

```bash
git add backend/src/permit-workflow/handler.ts backend/tests/permit-workflow/handler.test.ts
git commit -m "feat: add durable permit workflow handler"
```

### Task 8: Implement site inspection handler

**Files:**
- Create: `backend/src/site-inspection/handler.ts`
- Create: `backend/tests/site-inspection/handler.test.ts`

- [ ] **Step 1: Implement handler**

Same pattern as fraud-check handler, with these changes:
- Import `InspectionEvent`, `InspectionResult` instead of `FraudCheckEvent`, `FraudCheckResult`
- Return `{ inspectionPassed: true, findings: [], inspectorId: 'INS-xxx' }` for all demo scenarios
- Use `config.siteInspectionFunctionName` (though not directly — this Lambda IS the inspection function)
- Log messages reference "site inspection" instead of "fraud check"

```typescript
import { Logger } from '@aws-lambda-powertools/logger';
import { Tracer } from '@aws-lambda-powertools/tracer';
import {
  LambdaClient,
  SendDurableExecutionCallbackSuccessCommand,
} from '@aws-sdk/client-lambda';
import { config } from '../config';
import type { InspectionEvent, InspectionResult } from '../types';

const logger = new Logger({ serviceName: config.serviceName });
const tracer = new Tracer({ serviceName: config.serviceName });
const lambdaClient = tracer.captureAWSv3Client(new LambdaClient({}));

const SIMULATED_DELAY_MS = 5_000;

export const handler = async (event: InspectionEvent): Promise<void> => {
  logger.info('Site inspection started', {
    applicationId: event.applicationId,
    projectAddress: event.projectAddress,
    callbackId: event.callbackId,
  });

  await new Promise((resolve) => setTimeout(resolve, SIMULATED_DELAY_MS));

  const inspectionResult: InspectionResult = {
    inspectionPassed: true,
    findings: [],
    inspectorId: `INS-${Date.now().toString(36).toUpperCase()}`,
  };

  logger.info('Site inspection completed', {
    applicationId: event.applicationId,
    result: inspectionResult,
  });

  await lambdaClient.send(
    new SendDurableExecutionCallbackSuccessCommand({
      CallbackId: event.callbackId,
      Result: Buffer.from(JSON.stringify(inspectionResult)),
    })
  );

  logger.info('Inspection callback sent', { callbackId: event.callbackId });
};
```

- [ ] **Step 2: Write test**

Same mock pattern as fraud-check test. Mock `LambdaClient`, use `jest.useFakeTimers()` to skip delay.

- [ ] **Step 3: Run tests**

Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add backend/src/site-inspection/ backend/tests/site-inspection/
git commit -m "feat: add site inspection handler with callback"
```

### Task 9: Update API handler and routes

**Files:**
- Create: `backend/src/api/handler.ts` (replace)
- Create: `backend/src/api/routes/apply.ts` (replace)
- Create: `backend/src/api/routes/approve.ts` (replace)
- Modify: `backend/src/api/routes/status.ts` (one-line type import change)
- Create: `backend/tests/api/handler.test.ts` (replace)

- [ ] **Step 1: Update status.ts import and cast**

Two changes in `backend/src/api/routes/status.ts`:
1. Line 5: Change `import type { LoanProgressItem } from '../../types'` to `import type { PermitProgressItem } from '../../types'`
2. Line 28: Change `const item = result.Item as LoanProgressItem` to `const item = result.Item as PermitProgressItem`

- [ ] **Step 2: Rewrite apply.ts**

Same structure as loan demo's apply.ts, with these changes:
- Import `PermitApplication`, `PermitProgressItem` instead of loan types
- Required fields: `projectType`, `projectAddress`, `estimatedCost`, `applicantName`
- Validate `estimatedCost` is a positive number
- Generate `PERMIT-{timestamp}-{random}` IDs instead of `LOAN-` prefix
- DDB item includes `project_type`, `project_address`, `estimated_cost` instead of `loan_amount`
- Use `config.workflowFunctionName` instead of `config.loanFunctionName`

- [ ] **Step 3: Rewrite approve.ts**

Same structure, with these changes:
- Import `PlanReviewPayload` instead of `ManagerApprovalPayload`
- Cast item as `PermitProgressItem`
- Default payload: `{ approved: true }` (same)
- Log messages reference "plan review" instead of "manager approval"

- [ ] **Step 4: Rewrite handler.ts**

Same route dispatcher, with metric names from config (already using `config.metricsNamespace`). The only change is the metric name: `'ManagerApprovals'` → `'PlanReviewActions'`.

- [ ] **Step 5: Write API tests**

Same test structure as loan demo. Test:
- POST /apply with valid permit application → 201
- POST /apply with missing fields → 400
- GET /status/{id} → 200 with item or 404
- POST /approve/{id} → 200 with callback or 400 when no pending approval

- [ ] **Step 6: Run all backend tests**

Run: `cd backend && npx jest --no-coverage`
Expected: All tests pass.

- [ ] **Step 7: Commit**

```bash
git add backend/src/api/ backend/tests/api/
git commit -m "feat: update API handler and routes for permit workflow"
```

---

## Chunk 5: Infrastructure Edits

### Task 10: Update BackendStack construct names and paths

**Files:**
- Modify: `infra/lib/backend/backend-stack.ts`

- [ ] **Step 1: Make all naming substitutions**

Find and replace construct IDs in `backend-stack.ts`:
- `'LoanProgressTable'` → `'PermitProgressTable'`
- `'LoanWorkflowFunction'` → `'PermitWorkflowFunction'`
- `'LoanApiFunction'` → `'PermitApiFunction'`
- `'FraudCheckFunction'` → `'SiteInspectionFunction'`
- `'LoanApi'` → `'PermitApi'`
- `'WorkflowAlias'` → `'WorkflowAlias'` (unchanged)
- `'FraudLogGroup'` → `'InspectionLogGroup'`
- `'ApiLogGroup'` → `'ApiLogGroup'` (unchanged)
- `'loan-workflow'` → `'permit-workflow'` (entry paths)
- `'fraud-check'` → `'site-inspection'` (entry paths)
- `'loan-workflow'` → `'permit-workflow'` (POWERTOOLS_SERVICE_NAME)
- `'fraud-check'` → `'site-inspection'` (POWERTOOLS_SERVICE_NAME)
- `'loan-api'` → `'permit-api'` (POWERTOOLS_SERVICE_NAME)
- `FRAUD_CHECK_FUNCTION_NAME` → `SITE_INSPECTION_FUNCTION_NAME` (env var)
- `LOAN_FUNCTION_NAME` → `WORKFLOW_FUNCTION_NAME` (env var)
- `'LoanApproval'` → `'PermitFlow'` (POWERTOOLS_METRICS_NAMESPACE)
- Log group names: `fraud-check` → `site-inspection`

- [ ] **Step 2: Verify infra compiles**

Run: `cd infra && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add infra/lib/backend/backend-stack.ts
git commit -m "feat: update BackendStack naming for PermitFlow"
```

---

## Chunk 6: Frontend

### Task 11: Implement PermitFlow frontend

**Files:**
- Create: `frontend/src/types.ts`
- Create: `frontend/src/App.tsx`
- Create: `frontend/src/App.css`

- [ ] **Step 1: Create frontend types**

Include all types from the spec plus `ApplicationState`, `DemoProfile`, `WORKFLOW_STEPS`, `STEP_LABELS`, `DEMO_PROFILES`, `TERMINAL_STATUSES`. Use the same pattern as the loan demo's `frontend/src/types.ts` but with permit-specific values.

Demo profiles:
- Kitchen Remodel: residential_remodel, 742 Evergreen Terrace, $45K, "Auto-approved, no plan review"
- New Home Build: residential_new_construction, 1600 Pennsylvania Ave, $350K, "Approved with plan review"
- Commercial Expansion: commercial_addition, 100 Main St (Residential Zone), $200K, "Denied — zoning violation"

Step labels:
- submitted → "Filed", validating → "Validating", agency_review → "Agency Review", review_consolidation → "Consolidation", plan_review → "Plan Review", site_inspection → "Inspection", generating_permit → "Generating", issuing → "Issuing", complete → "Complete"

- [ ] **Step 2: Create App.tsx**

Fetch the original loan demo App.tsx at `/Users/pdamra/Workspace/durable-lambda/frontend/src/App.tsx` for reference. Convert to permit domain with these changes:

1. Title: "PermitFlow" with subtitle "Building Permit Tracker"
2. Demo profiles section: 3 color-coded project cards (green/blue/red borders)
3. Form fields: Project Type (dropdown), Project Address, Project Description (textarea), Estimated Cost, Applicant Name, Phone, Email
4. Step tracker: same horizontal bar, new labels
5. Approval modal: "Plan Review Required" with 3 buttons (Approve Plans / Request Revision / Deny). Shows project summary in modal body.
6. Result display: Approved shows permit number, dates, conditions. Denied shows reason and denying agency. Revision requested shows amber styling with revision reason.
7. Debug logs panel: identical structure, just new step names in the data
8. ID prefix in polling: `PERMIT-` instead of `LOAN-`

- [ ] **Step 3: Create App.css**

Same structure as loan demo CSS with PermitFlow branding:
- Primary color: #2563eb
- Add `.revision-result` class with amber (#f59e0b) border for revision requests
- Demo profile borders: green for auto-approved, blue for requires review, red for denied

- [ ] **Step 4: Verify build**

Run: `cd frontend && npx vite build`
Expected: Clean build.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/
git commit -m "feat: add PermitFlow React frontend with permit workflow UI"
```

---

## Chunk 7: Verification

### Task 12: Full build and test verification

- [ ] **Step 1: Run all backend tests**

Run: `npm -w backend run test`
Expected: All tests pass.

- [ ] **Step 2: Build frontend**

Run: `cd frontend && npx vite build`
Expected: Clean build.

- [ ] **Step 3: Compile infra**

Run: `cd infra && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 4: Final commit if needed**

```bash
git add -A && git commit -m "chore: verify full build and tests pass"
```

### Task 13: Create .claude/launch.json

- [ ] **Step 1: Create launch config**

```json
{
  "version": "0.0.1",
  "configurations": [
    {
      "name": "frontend",
      "runtimeExecutable": "/bin/bash",
      "runtimeArgs": ["-c", "export NVM_DIR=\"$HOME/.nvm\" && . \"$NVM_DIR/nvm.sh\" && npm -w frontend run dev -- --port 5200 --strictPort"],
      "port": 5200
    }
  ]
}
```

- [ ] **Step 2: Commit**

```bash
git add .claude/launch.json
git commit -m "chore: add launch.json for PermitFlow dev server"
```
