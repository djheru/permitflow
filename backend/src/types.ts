// --- Project Types ---

export type ProjectType =
  | 'residential_remodel'
  | 'residential_new_construction'
  | 'commercial_renovation'
  | 'commercial_new_construction'
  | 'commercial_addition';

export interface PermitApplication {
  readonly projectType: ProjectType;
  readonly projectAddress: string;
  readonly projectDescription: string;
  readonly estimatedCost: number;
  readonly applicantName: string;
  readonly applicantPhone: string;
  readonly applicantEmail: string;
}

// --- Status Types (unchanged from loan demo) ---

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

export type LogLevel = 'info' | 'warn' | 'error' | 'replay';

export interface ProgressLogEntry {
  readonly timestamp: string;
  readonly step: string;
  readonly message: string;
  readonly level: LogLevel;
}

export interface PermitProgressItem {
  readonly application_id: string;
  readonly status: ApplicationStatus;
  readonly current_step: WorkflowStep;
  readonly applicant_name: string;
  readonly project_type: string;
  readonly project_address: string;
  readonly estimated_cost: number;
  readonly callback_id?: string;
  readonly logs: ProgressLogEntry[];
  readonly result?: PermitResult;
  readonly created_at: string;
  readonly updated_at: string;
}

// --- Agency Types ---

export type Agency = 'building_dept' | 'fire_dept' | 'zoning_board';

export type AgencyDecision = 'approved' | 'conditional' | 'denied';

export interface AgencyReview {
  readonly agency: Agency;
  readonly decision: AgencyDecision;
  readonly conditions: string[];
  readonly reviewId: string;
  readonly reviewerName: string;
}

export interface ReviewConsolidation {
  readonly overallDecision: AgencyDecision;
  readonly approvedCount: number;
  readonly conditionalCount: number;
  readonly deniedCount: number;
  readonly allConditions: string[];
  readonly reviews: AgencyReview[];
}

// --- Validation Types ---

export interface ValidatedApplication {
  readonly applicationId: string;
  readonly projectType: ProjectType;
  readonly projectAddress: string;
  readonly projectDescription: string;
  readonly estimatedCost: number;
  readonly applicantName: string;
  readonly applicantPhone: string;
  readonly applicantEmail: string;
  readonly requiresPlanReview: boolean;
}

// --- Permit Types ---

export interface PermitDocument {
  readonly permitNumber: string;
  readonly issuedDate: string;
  readonly expiryDate: string;
  readonly conditions: string[];
  readonly inspectionRequired: boolean;
}

export interface PermitResult {
  readonly application_id: string;
  readonly applicant_name: string;
  readonly status: 'approved' | 'denied';
  readonly denial_reason?: string;
  readonly permit_number?: string;
  readonly issued_date?: string;
  readonly expiry_date?: string;
  readonly conditions?: string[];
  readonly project_address?: string;
  readonly project_type?: string;
}

// --- Callback Types ---

export interface PlanReviewPayload {
  readonly approved: boolean;
  readonly revisionRequired?: boolean;
  readonly conditions?: string[];
  readonly reason?: string;
}

export interface InspectionEvent {
  readonly callbackId: string;
  readonly applicationId: string;
  readonly projectAddress: string;
}

export interface InspectionResult {
  readonly inspectionPassed: boolean;
  readonly findings: string[];
  readonly inspectorId: string;
}
