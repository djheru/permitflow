import { Logger } from '@aws-lambda-powertools/logger';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { Metrics, MetricUnit } from '@aws-lambda-powertools/metrics';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { LambdaClient } from '@aws-sdk/client-lambda';
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { config } from '../config';
import { handleApply } from './routes/apply';
import { handleStatus } from './routes/status';
import { handleApprove } from './routes/approve';

const logger = new Logger({ serviceName: config.serviceName });
const tracer = new Tracer({ serviceName: config.serviceName });
const metrics = new Metrics({
  serviceName: config.serviceName,
  namespace: config.metricsNamespace,
});

const ddbClient = DynamoDBDocumentClient.from(
  tracer.captureAWSv3Client(new DynamoDBClient({}))
);
const lambdaClient = tracer.captureAWSv3Client(new LambdaClient({}));

const extractPathParam = (
  path: string,
  pattern: RegExp
): string | undefined => {
  const match = path.match(pattern);
  return match?.[1];
};

export const handler = async (
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> => {
  const { requestContext, rawPath, body } = event;
  const method = requestContext.http.method;

  logger.info('API request', { method, path: rawPath });
  metrics.addMetric('ApiRequests', MetricUnit.Count, 1);

  try {
    // POST /apply
    if (method === 'POST' && rawPath === '/apply') {
      metrics.addMetric('ApplicationsSubmitted', MetricUnit.Count, 1);
      return handleApply(body, ddbClient, lambdaClient, logger);
    }

    // GET /status/{applicationId}
    if (method === 'GET' && rawPath.startsWith('/status/')) {
      const applicationId = extractPathParam(rawPath, /^\/status\/(.+)$/);
      if (!applicationId) {
        return {
          statusCode: 400,
          body: JSON.stringify({ message: 'Missing applicationId' }),
        };
      }
      return handleStatus(applicationId, ddbClient, logger);
    }

    // POST /approve/{applicationId}
    if (method === 'POST' && rawPath.startsWith('/approve/')) {
      const applicationId = extractPathParam(rawPath, /^\/approve\/(.+)$/);
      if (!applicationId) {
        return {
          statusCode: 400,
          body: JSON.stringify({ message: 'Missing applicationId' }),
        };
      }
      metrics.addMetric('PlanReviewActions', MetricUnit.Count, 1);
      return handleApprove(applicationId, body, ddbClient, lambdaClient, logger);
    }

    return {
      statusCode: 404,
      body: JSON.stringify({ message: 'Route not found' }),
    };
  } catch (error) {
    logger.error('Unhandled error', { error });
    return {
      statusCode: 500,
      body: JSON.stringify({ message: 'Internal server error' }),
    };
  } finally {
    metrics.publishStoredMetrics();
  }
};
