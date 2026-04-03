export type ApplicationStatus =
  | 'submitted'
  | 'processing'
  | 'pending_approval'
  | 'approved'
  | 'denied'
  | 'failed';

export type WorkflowStep =
  | 'submitted'
  | 'validating'
  | 'agency_review'
  | 'review_consolidation'
  | 'plan_review'
  | 'site_inspection'
  | 'generating_permit'
  | 'issuing'
  | 'complete';

export interface ProgressLogEntry {
  timestamp: string;
  step: string;
  message: string;
  level: 'info' | 'warn' | 'error' | 'replay';
}

export interface ApplicationState {
  application_id: string;
  status: ApplicationStatus;
  current_step: WorkflowStep;
  applicant_name: string;
  project_type: string;
  project_address: string;
  estimated_cost: number;
  callback_id?: string;
  logs: ProgressLogEntry[];
  result?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface DemoProfile {
  projectType: string;
  projectAddress: string;
  projectDescription: string;
  estimatedCost: number;
  applicantName: string;
  applicantPhone: string;
  applicantEmail: string;
  label: string;
  description: string;
}

export const WORKFLOW_STEPS: WorkflowStep[] = [
  'submitted',
  'validating',
  'agency_review',
  'review_consolidation',
  'plan_review',
  'site_inspection',
  'generating_permit',
  'issuing',
  'complete',
];

export const STEP_LABELS: Record<WorkflowStep, string> = {
  submitted: 'Filed',
  validating: 'Validating',
  agency_review: 'Agency Review',
  review_consolidation: 'Consolidation',
  plan_review: 'Plan Review',
  site_inspection: 'Inspection',
  generating_permit: 'Generating',
  issuing: 'Issuing',
  complete: 'Complete',
};

export const DEMO_PROFILES: DemoProfile[] = [
  {
    projectType: 'residential_remodel',
    projectAddress: '742 Evergreen Terrace, Springfield',
    projectDescription: 'Full kitchen renovation with structural wall removal, new appliances, and updated electrical',
    estimatedCost: 45000,
    applicantName: 'John Builder',
    applicantPhone: '555-0101',
    applicantEmail: 'john@builder.com',
    label: 'Kitchen Remodel',
    description: 'Auto-approved, no plan review',
  },
  {
    projectType: 'residential_new_construction',
    projectAddress: '1600 Pennsylvania Ave, Washington DC',
    projectDescription: 'New 3-bedroom residential home with attached garage, 2400 sq ft',
    estimatedCost: 350000,
    applicantName: 'Sarah Architect',
    applicantPhone: '555-0202',
    applicantEmail: 'sarah@architect.com',
    label: 'New Home Build',
    description: 'Approved with plan review + inspection',
  },
  {
    projectType: 'commercial_addition',
    projectAddress: '100 Main St (Residential Zone), Anytown',
    projectDescription: 'Commercial office addition to existing residential property',
    estimatedCost: 200000,
    applicantName: 'Mike Developer',
    applicantPhone: '555-0303',
    applicantEmail: 'mike@developer.com',
    label: 'Commercial Expansion',
    description: 'Denied — zoning violation',
  },
];

export const TERMINAL_STATUSES: ApplicationStatus[] = ['approved', 'denied', 'failed'];
