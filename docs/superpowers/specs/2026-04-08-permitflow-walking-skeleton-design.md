# PermitFlow Walking Skeleton Design

**Date:** 2026-04-08
**Status:** Approved
**Scope:** First spec in a multi-spec product build. Covers the minimum end-to-end experience for one expediter tracking permits in one tenant.

---

## Product decisions

| Decision | Answer |
|---|---|
| Customer | Expediters / permit consultants |
| Product shape | Tracker/CRM first, assisted submission later |
| Personas | Expediters only. Clients get email + tokenized status pages, no login. |
| Data model | Project (parent) -> Permits (children). Each permit = its own durable workflow instance. |
| Jurisdiction knowledge | Free-form workflows with save-as-template from day one. Evolves toward curated catalog. |

---

## 1. Scope

The skeleton proves the whole architecture end-to-end with one real expediter using one real project with one real permit. Every subsystem that will eventually exist is present in thin form. Anything not needed to validate the concept is explicitly deferred.

### In the skeleton

**Identity and tenancy.** One expediter signs in. They belong to a tenant (a firm). All data is tenant-scoped from day one. Tenants are created manually via an admin CLI.

**Data model.** Tenants, users, projects, permits, documents, and workflow instances with the relationship `tenant -> user`, `tenant -> project -> permits`, `permit -> workflow instance`, and `document -> project | permit`.

**Project and permit CRUD.** A logged-in expediter can create a project, add permits to a project, view all projects, view project detail with permits and documents, view permit detail with state and documents.

**One generic permit workflow.** Every permit uses the same hardcoded durable workflow shape: `submitted -> filed -> in_review -> (issued | denied)`. The expediter manually advances state via buttons. The durable execution engine checkpoints each transition and fires notifications.

**Document management.** Expediter uploads files to a project or permit via presigned PUT URLs directly to S3. Files are scanned by `cdk-serverless-clamscan`. Clean files are downloadable via presigned GET URLs. Infected files are quarantined. Each document has a `clientVisible` flag controlling exposure on the public status page.

**Notifications.** When a permit changes state, emails go to the client (via SES) and expediter. Three event types: permit created, state changed, finalized (issued/denied). Unsubscribe via a per-project flag toggled by a tokenized link.

**Client status page.** Each project has a tokenized public URL. Anyone with the link sees a read-only view of the project, its permits, and client-visible clean documents with download links. No login required.

### Explicitly deferred

- Template system (save-as-template, apply-on-create)
- Multi-user tenants (one user per tenant in skeleton)
- Self-serve signup (admin CLI only; first post-MVP task)
- Billing (Stripe, subscriptions)
- Jurisdiction catalog (curated templates)
- Client portal with login
- Deadline / SLA tracking and reminders
- Assisted submission / form generation
- Per-jurisdiction logic or configuration
- Admin UI (CLI for staff operations)
- SSO, SAML, MFA
- Audit log (beyond durable workflow checkpoints and CloudTrail)
- Document versioning, inline preview, bulk upload, folder organization
- Frontend component tests, end-to-end integration tests, load tests

### Definition of done

A single expediter in a single tenant can log in, create a project with a client email, add three permits, manually walk each permit through its states, watch the client receive status emails, upload and download documents, share the tokenized status link with the client (who can view permits and download client-visible documents), and see the whole thing survive a Lambda redeploy mid-workflow without losing state.

---

## 2. Architecture

### System diagram

```
                 CloudFront + S3
            (existing blue/green SPA infra)
                        |
                        v
                 HTTP API Gateway
          (Cognito JWT authorizer on all routes
           except /status/{projectId}?token=...)
                        |
          +-------------+------------------+
          v             v                  v
   ApiFunction    StatusFunction     DocsFunction
   (auth'd CRUD)  (public tokened)   (presign issuer)
          |             |                  |
          v             v                  v
   +--------------------------------------------------+
   |         DynamoDB -- single table                  |
   |  (tenants, users, projects, permits, documents,   |
   |       workflow state, notification config)        |
   +----------------------------+---------------------+
                                | invokes
                                v
                  PermitWorkflowFunction
                  (durable execution SDK,
                   one instance per permit)
                                | publishes events
                                v
                       EventBridge bus
                  (permit state change,
                   doc scan result, etc.)
                                |
                  +-------------+---------------+
                  v                             v
         NotifierFunction              DocStatusUpdater
         (SES email send)              (clean/infected tag)

                  S3 -- documents bucket
                  (tenant-prefixed keys,
                   scanned by ClamScan)
                                |
                  cdk-serverless-clamscan
                  (Lambda container,
                   EventBridge results)
```

