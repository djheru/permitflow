import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import type { ApplicationStatus, LogLevel, WorkflowStep } from '../types';

const ddbClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const tableName = (): string => process.env.PROGRESS_TABLE_NAME ?? '';

export const createProgressLogger = (applicationId: string) => {
  const log = async (
    step: string,
    message: string,
    level: LogLevel,
    isReplay = false
  ): Promise<void> => {
    const effectiveLevel: LogLevel = isReplay ? 'replay' : level;
    const effectiveMessage = isReplay ? `[REPLAY] ${message}` : message;

    const entry = {
      timestamp: new Date().toISOString(),
      step,
      message: effectiveMessage,
      level: effectiveLevel,
    };

    await ddbClient.send(
      new UpdateCommand({
        TableName: tableName(),
        Key: { application_id: applicationId },
        UpdateExpression:
          'SET logs = list_append(if_not_exists(logs, :empty), :entry), updated_at = :now',
        ExpressionAttributeValues: {
          ':entry': [entry],
          ':empty': [],
          ':now': new Date().toISOString(),
        },
      })
    );
  };

  const updateStep = async (
    currentStep: WorkflowStep,
    status: ApplicationStatus
  ): Promise<void> => {
    await ddbClient.send(
      new UpdateCommand({
        TableName: tableName(),
        Key: { application_id: applicationId },
        UpdateExpression:
          'SET current_step = :step, #s = :status, updated_at = :now',
        ExpressionAttributeNames: { '#s': 'status' },
        ExpressionAttributeValues: {
          ':step': currentStep,
          ':status': status,
          ':now': new Date().toISOString(),
        },
      })
    );
  };

  const setResult = async (result: Record<string, unknown>): Promise<void> => {
    await ddbClient.send(
      new UpdateCommand({
        TableName: tableName(),
        Key: { application_id: applicationId },
        UpdateExpression: 'SET #r = :result, updated_at = :now',
        ExpressionAttributeNames: { '#r': 'result' },
        ExpressionAttributeValues: {
          ':result': result,
          ':now': new Date().toISOString(),
        },
      })
    );
  };

  const setCallbackId = async (callbackId: string): Promise<void> => {
    await ddbClient.send(
      new UpdateCommand({
        TableName: tableName(),
        Key: { application_id: applicationId },
        UpdateExpression: 'SET callback_id = :cid, updated_at = :now',
        ExpressionAttributeValues: {
          ':cid': callbackId,
          ':now': new Date().toISOString(),
        },
      })
    );
  };

  const clearCallbackId = async (): Promise<void> => {
    await ddbClient.send(
      new UpdateCommand({
        TableName: tableName(),
        Key: { application_id: applicationId },
        UpdateExpression: 'REMOVE callback_id SET updated_at = :now',
        ExpressionAttributeValues: {
          ':now': new Date().toISOString(),
        },
      })
    );
  };

  return { log, updateStep, setResult, setCallbackId, clearCallbackId };
};
