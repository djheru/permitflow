import type { CloudFrontRequestEvent, CloudFrontRequestResult } from 'aws-lambda';

// Injected at bundle time via CDK NodejsFunction `define` option
declare const BLUE_BUCKET_DOMAIN: string;
declare const GREEN_BUCKET_DOMAIN: string;

const HEADER_NAME = 'x-blue-green-context';

export const handler = async (
  event: CloudFrontRequestEvent
): Promise<CloudFrontRequestResult> => {
  const request = event.Records[0].cf.request;

  const context = request.headers[HEADER_NAME]?.[0]?.value ?? 'blue';

  // Route to the correct bucket
  const targetDomain = context === 'green' ? GREEN_BUCKET_DOMAIN : BLUE_BUCKET_DOMAIN;

  if (request.origin?.s3) {
    request.origin.s3.domainName = targetDomain;
    request.headers['host'] = [{ key: 'host', value: targetDomain }];
  }

  return request;
};
