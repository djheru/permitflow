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
