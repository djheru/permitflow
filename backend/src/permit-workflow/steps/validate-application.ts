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
