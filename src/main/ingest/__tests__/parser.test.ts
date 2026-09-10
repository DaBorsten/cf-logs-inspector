import type { LogEnvelope } from '@shared/model/log';
import { levelFromText, normalizeLevel, parseEnvelope, tryParseJsonObject } from '../parser';

const env = (payload: string, over: Partial<LogEnvelope> = {}): LogEnvelope => ({
  timestampNs: '1757500000000000000',
  sourceId: 'app-1',
  instanceId: '0',
  appName: 'api',
  sourceType: 'APP/PROC/WEB',
  stream: 'OUT',
  payload,
  tags: {},
  ...over,
});
const fallback = { appGuid: 'fallback-guid', appName: 'fallback-app' };

describe('normalizeLevel', () => {
  it.each<[unknown, string | null]>([
    ['info', 'INFO'],
    ['INFO', 'INFO'],
    [' Warning ', 'WARN'],
    ['warn', 'WARN'],
    ['err', 'ERROR'],
    ['SEVERE', 'ERROR'],
    ['critical', 'FATAL'],
    ['emerg', 'FATAL'],
    ['trace', 'TRACE'],
    ['fine', 'DEBUG'],
    ['notice', 'INFO'],
    [10, 'TRACE'],
    [20, 'DEBUG'],
    [30, 'INFO'],
    [40, 'WARN'],
    [50, 'ERROR'],
    [60, 'FATAL'],
    ['50', 'ERROR'],
    ['verbose', 'TRACE'],
    ['nope', null],
    ['', null],
    [null, null],
    [{}, null],
  ])('%j -> %s', (input, expected) => {
    expect(normalizeLevel(input)).toBe(expected);
  });
});

describe('levelFromText', () => {
  it.each<[string, string | null]>([
    ['2026-09-10T10:00:00.000Z ERROR Something broke', 'ERROR'],
    ['[WARN] disk almost full', 'WARN'],
    ['INFO: started', 'INFO'],
    ['10:00:00.123 [main] DEBUG c.s.Foo - hi', 'DEBUG'],
    ['WARNING - deprecated', 'WARN'],
    ['level=error msg=x', 'ERROR'],
    ['Information for you', null],
    ['this has no level marker at all', null],
    ['GET /info 200', null],
    ['x'.repeat(80) + ' ERROR too late', null],
  ])('%s -> %s', (line, expected) => {
    expect(levelFromText(line)).toBe(expected);
  });
});

describe('tryParseJsonObject', () => {
  it.each<[string, boolean]>([
    ['{"a":1}', true],
    ['  {"a":1}\n', true],
    ['[1,2]', false],
    ['"str"', false],
    ['{broken', false],
    ['', false],
    ['{}', true],
  ])('%s -> %s', (raw, isObj) => {
    expect(tryParseJsonObject(raw) !== undefined).toBe(isObj);
  });
});

describe('parseEnvelope', () => {
  it('parses a JSON app log', () => {
    const e = parseEnvelope(
      env('{"level":"warn","msg":"cache miss","tenant":"t1","meta":{"n":1},"tags":["a"]}\n'),
      fallback,
    );
    expect(e).toMatchObject({
      tsNs: '1757500000000000000',
      appGuid: 'app-1',
      appName: 'api',
      sourceType: 'APP/PROC/WEB',
      instance: 0,
      stream: 'OUT',
      message: 'cache miss',
      level: 'WARN',
      isJson: true,
      raw: '{"level":"warn","msg":"cache miss","tenant":"t1","meta":{"n":1},"tags":["a"]}',
    });
    expect(e.props).toEqual({
      level: 'warn',
      msg: 'cache miss',
      tenant: 't1',
      meta: { n: 1 },
      tags: ['a'],
    });
    expect(e.dedupeKey).toMatch(/^1757500000000000000:app-1:0:OUT:[0-9a-f]{16}$/);
  });

  it('prefers msg, then message, text, log for the message', () => {
    expect(parseEnvelope(env('{"message":"m","text":"t"}'), fallback).message).toBe('m');
    expect(parseEnvelope(env('{"text":"t","log":"l"}'), fallback).message).toBe('t');
    expect(parseEnvelope(env('{"log":"l"}'), fallback).message).toBe('l');
    expect(parseEnvelope(env('{"other":"x"}'), fallback).message).toBe('{"other":"x"}');
  });

  it('reads levels from severity/lvl and numeric pino levels, falling back to the message text', () => {
    expect(parseEnvelope(env('{"severity":"ERROR","msg":"x"}'), fallback).level).toBe('ERROR');
    expect(parseEnvelope(env('{"lvl":30,"msg":"x"}'), fallback).level).toBe('INFO');
    expect(parseEnvelope(env('{"msg":"WARN something"}'), fallback).level).toBe('WARN');
    expect(parseEnvelope(env('{"msg":"plain"}'), fallback).level).toBeNull();
    expect(parseEnvelope(env('{"level":"bogus","msg":"plain"}'), fallback).level).toBeNull();
  });

  it('parses plain text logs with heuristic level and trimmed newlines', () => {
    const e = parseEnvelope(
      env('2026-09-10 10:00 [ERROR] boom\r\n', { stream: 'ERR', instanceId: '3' }),
      fallback,
    );
    expect(e).toMatchObject({
      message: '2026-09-10 10:00 [ERROR] boom',
      raw: '2026-09-10 10:00 [ERROR] boom',
      level: 'ERROR',
      isJson: false,
      props: null,
      instance: 3,
      stream: 'ERR',
    });
  });

  it('handles RTR lines, missing tags and non-numeric instances', () => {
    const e = parseEnvelope(
      env('api.example.com - [2026-09-10T10:00:00Z] "GET /health HTTP/1.1" 200 0 2', {
        instanceId: 'router-a',
        sourceType: 'RTR',
      }),
      fallback,
    );
    expect(e.level).toBeNull();
    expect(e.instance).toBeNull();
    expect(e.sourceType).toBe('RTR');
    expect(e.dedupeKey).toContain(':-:OUT:');
    const noTags = parseEnvelope(env('x', { sourceId: '', instanceId: '' }), fallback);
    expect(noTags.appGuid).toBe('fallback-guid');
    expect(noTags.sourceType).toBe('APP/PROC/WEB');
    const bare: LogEnvelope = {
      timestampNs: '1',
      sourceId: 'app-1',
      instanceId: '0',
      stream: 'OUT',
      payload: 'x',
      tags: {},
    };
    const noName = parseEnvelope(bare, fallback);
    expect(noName.appName).toBe('fallback-app');
    expect(noName.sourceType).toBe('UNKNOWN');
  });

  it('dedupe keys differ by content, instance and stream but not by app name', () => {
    const a = parseEnvelope(env('same'), fallback).dedupeKey;
    expect(parseEnvelope(env('same', { appName: 'renamed' }), fallback).dedupeKey).toBe(a);
    expect(parseEnvelope(env('same\n'), fallback).dedupeKey).toBe(a);
    expect(parseEnvelope(env('other'), fallback).dedupeKey).not.toBe(a);
    expect(parseEnvelope(env('same', { instanceId: '1' }), fallback).dedupeKey).not.toBe(a);
    expect(parseEnvelope(env('same', { stream: 'ERR' }), fallback).dedupeKey).not.toBe(a);
  });
});
