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
