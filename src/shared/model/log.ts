/**
 * One Log Cache LOG envelope after decoding. Timestamps are nanosecond int64 values and stay decimal
 * strings everywhere (BigInt in main when arithmetic is needed); never convert them to Number.
 */
export interface LogEnvelope {
  /** Nanoseconds since epoch, decimal string. */
  timestampNs: string;
  /** App GUID (Log Cache `source_id`). */
  sourceId: string;
  /** Instance index as reported by Log Cache (`instance_id`), often "0", "1", ... */
  instanceId: string;
  /** `tags.app_name` when present. */
  appName?: string;
  /** `tags.source_type`, e.g. `APP/PROC/WEB`, `RTR`, `CELL`, `STG`, `API`. */
  sourceType?: string;
  /** Log Cache `log.type`: stdout or stderr. */
  stream: 'OUT' | 'ERR';
  /** Decoded (UTF-8) payload, untrimmed. */
  payload: string;
  /** All envelope tags as delivered. */
  tags: Record<string, string>;
}
