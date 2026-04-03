import { useState, useEffect, useRef } from 'react';
import type { FormEvent } from 'react';
import {
  DEMO_PROFILES,
  WORKFLOW_STEPS,
  STEP_LABELS,
  TERMINAL_STATUSES,
} from './types';
import type { ApplicationState, DemoProfile } from './types';

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

const PROJECT_TYPE_OPTIONS = [
  { value: 'residential_remodel', label: 'Residential Remodel' },
  { value: 'residential_new_construction', label: 'Residential New Construction' },
  { value: 'commercial_renovation', label: 'Commercial Renovation' },
  { value: 'commercial_new_construction', label: 'Commercial New Construction' },
  { value: 'commercial_addition', label: 'Commercial Addition' },
];

interface FormData {
  projectType: string;
  projectAddress: string;
  projectDescription: string;
  estimatedCost: string;
  applicantName: string;
  applicantPhone: string;
  applicantEmail: string;
}

const EMPTY_FORM: FormData = {
  projectType: '',
  projectAddress: '',
  projectDescription: '',
  estimatedCost: '',
  applicantName: '',
  applicantPhone: '',
  applicantEmail: '',
};

const PROFILE_COLORS: Record<number, string> = {
  0: 'profile-green',
  1: 'profile-blue',
  2: 'profile-red',
};

