import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import type { Logger } from '@aws-lambda-powertools/logger';
import { config } from '../../config';
import type { PermitApplication, PermitProgressItem } from '../../types';

const REQUIRED_FIELDS: readonly (keyof PermitApplication)[] = [
  'projectType',
  'projectAddress',
  'estimatedCost',
  'applicantName',
] as const;

const generateApplicationId = (): string => {
  const timestamp = Date.now();
  const random = Math.random().toString(36).slice(2, 8);
  return `PERMIT-${timestamp}-${random}`;
};

export const handleApply = async (
  body: string | undefined,
  ddbClient: DynamoDBDocumentClient,
  lambdaClient: LambdaClient,
  logger: Logger
): Promise<APIGatewayProxyResultV2> => {
  if (!body) {
    return {
      statusCode: 400,
      body: JSON.stringify({ message: 'Request body is required' }),
    };
  }

  let parsed: PermitApplication;
  try {
    parsed = JSON.parse(body) as PermitApplication;
  } catch {
    return {
      statusCode: 400,
      body: JSON.stringify({ message: 'Invalid JSON body' }),
    };
  }

  const missingFields = REQUIRED_FIELDS.filter(
    (field) => parsed[field] === undefined || parsed[field] === ''
  );

  if (missingFields.length > 0) {
    return {
      statusCode: 400,
      body: JSON.stringify({
        message: `Missing required fields: ${missingFields.join(', ')}`,
      }),
    };
  }

  if (typeof parsed.estimatedCost !== 'number' || parsed.estimatedCost <= 0) {
    return {
      statusCode: 400,
      body: JSON.stringify({ message: 'estimatedCost must be a positive number' }),
    };
  }

  const applicationId = generateApplicationId();
  const now = new Date().toISOString();

  const progressItem: PermitProgressItem = {
    application_id: applicationId,
    status: 'submitted',
    current_step: 'submitted',
    applicant_name: parsed.applicantName,
    project_type: parsed.projectType,
    project_address: parsed.projectAddress,
    estimated_cost: parsed.estimatedCost,
    logs: [],
    created_at: now,
    updated_at: now,
  };

  await ddbClient.send(
    new PutCommand({
      TableName: config.progressTableName,
      Item: progressItem,
    })
  );

  logger.info('Application created', { applicationId });

  const workflowPayload = {
    application_id: applicationId,
    ...parsed,
  };

  await lambdaClient.send(
    new InvokeCommand({
      FunctionName: config.workflowFunctionName,
      InvocationType: 'Event',
      Payload: Buffer.from(JSON.stringify(workflowPayload)),
    })
  );

  logger.info('Workflow invoked', { applicationId });

  return {
    statusCode: 201,
    body: JSON.stringify({
      application_id: applicationId,
      status: 'submitted',
      message: 'Application submitted successfully',
    }),
  };
};
