import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import type { Logger } from '@aws-lambda-powertools/logger';
import { config } from '../../config';
import type { LoanProgressItem } from '../../types';

export const handleStatus = async (
  applicationId: string,
  ddbClient: DynamoDBDocumentClient,
  logger: Logger
): Promise<APIGatewayProxyResultV2> => {
  logger.info('Fetching application status', { applicationId });

  const result = await ddbClient.send(
    new GetCommand({
      TableName: config.progressTableName,
      Key: { application_id: applicationId },
    })
  );

  if (!result.Item) {
    return {
      statusCode: 404,
      body: JSON.stringify({ message: 'Application not found' }),
    };
  }

  const item = result.Item as LoanProgressItem;

  return {
    statusCode: 200,
    body: JSON.stringify(item),
  };
};
