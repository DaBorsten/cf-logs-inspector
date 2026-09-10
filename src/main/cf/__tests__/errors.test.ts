import {
  AuthError,
  BadResponseError,
  CancelledError,
  describeErrorBody,
  errorCode,
  ForbiddenError,
  httpStatusError,
  mapNetworkError,
  NetworkError,
  NotFoundError,
  RateLimitError,
  ServerError,
  TlsError,
} from '../errors';

const url = 'https://api.cf.example.com/v3/apps';

describe('httpStatusError', () => {
  const table: [number, string, new (...a: never[]) => Error, string][] = [
    [
      401,
      '{"errors":[{"title":"CF-NotAuthenticated","detail":"Authentication error"}]}',
      AuthError,
      'AUTH_REQUIRED',
    ],
    [
      403,
      '{"errors":[{"title":"CF-NotAuthorized","detail":"You are not authorized"}]}',
      ForbiddenError,
      'FORBIDDEN',
    ],
    [404, '', NotFoundError, 'NOT_FOUND'],
    [429, '', RateLimitError, 'RATE_LIMITED'],
    [500, 'boom', ServerError, 'SERVER_ERROR'],
    [503, '<html>maintenance</html>', ServerError, 'SERVER_ERROR'],
    [302, '', BadResponseError, 'BAD_RESPONSE'],
  ];
  it.each(table)('%d -> %s', (status, body, cls, code) => {
    const err = httpStatusError(status, body, url);
    expect(err).toBeInstanceOf(cls);
    expect(err.code).toBe(code);
    expect(err.status).toBe(status);
  });

  it('includes the CC error detail in the message', () => {
    const err = httpStatusError(
      403,
      '{"errors":[{"title":"CF-NotAuthorized","detail":"nope"}]}',
      url,
    );
    expect(err.message).toContain('CF-NotAuthorized: nope');
    expect(err.message).toContain('api.cf.example.com/v3/apps');
  });

  it('parses Retry-After seconds and dates', () => {
    const now = Date.parse('2026-09-10T10:00:00Z');
    expect(httpStatusError(429, '', url, { 'retry-after': '7' }, now).retryAfterMs).toBe(7000);
    expect(
      httpStatusError(429, '', url, { 'retry-after': 'Thu, 10 Sep 2026 10:00:30 GMT' }, now)
        .retryAfterMs,
    ).toBe(30_000);
    expect(httpStatusError(429, '', url, {}, now).retryAfterMs).toBeUndefined();
  });

  it('serialises to a plain object with code and status', () => {
    expect(JSON.parse(JSON.stringify(httpStatusError(404, '', url)))).toMatchObject({
      code: 'NOT_FOUND',
      status: 404,
    });
  });
});

describe('describeErrorBody', () => {
  const table: [string, string | undefined][] = [
    [
      '{"error":"unauthorized","error_description":"Bad credentials"}',
      'unauthorized: Bad credentials',
    ],
    ['{"error":"invalid_token"}', 'invalid_token'],
    ['{"errors":[{"title":"CF-A","detail":"x"},{"title":"CF-B"}]}', 'CF-A: x; CF-B'],
    ['{"message":"hello"}', 'hello'],
    ['plain   text\nhere', 'plain text here'],
    ['<html><body>nope</body></html>', undefined],
    ['', undefined],
    ['{"unrelated":1}', '{"unrelated":1}'],
  ];
  it.each(table)('%s', (body, expected) => {
    expect(describeErrorBody(body)).toBe(expected);
  });
});

describe('mapNetworkError', () => {
  const withCode = (code: string): Error => Object.assign(new Error(`E ${code}`), { code });
  const table: [Error, new (...a: never[]) => Error][] = [
    [withCode('ECONNREFUSED'), NetworkError],
    [withCode('ENOTFOUND'), NetworkError],
    [withCode('UND_ERR_CONNECT_TIMEOUT'), NetworkError],
    [withCode('UND_ERR_HEADERS_TIMEOUT'), NetworkError],
    [withCode('DEPTH_ZERO_SELF_SIGNED_CERT'), TlsError],
    [withCode('SELF_SIGNED_CERT_IN_CHAIN'), TlsError],
    [withCode('CERT_HAS_EXPIRED'), TlsError],
    [withCode('ERR_TLS_CERT_ALTNAME_INVALID'), TlsError],
    [withCode('ERR_SSL_WRONG_VERSION_NUMBER'), TlsError],
    [withCode('UND_ERR_ABORTED'), CancelledError],
    [Object.assign(new Error('aborted'), { name: 'AbortError' }), CancelledError],
    [new Error('mystery'), NetworkError],
  ];
  it.each(table)('$message', (err, cls) => {
    const mapped = mapNetworkError(err, url);
    expect(mapped).toBeInstanceOf(cls);
    expect(mapped.cause).toBe(err);
  });

  it('finds codes nested in the cause chain', () => {
    const inner = withCode('CERT_HAS_EXPIRED');
    const outer = new Error('fetch failed', { cause: inner });
    expect(errorCode(outer)).toBe('CERT_HAS_EXPIRED');
    expect(mapNetworkError(outer, url)).toBeInstanceOf(TlsError);
  });

  it('passes CfErrors through untouched', () => {
    const e = new NotFoundError('x');
    expect(mapNetworkError(e, url)).toBe(e);
  });
});
