import { Logger } from '@aws-lambda-powertools/logger';
import { Tracer } from '@aws-lambda-powertools/tracer';
import {
  LambdaClient,
  SendDurableExecutionCallbackSuccessCommand,
} from '@aws-sdk/client-lambda';
import { config } from '../config';
import type { InspectionEvent, InspectionResult } from '../types';

const logger = new Logger({ serviceName: config.serviceName });
const tracer = new Tracer({ serviceName: config.serviceName });
const lambdaClient = tracer.captureAWSv3Client(new LambdaClient({}));

const SIMULATED_DELAY_MS = 5_000;

export const handler = async (event: InspectionEvent): Promise<void> => {
  logger.info('Site inspection started', {
    applicationId: event.applicationId,
    projectAddress: event.projectAddress,
    callbackId: event.callbackId,
  });

  // Simulate processing delay
  await new Promise((resolve) => setTimeout(resolve, SIMULATED_DELAY_MS));

  const inspectionResult: InspectionResult = {
    inspectionPassed: true,
    findings: [],
    inspectorId: `INS-${Date.now().toString(36)}`,
  };

  logger.info('Site inspection completed', {
    applicationId: event.applicationId,
    result: inspectionResult,
  });

  await lambdaClient.send(
    new SendDurableExecutionCallbackSuccessCommand({
      CallbackId: event.callbackId,
      Result: Buffer.from(JSON.stringify(inspectionResult)),
    })
  );

  logger.info('Callback sent successfully', {
    callbackId: event.callbackId,
  });
};