### Lambda functions

Six total:

- **ApiFunction** -- authenticated CRUD for projects, permits, state transitions. Routes all API calls. Auth middleware resolves tenantId from JWT claims.
- **PermitWorkflowFunction** -- durable execution handler. One instance per permit. Checkpoints state, fires EventBridge events.
- **StatusFunction** -- unauthenticated public status page and client document downloads. Token-validated.
- **DocsFunction** -- generates presigned PUT/GET URLs. Enforces tenant ownership, size limits, MIME whitelist.
- **NotifierFunction** -- consumes EventBridge events, sends SES emails.
- **DocStatusUpdater** -- consumes ClamScan EventBridge events, updates document status in DynamoDB, tags quarantined objects.

### Data model -- DynamoDB single-table design

One table, one GSI with overloaded keys.

**Tenant**

```
PK:     TENANT#<tenantId>
SK:     METADATA
type:   tenant
name:   "Acme Expediting"
createdAt, updatedAt
```

**User**

```
PK:     TENANT#<tenantId>
SK:     USER#<userId>
GSI1PK: USER#<cognitoSub>
GSI1SK: TENANT#<tenantId>
type:   user
email:  "owner@acme.com"
role:   "owner"
createdAt, updatedAt
```

**Project**

```
PK:     TENANT#<tenantId>
SK:     PROJECT#<projectId>
GSI1PK: TENANT#<tenantId>
GSI1SK: PROJECT#<createdAt>#<projectId>
type:   project
name:   "Smith House"
address: "123 Main St, Oakland CA"
clientName, clientEmail
notifyClient: true
statusToken: "<random-256-bit-hex>"
createdBy: USER#<userId>
createdAt, updatedAt
```

**Permit**

```
PK:     TENANT#<tenantId>
SK:     PROJECT#<projectId>#PERMIT#<permitId>
GSI1PK: PROJECT#<projectId>
GSI1SK: PERMIT#<createdAt>#<permitId>
type:   permit
name:   "Building Permit"
description: "..."
status: "submitted" | "filed" | "in_review" | "issued" | "denied"
workflowExecutionArn: "arn:aws:lambda:...:execution/..."
callbackId: "<current-callback-id>"
createdAt, updatedAt
```

**Document**

```
PK:     TENANT#<tenantId>
SK:     DOC#<documentId>
GSI1PK: PROJECT#<projectId>  (or PERMIT#<permitId>)
GSI1SK: DOC#<createdAt>#<documentId>
type:   document
filename: "site-plan.pdf"
mimeType: "application/pdf"
sizeBytes: 1234567
s3Key: "tenants/<tenantId>/projects/<projectId>/<documentId>/site-plan.pdf"
status: "uploading" | "scanning" | "clean" | "infected"
clientVisible: true
attachedTo: { kind: "project" | "permit", id: "..." }
uploadedBy: USER#<userId>
createdAt, updatedAt
```

### GSI1 access patterns

- `USER#<cognitoSub>` -- look up user by Cognito identity at login
- `TENANT#<tenantId>` -- list all projects in a tenant (sorted by createdAt)
- `PROJECT#<projectId>` -- list all permits or documents in a project

### Tenancy isolation

Every access pattern starts with `TENANT#<tenantId>` as the partition key (or GSI1PK on lookups). The ApiFunction reads the caller's tenantId from the Cognito JWT claims and injects it into every query. No query is ever unscoped. Cross-tenant queries are physically impossible because every index partition starts with a tenant prefix.

### Workflow state

