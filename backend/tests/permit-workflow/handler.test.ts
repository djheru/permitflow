import { LocalDurableTestRunner } from '@aws/durable-execution-sdk-js-testing';
import { handler } from '../../src/permit-workflow/handler';
import type { PermitResult } from '../../src/types';

// Mock the progress logger to avoid DynamoDB calls
jest.mock('../../src/shared/progress-logger', () => ({
  createProgressLogger: () => ({
    log: jest.fn().mockResolvedValue(undefined),
    updateStep: jest.fn().mockResolvedValue(undefined),
    setResult: jest.fn().mockResolvedValue(undefined),
    setCallbackId: jest.fn().mockResolvedValue(undefined),
    clearCallbackId: jest.fn().mockResolvedValue(undefined),
  }),
}));

// Mock the Lambda client used for site inspection invocation
jest.mock('@aws-sdk/client-lambda', () => {
  const actual = jest.requireActual('@aws-sdk/client-lambda');
  return {
    ...actual,
    LambdaClient: jest.fn().mockImplementation(() => ({
      send: jest.fn().mockResolvedValue({}),
    })),
  };
});

// Mock Powertools to avoid side effects
jest.mock('@aws-lambda-powertools/logger', () => ({
  Logger: jest.fn().mockImplementation(() => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    addContext: jest.fn(),
  })),
}));

jest.mock('@aws-lambda-powertools/tracer', () => ({
  Tracer: jest.fn().mockImplementation(() => ({
    captureAWSv3Client: jest.fn((client: unknown) => client),
    getSegment: jest.fn(),
    setSegment: jest.fn(),
    addAnnotation: jest.fn(),
    addMetadata: jest.fn(),
  })),
}));

describe('Permit Workflow Handler', () => {
  let runner: LocalDurableTestRunner<PermitResult>;

  beforeAll(async () => {
    await LocalDurableTestRunner.setupTestEnvironment({ skipTime: true });
  }, 30_000);

  afterAll(async () => {
    await LocalDurableTestRunner.teardownTestEnvironment();
  }, 30_000);

  beforeEach(() => {
    runner = new LocalDurableTestRunner<PermitResult>({ handlerFunction: handler });
  });

  afterEach(() => {
    runner.reset();
  });

  it('should deny a commercial_addition permit when zoning denies', async () => {
    const input = {
      application_id: 'PERMIT-TEST-DENY',
      projectType: 'commercial_addition' as const,
      projectAddress: '100 Industrial Blvd',
      projectDescription: 'Adding commercial wing to residential building',
      estimatedCost: 250000,
      applicantName: 'Jane Contractor',
      applicantPhone: '555-0303',
      applicantEmail: 'jane@contractor.com',
    };

    const result = await runner.run({ payload: input });
    const output = result.getResult();

    expect(output).toBeDefined();
    expect(output!.status).toBe('denied');
    expect(output!.application_id).toBe('PERMIT-TEST-DENY');
    expect(output!.applicant_name).toBe('Jane Contractor');
    expect(output!.denial_reason).toContain('Agency review denied');
  }, 120_000);
});
