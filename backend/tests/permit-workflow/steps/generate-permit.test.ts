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
