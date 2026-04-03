import type { ProjectType, PermitDocument } from '../../types';

const SIMULATED_DELAY_MS = 2000;
const PERMIT_VALIDITY_DAYS = 365;

const NEW_CONSTRUCTION_TYPES: readonly ProjectType[] = [
  'residential_new_construction',
  'commercial_new_construction',
] as const;

export const generatePermit = async (
  projectType: ProjectType,
  conditions: string[]
): Promise<PermitDocument> => {
  await new Promise((resolve) => setTimeout(resolve, SIMULATED_DELAY_MS));

  const now = new Date();
  const expiry = new Date(now);
  expiry.setDate(expiry.getDate() + PERMIT_VALIDITY_DAYS);

  const inspectionRequired =
    conditions.length > 0 || NEW_CONSTRUCTION_TYPES.includes(projectType);

  return {
    permitNumber: `PRM-${Date.now().toString(36).toUpperCase()}`,
    issuedDate: now.toISOString().split('T')[0],
    expiryDate: expiry.toISOString().split('T')[0],
    conditions,
    inspectionRequired,
  };
};
