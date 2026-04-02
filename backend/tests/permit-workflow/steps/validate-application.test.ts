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
