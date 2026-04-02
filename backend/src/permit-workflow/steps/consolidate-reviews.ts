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
