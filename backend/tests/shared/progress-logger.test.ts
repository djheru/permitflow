import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { createProgressLogger } from '../../src/shared/progress-logger';

const ddbMock = mockClient(DynamoDBDocumentClient);

beforeEach(() => {
  ddbMock.reset();
  process.env.PROGRESS_TABLE_NAME = 'test-table';
});

describe('createProgressLogger', () => {
  it('should log a progress entry to DynamoDB', async () => {
    ddbMock.on(UpdateCommand).resolves({});

    const logger = createProgressLogger('APP-123');
    await logger.log('validating', 'Application validated successfully', 'info');

    const call = ddbMock.commandCalls(UpdateCommand)[0];
    expect(call.args[0].input.TableName).toBe('test-table');
    expect(call.args[0].input.Key).toEqual({ application_id: 'APP-123' });
    expect(call.args[0].input.ExpressionAttributeValues?.[':entry']).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          step: 'validating',
          message: 'Application validated successfully',
          level: 'info',
        }),
      ])
    );
  });

  it('should update current_step and status', async () => {
    ddbMock.on(UpdateCommand).resolves({});

    const logger = createProgressLogger('APP-123');
    await logger.updateStep('credit_check', 'processing');

    const call = ddbMock.commandCalls(UpdateCommand)[0];
    expect(call.args[0].input.ExpressionAttributeValues?.[':step']).toBe('credit_check');
    expect(call.args[0].input.ExpressionAttributeValues?.[':status']).toBe('processing');
  });

  it('should detect replay and tag log entries', async () => {
    ddbMock.on(UpdateCommand).resolves({});

    const logger = createProgressLogger('APP-123');
    await logger.log('validating', 'Replayed step', 'info', true);

    const call = ddbMock.commandCalls(UpdateCommand)[0];
    const entry = call.args[0].input.ExpressionAttributeValues?.[':entry'][0];
    expect(entry.level).toBe('replay');
    expect(entry.message).toContain('[REPLAY]');
  });
});