The durable workflow engine writes its own checkpoint items. Those items live alongside application items in the same table under different SK prefixes. The `workflowExecutionArn` on a permit record is the pointer between application data and durable execution state.

---

## 3. Identity and auth

### Approach: Cognito User Pool with email + password

Standard AWS Cognito with email as login identifier. Password flow chosen over passwordless because expediters sign in multiple times daily and magic-link friction accumulates at that frequency.

### AWS resources

- One Cognito User Pool (email login, Cognito defaults for password policy, MFA off for MVP)
- One Cognito User Pool Client (public client, authorization code + PKCE flow, no client secret)
- HTTP API Gateway JWT authorizer pointing at the User Pool issuer URL, protecting all routes except the public status page

### Identity to tenant mapping

Cognito owns identity (email, password, `sub`). DynamoDB owns tenant membership.

Request flow:
1. API Gateway validates the JWT and forwards the request with claims.
2. ApiFunction middleware reads `sub` from the claims.
3. GSI1 lookup: `GSI1PK = USER#<sub>` returns the User item containing `tenantId`.
4. Middleware injects `tenantId` and `userId` into a typed request context. Handlers receive non-nullable fields.

The mapping lives in DynamoDB (not Cognito custom attributes) so tenant management stays in our control and the same pattern scales to multi-user tenants without schema changes.

### Tenant creation (admin CLI)

A script in `infra/scripts/` that:
1. Takes tenant name + admin user email as input.
2. Creates the Cognito user with a temporary password (Cognito invite flow emails it).
3. Writes Tenant and User items to DynamoDB, linking the Cognito `sub` to the new tenant.

Self-serve signup is the first post-MVP task. The admin CLI's data model is designed to not obstruct that.

### Password reset

Cognito built-in forgot-password flow. Zero custom code.

### Token handling in the SPA

Authorization code + PKCE flow. Access token in memory, refresh token in localStorage. Every API call attaches the access token as `Authorization: Bearer <jwt>`. On 401, the SPA attempts refresh; on failure, redirects to `/login`.

### Deferred

- MFA (Cognito supports it; add later without schema change)
- SSO / SAML / OIDC federation
- Session revocation / device management
- SCIM user provisioning

---

## 4. Behaviors

### 4a. Permit workflow state machine

#### States

```
submitted -> filed -> in_review -> issued
                                -> denied
```

Five states, four transitions. Every transition is manual (expediter clicks a button). Terminal states: `issued` and `denied`.

#### Workflow execution

Each permit has its own durable workflow execution, started at permit creation. The workflow shape:

1. Emit `permit.created` event.
2. `waitForCallback('wait-for-filed')` -- paused until expediter clicks "Mark as filed."
3. Update permit status to `filed`. Emit `permit.state_changed` event.
4. `waitForCallback('wait-for-in-review')` -- paused until expediter clicks "Mark as in review."
5. Update permit status to `in_review`. Emit `permit.state_changed` event.
6. `waitForCallback('wait-for-final-decision')` -- paused until expediter clicks "Mark as issued" or "Mark as denied."
7. Update permit status to `issued` or `denied`. Emit `permit.finalized` event.

Each `waitForCallback` persists its callback ID on the permit record in DynamoDB. The callback `serdes` config includes `{ deserialize: async (data) => JSON.parse(data as string) }` to properly parse the transition payload. Timeouts set to 365 days (permits take weeks; the timeout is a safety net, not a business rule).

#### State transition API

```
POST /tenants/{tenantId}/projects/{projectId}/permits/{permitId}/transition
Body: { nextState: "filed" | "in_review" | "issued" | "denied", notes?: string, denialReason?: string }
```

Handler flow:
1. Middleware resolves tenantId from JWT, verifies path match.
2. Load permit, verify current state allows requested transition via `canTransition()` pure function.
3. Read callbackId from permit record.
4. Call `SendDurableExecutionCallbackSuccessCommand` with transition payload (using untraced LambdaClient to avoid X-Ray middleware TypeError on durable execution commands).
5. Return 202 Accepted.

The handler does not directly update permit status in DynamoDB. The workflow owns state updates after callback resume. This ensures atomicity: either the workflow resumed and state is updated, or it did not and state is unchanged.

