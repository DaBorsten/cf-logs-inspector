import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { startMockCf, unusedPort, type MockCf } from '../../../../test/fixtures/mock-cf';
import {
  BadResponseError,
  NetworkError,
  RateLimitError,
  ServerError,
  TlsError,
  CancelledError,
} from '../errors';
import { HttpClient } from '../http';

const tlsDir = resolve(__dirname, '../../../../test/fixtures/tls');
const cert = readFileSync(resolve(tlsDir, 'cert.pem'), 'utf8');
const key = readFileSync(resolve(tlsDir, 'key.pem'), 'utf8');

const linksSchema = z.object({ links: z.record(z.string(), z.unknown()) });

describe('HttpClient over plain http', () => {
  let cf: MockCf;
  let http: HttpClient;
  beforeAll(async () => {
    cf = await startMockCf();
    http = new HttpClient();
  });
  afterAll(async () => {
    await http.close();
    await cf.close();
  });

  it('returns raw responses from send()', async () => {
    const res = await http.send({ url: `${cf.apiUrl}/` });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/json');
    expect(JSON.parse(res.text)).toHaveProperty('links');
  });

  it('sends default headers and the bearer token', async () => {
    await http.send({
      url: `${cf.apiUrl}/v3/organizations`,
      token: 'tok',
      headers: { 'X-Custom': '1' },
    });
    const req = cf.requestsTo('/v3/organizations').at(-1)!;
    expect(req.headers.authorization).toBe('Bearer tok');
    expect(req.headers.accept).toBe('application/json');
    expect(req.headers['user-agent']).toBe('cf-log-inspector');
    expect(req.headers['x-custom']).toBe('1');
  });

  it('json() validates the body against the schema', async () => {
    const body = await http.json({ url: `${cf.apiUrl}/` }, linksSchema);
    expect(Object.keys(body.links)).toContain('uaa');
    await expect(
      http.json({ url: `${cf.apiUrl}/` }, z.object({ nope: z.string() })),
    ).rejects.toBeInstanceOf(BadResponseError);
  });

  it('json() maps non-2xx statuses', async () => {
    cf.state.failNextCc = {
      status: 503,
      body: '{"errors":[{"title":"CF-Down","detail":"later"}]}',
    };
    await expect(http.json({ url: `${cf.apiUrl}/v3/apps` }, z.unknown())).rejects.toMatchObject({
      code: 'SERVER_ERROR',
      status: 503,
      message: expect.stringContaining('CF-Down: later'),
    });
    cf.state.failNextCc = { status: 429, headers: { 'retry-after': '3' } };
    const err = await http
      .json({ url: `${cf.apiUrl}/v3/apps` }, z.unknown())
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RateLimitError);
    expect((err as RateLimitError).retryAfterMs).toBe(3000);
  });

  it('json() rejects non-JSON 2xx bodies', async () => {
    cf.state.notCf = true;
    await expect(http.json({ url: `${cf.apiUrl}/` }, z.unknown())).rejects.toBeInstanceOf(
      BadResponseError,
    );
    cf.state.notCf = false;
  });

  it('maps connection refused to NetworkError', async () => {
    const port = await unusedPort();
    await expect(http.send({ url: `http://127.0.0.1:${port}/` })).rejects.toBeInstanceOf(
      NetworkError,
    );
  });

  it('honours abort signals', async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(http.send({ url: `${cf.apiUrl}/`, signal: ac.signal })).rejects.toBeInstanceOf(
      CancelledError,
    );
  });

  it('classifies a 5xx via json() as ServerError with the status', async () => {
    cf.state.failNextCc = { status: 500, body: 'oops' };
    const err = await http
      .json({ url: `${cf.apiUrl}/v3/apps` }, z.unknown())
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ServerError);
    expect((err as ServerError).details).toBe('oops');
  });
});

describe('HttpClient TLS options', () => {
  let cf: MockCf;
  beforeAll(async () => {
    cf = await startMockCf({ tls: { cert, key } });
  });
  afterAll(async () => {
    await cf.close();
  });

  it('rejects the self-signed certificate by default', async () => {
    const http = new HttpClient();
    try {
      const err = await http.send({ url: `${cf.apiUrl}/` }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(TlsError);
      expect((err as TlsError).message).toMatch(/SELF_SIGNED|DEPTH_ZERO/);
    } finally {
      await http.close();
    }
  });

  it('accepts it with skipSslValidation', async () => {
    const http = new HttpClient({ skipSslValidation: true });
    try {
      expect((await http.send({ url: `${cf.apiUrl}/` })).status).toBe(200);
    } finally {
      await http.close();
    }
  });

  it('accepts it when the CA is trusted explicitly', async () => {
    const http = new HttpClient({ caCertPem: cert });
    try {
      expect((await http.send({ url: `${cf.apiUrl}/` })).status).toBe(200);
    } finally {
      await http.close();
    }
  });

  it('maps plain-http-to-https mismatches to TlsError', async () => {
    const plain = await startMockCf();
    const http = new HttpClient();
    try {
      const err = await http
        .send({ url: plain.apiUrl.replace('http://', 'https://') })
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(TlsError);
    } finally {
      await http.close();
      await plain.close();
    }
  });
});
