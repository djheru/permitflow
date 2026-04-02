import type { Agency, AgencyDecision, AgencyReview, ProjectType } from '../../types';

const DELAYS: Record<Agency, number> = {
  building_dept: 2000,
  fire_dept: 3000,
  zoning_board: 4000,
};

interface ScenarioOutcome {
  readonly decision: AgencyDecision;
  readonly conditions: string[];
}

const SCENARIOS: Record<ProjectType, Record<Agency, ScenarioOutcome>> = {
  residential_remodel: {
    building_dept: { decision: 'approved', conditions: [] },
    fire_dept: { decision: 'approved', conditions: [] },
    zoning_board: { decision: 'approved', conditions: [] },
  },
  residential_new_construction: {
    building_dept: { decision: 'conditional', conditions: ['Structural engineer review required'] },
    fire_dept: { decision: 'conditional', conditions: ['Smoke detectors per code'] },
    zoning_board: { decision: 'approved', conditions: [] },
  },
  commercial_renovation: {
    building_dept: { decision: 'conditional', conditions: ['ADA compliance review'] },
    fire_dept: { decision: 'conditional', conditions: ['Fire suppression system required'] },
    zoning_board: { decision: 'approved', conditions: [] },
  },
  commercial_new_construction: {
    building_dept: { decision: 'conditional', conditions: ['Structural engineer review required', 'Environmental impact assessment'] },
    fire_dept: { decision: 'conditional', conditions: ['Fire suppression system required', 'Emergency exit plan'] },
    zoning_board: { decision: 'conditional', conditions: ['Commercial zoning variance required'] },
  },
  commercial_addition: {
    building_dept: { decision: 'approved', conditions: [] },
    fire_dept: { decision: 'approved', conditions: [] },
    zoning_board: { decision: 'denied', conditions: ['Commercial use not permitted in residential zone'] },
  },
};

const REVIEWER_NAMES: Record<Agency, string> = {
  building_dept: 'J. Thompson, Building Inspector',
  fire_dept: 'M. Rodriguez, Fire Marshal',
  zoning_board: 'S. Patel, Zoning Administrator',
};

export const submitToAgency = async (
  agency: Agency,
  projectType: ProjectType
): Promise<AgencyReview> => {
  await new Promise((resolve) => setTimeout(resolve, DELAYS[agency]));

  const outcome = SCENARIOS[projectType]?.[agency] ?? {
    decision: 'approved' as const,
    conditions: [],
  };

  return {
    agency,
    decision: outcome.decision,
    conditions: outcome.conditions,
    reviewId: `REV-${agency.toUpperCase().slice(0, 3)}-${Date.now().toString(36)}`,
    reviewerName: REVIEWER_NAMES[agency],
  };
};