Invalid transitions return 409 Conflict.

### 4b. Notifications

#### Events

| Event | Triggered when | Recipients |
|---|---|---|
| `permit.created` | Workflow instance starts | Expediter |
| `permit.state_changed` | Workflow resumes from callback | Client (if opted in) |
| `permit.finalized` | Workflow reaches issued/denied | Client (if opted in) AND expediter |

#### NotifierFunction logic

On EventBridge event: load permit and project from DynamoDB. Route to the appropriate email template based on event type. Send via SES. Skip client emails if `project.notifyClient` is false or `project.clientEmail` is empty.

#### Email templates

Three plain-text templates with `{{ placeholder }}` substitution, stored as TypeScript string constants. Each includes: subject line with project and permit name, body with current state, link to the tokenized public status page, and unsubscribe footer.

#### Unsubscribe

Per-project opt-out. Client clicks the unsubscribe link in an email, which hits `GET /status/{projectId}/unsubscribe?token=<statusToken>`. The StatusFunction verifies the token and sets `project.notifyClient = false`. Only client emails stop; expediter emails continue.

### 4c. UI screens

Six screens:

1. **Login** (`/login`) -- Cognito hosted UI or custom form with email + password + forgot-password link. Redirects to `/projects` on success.
2. **Project list** (`/projects`) -- Table/card list of projects showing name, address, client, permit count, most recent permit status. "Create project" button.
3. **Create project** (`/projects/new`) -- Form: name, address, client name, client email, notify-client toggle (default on).
4. **Project detail** (`/projects/:projectId`) -- Header with project info and edit. Tabs: permits list (with name, state, open link, add-permit button) and documents list (with upload button). Footer: copyable public status link.
5. **Create permit** (`/projects/:projectId/permits/new`) -- Form: permit name, description, optional agency name.
6. **Permit detail** (`/projects/:projectId/permits/:permitId`) -- Current state badge, state history timeline from progress logs, advance-state button (label changes by state, with confirmation + notes for terminal states), documents list with upload button.

**Public status page** (`/status/:projectId?token=...`) -- Unauthenticated. Read-only project view: project name (no address), client name (no contact info), permits with current state, client-visible clean documents with download links. Unsubscribe link at bottom.

**SPA authentication** -- Cognito JS SDK. Access token attached as `Authorization: Bearer <jwt>` on every API call. 401 triggers refresh attempt, then redirect to login.

### 4d. Document management

#### Upload flow

1. Expediter clicks Upload on a project or permit detail page. File picker opens.
2. Allowed: PDF, PNG, JPEG, DWG. Max 100MB.
3. SPA calls `POST /docs/presign` with filename, mimeType, sizeBytes, and `{ kind: "project" | "permit", id: "..." }`.
4. Backend validates size and MIME, creates a Document record in DynamoDB with status `uploading`, returns presigned PUT URL with tenant-scoped S3 key + documentId.
5. SPA PUTs directly to S3. On success, calls `POST /docs/{id}/uploaded` to flip status to `scanning`.
6. SPA polls `GET /docs/{id}` every 2 seconds for up to 60 seconds, showing a "Scanning..." badge.
7. ClamScan EventBridge event fires. DocStatusUpdater Lambda flips status to `clean` or `infected`. Next poll returns new state.

#### Download flow

1. Expediter clicks a clean document.
2. SPA calls `GET /docs/{id}/download-url`.
3. Backend verifies tenant ownership and document status is `clean`, returns presigned GET URL (5-minute TTL).
4. SPA opens URL in new tab. Browser downloads from S3.

#### Client downloads (public status page)

Each client-visible clean document on the public status page has a download button. Calls `GET /status/{projectId}/docs/{documentId}/download-url?token=<statusToken>`. The StatusFunction verifies: token matches project, document belongs to the project (or a permit under it), document is clean and clientVisible. Returns presigned GET URL (5-minute TTL). Failures return 404 (not 403).

#### Infected file handling

