import type { CloudFrontRequestEvent, CloudFrontRequestResult } from 'aws-lambda';

const BLUE_GREEN_RATIO = 0.8;
const COOKIE_NAME = 'x-blue-green-context';
const HEADER_NAME = 'x-blue-green-context';
const QUERY_PARAM = 'blue_green';

type BlueGreenContext = 'blue' | 'green';

const parseCookies = (cookieHeader: string): Record<string, string> => {
  const cookies: Record<string, string> = {};
  cookieHeader.split(';').forEach((cookie) => {
    const [key, ...rest] = cookie.trim().split('=');
    if (key) cookies[key] = rest.join('=');
  });
  return cookies;
};

const getContextFromQueryString = (querystring: string): BlueGreenContext | undefined => {
  const params = new URLSearchParams(querystring);
  const value = params.get(QUERY_PARAM);
  if (value === 'blue' || value === 'green') return value;
  return undefined;
};

const getContextFromHeader = (
  headers: Record<string, Array<{ value: string }>>
): BlueGreenContext | undefined => {
  const header = headers[HEADER_NAME]?.[0]?.value;
  if (header === 'blue' || header === 'green') return header;
  return undefined;
};

const getContextFromCookie = (
  headers: Record<string, Array<{ value: string }>>
): BlueGreenContext | undefined => {
  const cookieHeader = headers['cookie']?.[0]?.value;
  if (!cookieHeader) return undefined;

  const cookies = parseCookies(cookieHeader);
  const value = cookies[COOKIE_NAME]?.split('_')[0];
  if (value === 'blue' || value === 'green') return value;
  return undefined;
};

const hasFileExtension = (uri: string): boolean => {
  const lastSegment = uri.split('/').pop() ?? '';
  return lastSegment.includes('.');
};

export const handler = async (
  event: CloudFrontRequestEvent
): Promise<CloudFrontRequestResult> => {
  const request = event.Records[0].cf.request;
  const headers = request.headers;

  // Determine context: query > header > cookie > random
  const context =
    getContextFromQueryString(request.querystring) ??
    getContextFromHeader(headers) ??
    getContextFromCookie(headers) ??
    (Math.random() < BLUE_GREEN_RATIO ? 'blue' : 'green');

  // Inject header for downstream (origin-request)
  request.headers[HEADER_NAME] = [{ key: HEADER_NAME, value: context }];

  // For non-file URIs, set cookie via 302 redirect for session stickiness
  if (!hasFileExtension(request.uri)) {
    const timestamp = Date.now();
    const cookieValue = `${context}_${timestamp}`;

    // Only redirect if no cookie already set
    if (!getContextFromCookie(headers)) {
      const queryString = request.querystring ? `?${request.querystring}` : '';
      return {
        status: '302',
        statusDescription: 'Found',
        headers: {
          location: [{ key: 'Location', value: `${request.uri}${queryString}` }],
          'set-cookie': [
            {
              key: 'Set-Cookie',
              value: `${COOKIE_NAME}=${cookieValue}; Path=/; Secure; HttpOnly; SameSite=Lax`,
            },
          ],
          'cache-control': [{ key: 'Cache-Control', value: 'no-cache' }],
        },
      };
    }
  }

  return request;
};
