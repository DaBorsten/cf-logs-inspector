import type { EntryCountQuery, SortSpec } from './query';

export type ExportFormat = 'ndjson' | 'json' | 'csv';

/** Column ids as used by the table layout: fixed names plus `p:<key>` for JSON properties. */
export type ExportColumn = string;

export const EXPORT_FIXED_COLUMNS: readonly { id: string; label: string }[] = [
  { id: 'id', label: 'Entry id' },
  { id: 'timestamp', label: 'Timestamp (ISO, UTC)' },
  { id: 'ts_ns', label: 'Timestamp (ns)' },
  { id: 'session', label: 'Session id' },
  { id: 'app', label: 'App' },
  { id: 'app_guid', label: 'App GUID' },
  { id: 'source_type', label: 'Source type' },
  { id: 'instance', label: 'Instance' },
  { id: 'stream', label: 'Stream' },
  { id: 'level', label: 'Level' },
  { id: 'message', label: 'Message' },
  { id: 'raw', label: 'Raw line' },
];

export interface ExportScope extends EntryCountQuery {
  sort?: SortSpec[];
  /** Explicit entry ids (selected rows); when set the other filters are ignored. */
  ids?: number[];
}

export interface ExportRequest {
  format: ExportFormat;
  columns: ExportColumn[];
  scope: ExportScope;
  /** File name suggested in the save dialog. */
  suggestedName?: string;
}

/** `export:run` result: `jobId` is null when the user cancelled the save dialog. */
export interface ExportStarted {
  jobId: string | null;
  path?: string;
}

export interface ExportProgressEvent {
  jobId: string;
  written: number;
  total: number;
}

export interface ExportDoneEvent {
  jobId: string;
  path: string;
  written: number;
}

export interface ExportFailedEvent {
  jobId: string;
  message: string;
  cancelled: boolean;
}

export const EXPORT_EXTENSIONS: Record<ExportFormat, string> = {
  ndjson: 'ndjson',
  json: 'json',
  csv: 'csv',
};
