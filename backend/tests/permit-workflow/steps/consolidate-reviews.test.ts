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
