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
