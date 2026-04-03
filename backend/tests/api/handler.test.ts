import { DynamoDBDocumentClient, PutCommand, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  LambdaClient,
  InvokeCommand,
  SendDurableExecutionCallbackSuccessCommand,
} from '@aws-sdk/client-lambda';
import { mockClient } from 'aws-sdk-client-mock';
import 'aws-sdk-client-mock-jest';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';

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

jest.mock('@aws-lambda-powertools/metrics', () => ({
  Metrics: jest.fn().mockImplementation(() => ({
    addMetric: jest.fn(),
    publishStoredMetrics: jest.fn(),
  })),
  MetricUnit: { Count: 'Count' },
}));

const ddbMock = mockClient(DynamoDBDocumentClient);
const lambdaMock = mockClient(LambdaClient);

const createEvent = (
  overrides: Partial<APIGatewayProxyEventV2> & {
    method?: string;
    path?: string;
  }
): APIGatewayProxyEventV2 => {
  const method = overrides.method ?? 'GET';
  const path = overrides.path ?? '/';

  return {
    version: '2.0',
    routeKey: `${method} ${path}`,
    rawPath: path,
    rawQueryString: '',
    headers: {},
    requestContext: {
      accountId: '123456789012',
      apiId: 'testapi',
      domainName: 'test.execute-api.us-east-1.amazonaws.com',
      domainPrefix: 'test',
      http: {
        method,
        path,
        protocol: 'HTTP/1.1',
        sourceIp: '127.0.0.1',
        userAgent: 'test',
      },
      requestId: 'test-request-id',
      routeKey: `${method} ${path}`,
      stage: '$default',
      time: '01/Jan/2025:00:00:00 +0000',
      timeEpoch: 1735689600000,
    },
    body: overrides.body,
    isBase64Encoded: false,
  } as APIGatewayProxyEventV2;
};

