import { Logger } from '@aws-lambda-powertools/logger';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { withDurableExecution } from '@aws/durable-execution-sdk-js';
import type { DurableContext } from '@aws/durable-execution-sdk-js';
import { config } from '../config';
import { createProgressLogger } from '../shared/progress-logger';
import { validateApplication } from './steps/validate-application';
import { submitToAgency } from './steps/submit-to-agency';
import { consolidateReviews } from './steps/consolidate-reviews';
import { generatePermit } from './steps/generate-permit';
import { issuePermit } from './steps/issue-permit';
import type {
  PermitApplication,
  Agency,
  AgencyReview,
  InspectionEvent,
  InspectionResult,
  PermitResult,
  PlanReviewPayload,
} from '../types';

const logger = new Logger({ serviceName: config.serviceName });
const tracer = new Tracer({ serviceName: config.serviceName });
const lambdaClient = tracer.captureAWSv3Client(new LambdaClient({}));

const AGENCIES: readonly Agency[] = ['building_dept', 'fire_dept', 'zoning_board'] as const;

interface PermitWorkflowInput extends PermitApplication {
  readonly application_id: string;
}

export const handler = withDurableExecution(
  async (event: PermitWorkflowInput, context: DurableContext) => {
    const { application_id } = event;
    const progress = createProgressLogger(application_id);

    // Step 1: Validate application
    await progress.updateStep('validating', 'processing');
    await progress.log('validating', 'Starting application validation', 'info');

    const validated = await context.step('validate-application', async () => {
      return validateApplication({
        application_id: event.application_id,
        projectType: event.projectType,
        projectAddress: event.projectAddress,
        projectDescription: event.projectDescription,
        estimatedCost: event.estimatedCost,
        applicantName: event.applicantName,
        applicantPhone: event.applicantPhone,
        applicantEmail: event.applicantEmail,
      });
    });

    await progress.log('validating', `Application validated for ${validated.applicantName}`, 'info');

    // Step 2: Submit to agencies in parallel
    await progress.updateStep('agency_review', 'processing');
    await progress.log('agency_review', 'Submitting to 3 agencies for review', 'info');

    const agencyResults = await context.map<Agency, AgencyReview>(
      'submit-to-agencies',
      [...AGENCIES],
      async (_ctx, agency) => {
        return submitToAgency(agency, validated.projectType);
      }
    );
    const agencyReviews = agencyResults.getResults();

    await progress.log(
      'agency_review',
      `Received ${agencyReviews.length} agency reviews`,
      'info'
    );

    // Step 3: Consolidate reviews
    await progress.updateStep('review_consolidation', 'processing');
    await progress.log('review_consolidation', 'Consolidating agency reviews', 'info');

    const consolidation = await context.step('consolidate-reviews', async () => {
      return consolidateReviews(agencyReviews);
    });

    await progress.log(
      'review_consolidation',
      `Overall decision: ${consolidation.overallDecision}, Conditions: ${consolidation.allConditions.length}`,
      'info'
    );

    // Step 4: Check if denied
    if (consolidation.overallDecision === 'denied') {
      const deniedResult: PermitResult = {
        application_id,
        applicant_name: validated.applicantName,
        status: 'denied',
        denial_reason: `Agency review denied: ${consolidation.deniedCount} agency(s) denied`,
      };

      await progress.updateStep('complete', 'denied');
      await progress.log('complete', 'Application denied based on agency reviews', 'warn');
      await progress.setResult(deniedResult as unknown as Record<string, unknown>);

      return deniedResult;
    }

    // Step 5: Plan review for projects that require it
    if (validated.requiresPlanReview) {
      await progress.updateStep('plan_review', 'pending_approval');
      await progress.log(
        'plan_review',
        `Project type ${validated.projectType} requires plan review`,
        'info'
      );

      const planReview = await context.waitForCallback<PlanReviewPayload>(
        'plan-review',
        async (callbackId) => {
          await progress.setCallbackId(callbackId);
          logger.info('Waiting for plan review', { callbackId, application_id });
        },
        { timeout: { minutes: 30 } }
      );

      await progress.clearCallbackId();

      if (!planReview.approved || planReview.revisionRequired) {
        const reason = planReview.revisionRequired
          ? `Revision requested: ${planReview.reason ?? 'No reason provided'}`
          : (planReview.reason ?? 'Plan review denied the application');

        const deniedResult: PermitResult = {
          application_id,
          applicant_name: validated.applicantName,
          status: 'denied',
          denial_reason: reason,
        };

        await progress.updateStep('complete', 'denied');
        await progress.log('complete', 'Application denied by plan review', 'warn');
        await progress.setResult(deniedResult as unknown as Record<string, unknown>);

        return deniedResult;
      }

      await progress.log('plan_review', 'Plan review approved the application', 'info');
    }

    // Step 6: Site inspection via external callback
    await progress.updateStep('site_inspection', 'processing');
    await progress.log('site_inspection', 'Initiating site inspection', 'info');

    const inspectionResult = await context.waitForCallback<InspectionResult>(
      'site-inspection',
      async (callbackId) => {
        await progress.setCallbackId(callbackId);

        const inspectionEvent: InspectionEvent = {
          callbackId,
          applicationId: application_id,
          projectAddress: validated.projectAddress,
        };

        await lambdaClient.send(
          new InvokeCommand({
            FunctionName: config.siteInspectionFunctionName,
            InvocationType: 'Event',
            Payload: Buffer.from(JSON.stringify(inspectionEvent)),
          })
        );

        logger.info('Site inspection invoked', { callbackId, application_id });
      },
      { timeout: { minutes: 10 } }
    );

    await progress.clearCallbackId();
    await progress.log(
      'site_inspection',
      `Site inspection result: ${inspectionResult.inspectionPassed ? 'passed' : 'failed'}, findings: ${inspectionResult.findings.length}`,
      'info'
    );

    if (!inspectionResult.inspectionPassed) {
      const deniedResult: PermitResult = {
        application_id,
        applicant_name: validated.applicantName,
        status: 'denied',
        denial_reason: 'Failed site inspection',
      };

      await progress.updateStep('complete', 'denied');
      await progress.log('complete', 'Application denied due to site inspection failure', 'warn');
      await progress.setResult(deniedResult as unknown as Record<string, unknown>);

      return deniedResult;
    }

    // Step 7: Generate permit
    await progress.updateStep('generating_permit', 'processing');
    await progress.log('generating_permit', 'Generating permit document', 'info');

    const permit = await context.step('generate-permit', async () => {
      return generatePermit(validated.projectType, consolidation.allConditions);
    });

    await progress.log(
      'generating_permit',
      `Permit generated: ${permit.permitNumber}, expires ${permit.expiryDate}`,
      'info'
    );

    // Step 8: Issue permit
    await progress.updateStep('issuing', 'processing');
    await progress.log('issuing', 'Issuing permit', 'info');

    const result = await context.step('issue-permit', async () => {
      return issuePermit(application_id, validated.applicantName, permit, validated.projectType, validated.projectAddress);
    });

    await progress.updateStep('complete', 'approved');
    await progress.log('complete', `Permit approved and issued: ${result.permit_number}`, 'info');
    await progress.setResult(result as unknown as Record<string, unknown>);

    return result;
  }
);