const App = () => {
  const [form, setForm] = useState<FormData>(EMPTY_FORM);
  const [applicationId, setApplicationId] = useState<string | null>(null);
  const [applicationState, setApplicationState] = useState<ApplicationState | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showLogs, setShowLogs] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [approveSending, setApproveSending] = useState(false);
  const logEndRef = useRef<HTMLDivElement>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isTerminal = applicationState
    ? TERMINAL_STATUSES.includes(applicationState.status)
    : false;
  const isPolling = applicationId !== null && applicationState !== null && !isTerminal;

  // Poll for status updates
  useEffect(() => {
    if (!isPolling) {
      return;
    }

    intervalRef.current = setInterval(async () => {
      try {
        const res = await fetch(`${API_URL}/status/${applicationId}`);
        if (res.ok) {
          const data = (await res.json()) as ApplicationState;
          setApplicationState(data);
        }
      } catch {
        // Silently retry on network errors
      }
    }, 2000);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [applicationId, isPolling]);

  // Auto-scroll debug logs
  useEffect(() => {
    if (showLogs && logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [applicationState?.logs?.length, showLogs]);

  const fillProfile = (profile: DemoProfile) => {
    setForm({
      projectType: profile.projectType,
      projectAddress: profile.projectAddress,
      projectDescription: profile.projectDescription,
      estimatedCost: String(profile.estimatedCost),
      applicantName: profile.applicantName,
      applicantPhone: profile.applicantPhone,
      applicantEmail: profile.applicantEmail,
    });
    setApplicationId(null);
    setApplicationState(null);
    setError(null);
  };

  const resetForm = () => {
    setForm(EMPTY_FORM);
    setApplicationId(null);
    setApplicationState(null);
    setError(null);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const res = await fetch(`${API_URL}/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_type: form.projectType,
          project_address: form.projectAddress,
          project_description: form.projectDescription,
          estimated_cost: parseFloat(form.estimatedCost),
          applicant_name: form.applicantName,
          applicant_phone: form.applicantPhone,
          applicant_email: form.applicantEmail,
        }),
      });

      const data = (await res.json()) as { application_id?: string; error?: string };

      if (!res.ok) {
        setError(data.error ?? 'Submission failed');
        setIsSubmitting(false);
        return;
      }

      const id = data.application_id!;
      setApplicationId(id);
      setApplicationState({
        application_id: id,
        status: 'submitted',
        current_step: 'submitted',
        applicant_name: form.applicantName,
        project_type: form.projectType,
        project_address: form.projectAddress,
        estimated_cost: parseFloat(form.estimatedCost),
        logs: [
          {
            timestamp: new Date().toISOString(),
            step: 'submitted',
            message: 'Permit application received',
            level: 'info',
          },
        ],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
    } catch {
      setError('Network error — is the API running?');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePlanReview = async (decision: 'approve' | 'revision' | 'deny') => {
    setApproveSending(true);
    try {
      let body: Record<string, unknown>;
      if (decision === 'approve') {
        body = { approved: true };
      } else if (decision === 'revision') {
        body = { approved: false, revisionRequired: true };
      } else {
        body = { approved: false };
      }

      const res = await fetch(`${API_URL}/approve/${applicationId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        setError(data.error ?? 'Plan review request failed');
      }
    } catch {
      setError('Network error sending plan review decision');
    } finally {
      setApproveSending(false);
    }
  };

  const currentStepIndex = applicationState
    ? WORKFLOW_STEPS.indexOf(applicationState.current_step)
    : -1;

  const needsPlanReview = applicationState?.status === 'pending_approval';

  const formatProjectType = (type: string): string => {
    const option = PROJECT_TYPE_OPTIONS.find((o) => o.value === type);
    return option?.label ?? type;
  };

  const hasRevisionResult =
    applicationState?.result && applicationState.result.revisionRequired === true;

  return (
    <div className="app">
      <header>
        <h1>PermitFlow</h1>
        <p className="subtitle">Building Permit Tracker</p>
      </header>

      <main>
        {/* Demo Profile Cards */}
        <section className="profiles">
          <h2>Demo Profiles</h2>
          <div className="profile-buttons">
            {DEMO_PROFILES.map((p, i) => (
              <button
                key={p.projectType}
                className={`profile-btn ${PROFILE_COLORS[i] ?? ''}`}
                onClick={() => fillProfile(p)}
                disabled={isSubmitting || isPolling}
              >
                <span className="profile-name">{p.label}</span>
                <span className="profile-desc">{p.description}</span>
              </button>
            ))}
          </div>
        </section>

        {/* Application Form */}
        <section className="form-section">
          <h2>Permit Application</h2>
          <form onSubmit={handleSubmit}>
            <div className="form-grid">
              <label>
                Project Type
                <select
                  value={form.projectType}
                  onChange={(e) => setForm({ ...form, projectType: e.target.value })}
                  required
                  disabled={isSubmitting || isPolling}
                >
                  <option value="">Select project type...</option>
                  {PROJECT_TYPE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Project Address
                <input
                  type="text"
                  value={form.projectAddress}
                  onChange={(e) => setForm({ ...form, projectAddress: e.target.value })}
                  required
                  disabled={isSubmitting || isPolling}
                />
              </label>
              <label className="full-width">
                Project Description
                <textarea
                  value={form.projectDescription}
                  onChange={(e) => setForm({ ...form, projectDescription: e.target.value })}
                  rows={3}
                  disabled={isSubmitting || isPolling}
                />
              </label>
              <label>
                Estimated Cost ($)
                <input
                  type="number"
                  value={form.estimatedCost}
                  onChange={(e) => setForm({ ...form, estimatedCost: e.target.value })}
                  min="1"
                  required
                  disabled={isSubmitting || isPolling}
                />
              </label>
              <label>
                Applicant Name
                <input
                  type="text"
                  value={form.applicantName}
                  onChange={(e) => setForm({ ...form, applicantName: e.target.value })}
                  required
                  disabled={isSubmitting || isPolling}
                />
              </label>
              <label>
                Phone
                <input
                  type="text"
                  value={form.applicantPhone}
                  onChange={(e) => setForm({ ...form, applicantPhone: e.target.value })}
                  disabled={isSubmitting || isPolling}
                />
              </label>
              <label>
                Email
                <input
                  type="email"
                  value={form.applicantEmail}
                  onChange={(e) => setForm({ ...form, applicantEmail: e.target.value })}
                  disabled={isSubmitting || isPolling}
                />
              </label>
            </div>

            {error && <p className="error">{error}</p>}

            <div className="form-actions">
              <button
                type="submit"
                className="submit-btn"
                disabled={isSubmitting || isPolling}
              >
                {isSubmitting ? 'Submitting...' : 'Submit Application'}
              </button>
              {applicationState && isTerminal && (
                <button type="button" className="reset-btn" onClick={resetForm}>
                  New Application
                </button>
              )}
            </div>
          </form>
        </section>

        {/* Step Tracker */}
        {applicationState && (
          <section className="status-section">
            <h2>Application Status</h2>
            <p className="app-id">ID: {applicationState.application_id}</p>

            <div className="steps">
              {WORKFLOW_STEPS.map((step, i) => {
                let state: 'pending' | 'completed' | 'active' = 'pending';
                if (i < currentStepIndex) {
                  state = 'completed';
                } else if (i === currentStepIndex) {
                  state = isTerminal ? 'completed' : 'active';
                }

                return (
                  <div key={step} className={`step ${state}`}>
                    <div className="step-indicator">
                      {state === 'completed' ? (
                        <span className="check">&#10003;</span>
                      ) : state === 'active' ? (
                        <span className="spinner" />
                      ) : (
                        <span className="dot" />
                      )}
                    </div>
                    <span className="step-label">{STEP_LABELS[step]}</span>
                  </div>
                );
              })}
            </div>

            {/* Approved Result */}
            {applicationState.status === 'approved' && applicationState.result && (
              <div className="result approved">
                <h3>PERMIT APPROVED</h3>
                <div className="result-details">
                  {applicationState.result.permit_number != null && (
                    <p>
                      <strong>Permit Number:</strong>{' '}
                      {String(applicationState.result.permit_number)}
                    </p>
                  )}
                  <p>
                    <strong>Project Address:</strong>{' '}
                    {applicationState.project_address}
                  </p>
                  {applicationState.result.issued_date != null && (
                    <p>
                      <strong>Issued Date:</strong>{' '}
                      {String(applicationState.result.issued_date)}
                    </p>
                  )}
                  {applicationState.result.expiry_date != null && (
                    <p>
                      <strong>Expiry Date:</strong>{' '}
                      {String(applicationState.result.expiry_date)}
                    </p>
                  )}
                  {Array.isArray(applicationState.result.conditions) &&
                    (applicationState.result.conditions as string[]).length > 0 && (
                      <div className="conditions">
                        <strong>Conditions:</strong>
                        <ul>
                          {(applicationState.result.conditions as string[]).map(
                            (condition, i) => (
                              <li key={i}>{condition}</li>
                            )
                          )}
                        </ul>
                      </div>
                    )}
                </div>
              </div>
            )}

            {/* Denied Result */}
            {applicationState.status === 'denied' && applicationState.result && !hasRevisionResult && (
              <div className="result denied">
                <h3>PERMIT DENIED</h3>
                <div className="result-details">
                  {applicationState.result.reason != null && (
                    <p>
                      <strong>Reason:</strong>{' '}
                      {String(applicationState.result.reason)}
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* Revision Required Result */}
            {hasRevisionResult && (
              <div className="result revision-result">
                <h3>REVISION REQUIRED</h3>
                <div className="result-details">
                  {applicationState.result?.reason != null && (
                    <p>
                      <strong>Reason:</strong>{' '}
                      {String(applicationState.result.reason)}
                    </p>
                  )}
                  <p>
                    Please revise and resubmit your application with the requested changes.
                  </p>
                </div>
              </div>
            )}

            {/* Failed Result */}
            {applicationState.status === 'failed' && (
              <div className="result failed">
                <h3>FAILED</h3>
                <p>The workflow encountered an error.</p>
              </div>
            )}
          </section>
        )}

        {/* Plan Review Modal */}
        {needsPlanReview && (
          <div className="modal-overlay">
            <div className="modal">
              <h3>Plan Review Required</h3>
              <div className="modal-summary">
                <p>
                  <strong>Project Type:</strong>{' '}
                  {formatProjectType(form.projectType)}
                </p>
                <p>
                  <strong>Address:</strong> {form.projectAddress}
                </p>
                <p>
                  <strong>Estimated Cost:</strong> $
                  {Number(form.estimatedCost).toLocaleString()}
                </p>
              </div>
              <p className="modal-subtext">
                The workflow is suspended and waiting for your plan review decision.
              </p>
              <div className="modal-actions modal-actions-three">
                <button
                  className="approve-btn"
                  onClick={() => handlePlanReview('approve')}
                  disabled={approveSending}
                >
                  {approveSending ? 'Sending...' : 'Approve Plans'}
                </button>
                <button
                  className="revision-btn"
                  onClick={() => handlePlanReview('revision')}
                  disabled={approveSending}
                >
                  Request Revision
                </button>
                <button
                  className="deny-btn"
                  onClick={() => handlePlanReview('deny')}
                  disabled={approveSending}
                >
                  Deny
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Debug Logs Panel */}
        {applicationState && (
          <section className="logs-section">
            <div className="logs-header">
              <h2>Debug Logs</h2>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={showLogs}
                  onChange={(e) => setShowLogs(e.target.checked)}
                />
                <span>Show Logs</span>
              </label>
            </div>

            {showLogs && applicationState.logs && (
              <div className="log-panel">
                {applicationState.logs.map((log, i) => (
                  <div key={i} className={`log-entry log-${log.level}`}>
                    <span className="log-ts">
                      {new Date(log.timestamp).toLocaleTimeString()}
                    </span>
                    <span className="log-step">[{log.step}]</span>
                    <span className="log-msg">{log.message}</span>
                  </div>
                ))}
                <div ref={logEndRef} />
              </div>
            )}
          </section>
        )}
      </main>
    </div>
  );
};

export default App;
