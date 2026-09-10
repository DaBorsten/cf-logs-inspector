import { createHash } from 'node:crypto';
import type { LogEnvelope } from '@shared/model/log';
import type { Level, ParsedEntry } from '@shared/model/log-entry';

const MESSAGE_KEYS = ['msg', 'message', 'text', 'log'] as const;
const LEVEL_KEYS = ['level', 'severity', 'lvl', 'loglevel', 'log_level', 'levelname'] as const;

const LEVEL_WORDS: Record<string, Level> = {
  trace: 'TRACE',
  verbose: 'TRACE',
  finest: 'TRACE',
  finer: 'TRACE',
  debug: 'DEBUG',
  fine: 'DEBUG',
  config: 'DEBUG',
  info: 'INFO',
  information: 'INFO',
  informational: 'INFO',
  notice: 'INFO',
  warn: 'WARN',
  warning: 'WARN',
  error: 'ERROR',
  err: 'ERROR',
  severe: 'ERROR',
  fatal: 'FATAL',
  critical: 'FATAL',
  crit: 'FATAL',
  alert: 'FATAL',
  emerg: 'FATAL',
  emergency: 'FATAL',
  panic: 'FATAL',
};

/** pino / bunyan numeric levels. */
const NUMERIC_LEVELS: [number, Level][] = [
  [20, 'TRACE'],
  [30, 'DEBUG'],
  [40, 'INFO'],
  [50, 'WARN'],
  [60, 'ERROR'],
  [Infinity, 'FATAL'],
];

/** Case-insensitive level word near the start of a plain-text line, e.g. `2026-.. [ERROR] ...` or `WARN: ...`. */
const TEXT_LEVEL_RE =
  /^.{0,64}?(?:^|[\s[(|:=-])(TRACE|DEBUG|INFO|WARN(?:ING)?|ERROR|SEVERE|FATAL|CRITICAL)(?=$|[\s\]):|,-])/i;

/** Maps any level-ish value (string or number) to the canonical set, or null. */
export function normalizeLevel(value: unknown): Level | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    for (const [max, level] of NUMERIC_LEVELS) if (value < max) return level;
    return 'FATAL';
  }
  if (typeof value !== 'string') return null;
  const key = value.trim().toLowerCase();
  if (!key) return null;
  const mapped = LEVEL_WORDS[key];
  if (mapped) return mapped;
  const asNumber = Number(key);
  if (Number.isFinite(asNumber) && /^\d+$/.test(key)) return normalizeLevel(asNumber);
  return null;
}

export function levelFromText(line: string): Level | null {
  const m = TEXT_LEVEL_RE.exec(line);
  return m?.[1] ? normalizeLevel(m[1]) : null;
}

/** Parses a JSON object payload; arrays and scalars are treated as plain text. */
export function tryParseJsonObject(raw: string): Record<string, unknown> | undefined {
  const s = raw.trim();
  if (s.length < 2 || s[0] !== '{' || s[s.length - 1] !== '}') return undefined;
  try {
    const v = JSON.parse(s) as unknown;
    return v && typeof v === 'object' && !Array.isArray(v)
      ? (v as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function firstString(obj: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return undefined;
}

function firstLevel(obj: Record<string, unknown>): Level | null {
  for (const k of LEVEL_KEYS) {
    if (k in obj) {
      const level = normalizeLevel(obj[k]);
      if (level) return level;
    }
  }
  return null;
}

export function hashRaw(raw: string): string {
  return createHash('sha1').update(raw).digest('hex').slice(0, 16);
}

export function parseInstance(instanceId: string): number | null {
  const n = Number.parseInt(instanceId, 10);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

/**
 * Turns a Log Cache envelope into a storable entry. Never throws: unparsable payloads become plain
 * text entries with a heuristic level.
 */
export function parseEnvelope(
  e: LogEnvelope,
  fallback: { appGuid: string; appName: string },
): ParsedEntry {
  const raw = e.payload.replace(/[\r\n]+$/, '');
  const appGuid = e.sourceId || fallback.appGuid;
  const appName = e.appName ?? fallback.appName;
  const instance = parseInstance(e.instanceId);
  const json = tryParseJsonObject(raw);
  let message: string;
  let level: Level | null;
  if (json) {
    message = firstString(json, MESSAGE_KEYS) ?? raw;
    level = firstLevel(json) ?? (message !== raw ? levelFromText(message) : null);
  } else {
    message = raw;
    level = levelFromText(raw);
  }
  return {
    tsNs: e.timestampNs,
    appGuid,
    appName,
    sourceType: e.sourceType ?? 'UNKNOWN',
    instance,
    stream: e.stream,
    message,
    level,
    isJson: json !== undefined,
    raw,
    props: json ?? null,
    dedupeKey: `${e.timestampNs}:${appGuid}:${instance ?? '-'}:${e.stream}:${hashRaw(raw)}`,
  };
}