describe('API Handler', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { handler } = require('../../src/api/handler');

  beforeEach(() => {
    ddbMock.reset();
    lambdaMock.reset();
  });

  describe('POST /apply', () => {
    it('should create an application and return 201', async () => {
      ddbMock.on(PutCommand).resolves({});
      lambdaMock.on(InvokeCommand).resolves({});

      const event = createEvent({
        method: 'POST',
        path: '/apply',
        body: JSON.stringify({
          projectType: 'residential_remodel',
          projectAddress: '742 Evergreen Terrace',
          projectDescription: 'Kitchen renovation',
          estimatedCost: 45000,
          applicantName: 'John Builder',
          applicantPhone: '555-0101',
          applicantEmail: 'john@builder.com',
        }),
      });

      const result = await handler(event);
      const body = JSON.parse(result.body);

      expect(result.statusCode).toBe(201);
      expect(body.application_id).toMatch(/^PERMIT-\d+-[a-z0-9]+$/);
      expect(body.status).toBe('submitted');
      expect(ddbMock).toHaveReceivedCommand(PutCommand);
      expect(lambdaMock).toHaveReceivedCommand(InvokeCommand);
    });

    it('should return 400 when body is missing', async () => {
      const event = createEvent({
        method: 'POST',
        path: '/apply',
      });

      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).message).toBe('Request body is required');
    });

    it('should return 400 when body has invalid JSON', async () => {
      const event = createEvent({
        method: 'POST',
        path: '/apply',
        body: 'not json',
      });

      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).message).toBe('Invalid JSON body');
    });

    it('should return 400 when required fields are missing', async () => {
      const event = createEvent({
        method: 'POST',
        path: '/apply',
        body: JSON.stringify({ applicantName: 'John', estimatedCost: 50000 }),
      });

      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).message).toContain('Missing required fields');
    });

    it('should return 400 when estimatedCost is not positive', async () => {
      const event = createEvent({
        method: 'POST',
        path: '/apply',
        body: JSON.stringify({
          projectType: 'residential_remodel',
          projectAddress: '123 Main St',
          estimatedCost: -100,
          applicantName: 'John Builder',
        }),
      });

      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).message).toContain('positive number');
    });
  });

  describe('GET /status/{applicationId}', () => {
    it('should return 200 with application data', async () => {
      const item = {
        application_id: 'PERMIT-123',
        status: 'processing',
        current_step: 'agency_review',
        applicant_name: 'John Builder',
        project_type: 'residential_remodel',
        project_address: '742 Evergreen Terrace',
        estimated_cost: 45000,
        logs: [],
        created_at: '2025-01-01T00:00:00Z',
        updated_at: '2025-01-01T00:01:00Z',
      };

      ddbMock.on(GetCommand).resolves({ Item: item });

      const event = createEvent({
        method: 'GET',
        path: '/status/PERMIT-123',
      });

      const result = await handler(event);
      const body = JSON.parse(result.body);

      expect(result.statusCode).toBe(200);
      expect(body.application_id).toBe('PERMIT-123');
      expect(body.status).toBe('processing');
    });

    it('should return 404 when application not found', async () => {
      ddbMock.on(GetCommand).resolves({ Item: undefined });

      const event = createEvent({
        method: 'GET',
        path: '/status/PERMIT-MISSING',
      });

      const result = await handler(event);

      expect(result.statusCode).toBe(404);
      expect(JSON.parse(result.body).message).toBe('Application not found');
    });
  });

  describe('POST /approve/{applicationId}', () => {
    it('should send callback and return 200', async () => {
      ddbMock.on(GetCommand).resolves({
        Item: {
          application_id: 'PERMIT-456',
          callback_id: 'cb-789',
          status: 'pending_approval',
        },
      });
      ddbMock.on(UpdateCommand).resolves({});
      lambdaMock.on(SendDurableExecutionCallbackSuccessCommand).resolves({});

      const event = createEvent({
        method: 'POST',
        path: '/approve/PERMIT-456',
        body: JSON.stringify({ approved: true }),
      });

      const result = await handler(event);
      const body = JSON.parse(result.body);

      expect(result.statusCode).toBe(200);
      expect(body.message).toContain('approved');
      expect(lambdaMock).toHaveReceivedCommand(
        SendDurableExecutionCallbackSuccessCommand
      );
      expect(ddbMock).toHaveReceivedCommand(UpdateCommand);
    });

    it('should return 404 when application not found', async () => {
      ddbMock.on(GetCommand).resolves({ Item: undefined });

      const event = createEvent({
        method: 'POST',
        path: '/approve/PERMIT-MISSING',
      });

      const result = await handler(event);

      expect(result.statusCode).toBe(404);
    });

    it('should return 400 when no callback_id is pending', async () => {
      ddbMock.on(GetCommand).resolves({
        Item: {
          application_id: 'PERMIT-456',
          status: 'processing',
        },
      });

      const event = createEvent({
        method: 'POST',
        path: '/approve/PERMIT-456',
      });

      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).message).toContain('not pending approval');
    });

    it('should default to approved:true when body is empty', async () => {
      ddbMock.on(GetCommand).resolves({
        Item: {
          application_id: 'PERMIT-456',
          callback_id: 'cb-789',
          status: 'pending_approval',
        },
      });
      ddbMock.on(UpdateCommand).resolves({});
      lambdaMock.on(SendDurableExecutionCallbackSuccessCommand).resolves({});

      const event = createEvent({
        method: 'POST',
        path: '/approve/PERMIT-456',
      });

      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body).message).toContain('approved');
    });
  });

  describe('Unknown routes', () => {
    it('should return 404 for unknown routes', async () => {
      const event = createEvent({
        method: 'GET',
        path: '/unknown',
      });

      const result = await handler(event);

      expect(result.statusCode).toBe(404);
      expect(JSON.parse(result.body).message).toBe('Route not found');
    });
  });
});
