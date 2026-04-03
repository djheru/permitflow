import {
  LambdaClient,
  SendDurableExecutionCallbackSuccessCommand,
} from '@aws-sdk/client-lambda';
import { mockClient } from 'aws-sdk-client-mock';
import 'aws-sdk-client-mock-jest';
import type { InspectionEvent } from '../../src/types';

// Mock Powertools
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

const lambdaMock = mockClient(LambdaClient);

// Use fake timers to skip the 5s delay
jest.useFakeTimers();

describe('Site Inspection Handler', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { handler } = require('../../src/site-inspection/handler');

  beforeEach(() => {
    lambdaMock.reset();
    lambdaMock.on(SendDurableExecutionCallbackSuccessCommand).resolves({});
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  it('should process site inspection and send callback success', async () => {
    const event: InspectionEvent = {
      callbackId: 'cb-123',
      applicationId: 'PERMIT-TEST-001',
      projectAddress: '742 Evergreen Terrace',
    };

    const handlerPromise = handler(event);

    // Advance past the 5s simulated delay
    jest.advanceTimersByTime(6_000);

    await handlerPromise;

    expect(lambdaMock).toHaveReceivedCommandWith(
      SendDurableExecutionCallbackSuccessCommand,
      {
        CallbackId: 'cb-123',
        Result: expect.any(Buffer),
      }
    );

    const sentResult = lambdaMock.commandCalls(
      SendDurableExecutionCallbackSuccessCommand
    )[0].args[0].input.Result;
    const parsed = JSON.parse(Buffer.from(sentResult as Uint8Array).toString());
    expect(parsed.inspectionPassed).toBe(true);
  });

  it('should include correct inspection result fields in callback output', async () => {
    const event: InspectionEvent = {
      callbackId: 'cb-456',
      applicationId: 'PERMIT-TEST-002',
      projectAddress: '123 Main St',
    };

    const handlerPromise = handler(event);
    jest.advanceTimersByTime(6_000);
    await handlerPromise;

    const callInput = lambdaMock.commandCalls(
      SendDurableExecutionCallbackSuccessCommand
    )[0].args[0].input;

    const output = JSON.parse(Buffer.from(callInput.Result as Uint8Array).toString());
    expect(output).toEqual({
      inspectionPassed: true,
      findings: [],
      inspectorId: expect.stringMatching(/^INS-/),
    });
  });
});
