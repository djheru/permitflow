import type { CloudFrontRequestEvent, CloudFrontRequestResult } from 'aws-lambda';

const HEADER_NAME = 'x-blue-green-context';

/**
 * Routes the request to the correct S3 bucket by swapping the color segment
 * ("blue"/"green") in the default origin's domain name. The domain comes from
 * the CloudFront event at runtime — no compile-time injection needed.
 */
export const handler = async (
  event: CloudFrontRequestEvent
): Promise<CloudFrontRequestResult> => {
  const request = event.Records[0].cf.request;

  const context = request.headers[HEADER_NAME]?.[0]?.value ?? 'blue';

  if (request.origin?.s3) {
    const currentDomain = request.headers.host[0].value;
    const targetColor = context === 'green' ? 'green' : 'blue';
    const oppositeColor = targetColor === 'blue' ? 'green' : 'blue';
    const targetDomain = currentDomain.replace(oppositeColor, targetColor);

    request.origin.s3.domainName = targetDomain;
    request.headers.host = [{ key: 'host', value: targetDomain }];
  }

  return request;
};