DocStatusUpdater Lambda on `infected` event: flips document status to `infected`, adds S3 object tag `quarantine=true`, logs structured info. S3 lifecycle rule deletes quarantined objects after 30 days.

#### S3 bucket structure

```
<docs-bucket>/tenants/<tenantId>/projects/<projectId>/<documentId>/<filename>
```

Bucket configuration: SSE-S3 encryption, block all public access, versioning disabled, CORS for presigned PUT from frontend domain, lifecycle rule for quarantined objects.

#### Size enforcement

Two points: backend rejects presign requests exceeding 100MB (fast fail), and S3 bucket policy enforces `s3:content-length-header` condition (catches dishonest clients).

---

## 5. Testing strategy

### Layer 1: Unit tests

Pure functions tested in isolation. Examples: `canTransition()` state machine, `buildProjectStatusUrl()`, `validateUploadRequest()`, `resolveTenantFromClaims()`, email template renderers. Fast, no AWS dependencies. Bulk of coverage.

### Layer 2: Lambda handler tests with aws-sdk-client-mock

Each Lambda handler tested as a unit with mocked SDK calls. Following the existing `aws-sdk-client-mock` and `aws-sdk-client-mock-jest` patterns. Coverage: ApiFunction routes, StatusFunction token validation, DocsFunction presign generation, NotifierFunction email rendering, DocStatusUpdater status transitions.

### Layer 3: Durable workflow tests with @aws/durable-execution-sdk-js-testing

Using the SDK's testing utilities, matching the existing demo's pattern. Coverage: happy path (submitted through issued with four callbacks), denial path, timeout path, and replay path (interrupt mid-step, resume, verify no re-emitted events).

### Coverage target

70-90 tests across 15-20 suites. Every handler has at least one happy path and one failure path test. Every pure function has full branch coverage.

### Deferred testing

End-to-end integration tests against real AWS, frontend component tests, load tests, security/penetration tests. Manual smoke tests against the dev environment fill the gap for the skeleton.

---

## 6. Deployment path

### Migration strategy: strangler fig inside the same repo

Evolve the existing PermitFlow demo in place over a sequence of small, independently-deployable steps. Each step keeps the pipeline green.

### Phase order

**Phase A: Cognito stack + trivial authorized endpoint.** New CDK resources (User Pool, Client, Authorizer), new `GET /whoami` route. Existing demo routes stay unauthenticated. Proves auth plumbing works.

**Phase B: Data model migration.** New DynamoDB table with single-table design. Existing progress table stays as a rollback lifeline. Verify durable SDK checkpoints do not conflict with application items.

**Phase C: Auth middleware + tenant scoping.** All routes require JWT. Admin CLI for tenant creation. Test tenant created in dev.

**Phase D: New UI screens + state transition API.** Replace demo UI progressively using existing blue/green frontend pipeline. Old UI stays on blue until new UI is verified on green.

**Phase E: Document management subsystem.** S3 bucket, ClamScan wiring, DocsFunction, DocStatusUpdater, upload/download UI. Standalone. Feature-flagged via environment variable.

**Phase F: Notifications + public status page.** SES configuration, NotifierFunction, StatusFunction, email templates, public page. Standalone. (Open SES production access request during Phase A so it is ready by Phase F.)

**Phase G: Cleanup.** Delete demo code, old progress table, deprecated routes. Update documentation. Tag v0.1.0.

### Rollback plans

- Phases A, E, F: additive. Rollback = remove new resources.
- Phase B: keep old table until Phase G. Re-point code if new table corrupts.
- Phase C: flip JWT authorizer off to restore old behavior.
- Phase D: revert blue/green promotion.

### Pipeline safety

Every PR runs `cdk synth --all` in CI. New CDK constructs added behind feature flags in config so they can be disabled in a hotfix.

### Environments

- Dev: auto-deploy on merge, smoke tests, test tenant.
- Prod: manual approval gate. Phases promoted only after dev soak (at least one day).

### External dependencies to start early

- SES sandbox to production request (days to approve; open during Phase A).
- ClamScan container cold starts (seconds, acceptable for document scanning UX; provisioned concurrency is available if needed later).
