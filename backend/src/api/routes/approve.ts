import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import {
  LambdaClient,
  SendDurableExecutionCallbackSuccessCommand,
} from '@aws-sdk/client-lambda';
import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import type { Logger } from '@aws-lambda-powertools/logger';
import { config } from '../../config';
import type { PermitProgressItem, PlanReviewPayload } from '../../types';

export const handleApprove = async (
  applicationId: string,
  body: string | undefined,
  ddbClient: DynamoDBDocumentClient,
  lambdaClient: LambdaClient,
  logger: Logger
): Promise<APIGatewayProxyResultV2> => {
  logger.info('Processing plan review', { applicationId });

  // Read the current item to get callbackId
  const getResult = await ddbClient.send(
    new GetCommand({
      TableName: config.progressTableName,
      Key: { application_id: applicationId },
    })
  );

  if (!getResult.Item) {
    return {
      statusCode: 404,
      body: JSON.stringify({ message: 'Application not found' }),
    };
  }

  const item = getResult.Item as PermitProgressItem;

  if (!item.callback_id) {
    return {
      statusCode: 400,
      body: JSON.stringify({ message: 'Application is not pending approval' }),
    };
  }

  let approvalPayload: PlanReviewPayload = { approved: true };
  if (body) {
    try {
      approvalPayload = JSON.parse(body) as PlanReviewPayload;
    } catch {
      return {
        statusCode: 400,
        body: JSON.stringify({ message: 'Invalid JSON body' }),
      };
    }
  }

  // Send callback to resume the durable workflow
  await lambdaClient.send(
    new SendDurableExecutionCallbackSuccessCommand({
      CallbackId: item.callback_id,
      Result: Buffer.from(JSON.stringify(approvalPayload)),
    })
  );

  logger.info('Callback sent for plan review', {
    applicationId,
    callbackId: item.callback_id,
    approved: approvalPayload.approved,
  });

  // Clear the callbackId from DDB
  await ddbClient.send(
    new UpdateCommand({
      TableName: config.progressTableName,
      Key: { application_id: applicationId },
      UpdateExpression: 'REMOVE callback_id SET updated_at = :now',
      ExpressionAttributeValues: {
        ':now': new Date().toISOString(),
      },
    })
  );

  return {
    statusCode: 200,
    body: JSON.stringify({
      message: approvalPayload.approved
        ? 'Application approved by plan review'
        : 'Application denied by plan review',
      application_id: applicationId,
    }),
  };
};
