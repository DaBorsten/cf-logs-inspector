import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type {
  ExportDoneEvent,
  ExportFailedEvent,
  ExportProgressEvent,
  ExportRequest,
} from '@shared/model/export';
import { isCfError } from '../cf/errors';
import { noopLogger, type Logger } from '../log';
import { ExportJob } from './export';

export interface ExportManagerOptions {
  onProgress?: (ev: ExportProgressEvent) => void;
  onDone?: (ev: ExportDoneEvent) => void;
  onFailed?: (ev: ExportFailedEvent) => void;
  logger?: Logger;
}

/** Runs export jobs in the background (one promise each) and reports through push events. */
export class ExportManager {
  private readonly jobs = new Map<string, ExportJob>();
  private readonly opts: ExportManagerOptions;
  private readonly logger: Logger;

  constructor(opts: ExportManagerOptions = {}) {
    this.opts = opts;
    this.logger = opts.logger ?? noopLogger;
  }

  /** Starts a job and returns its id immediately; completion arrives via `onDone` / `onFailed`. */
  start(db: Database.Database, req: ExportRequest, path: string): string {
    const jobId = randomUUID();
    const job = new ExportJob({
      db,
      path,
      format: req.format,
      columns: req.columns,
      scope: req.scope,
      onProgress: (written, total) => this.opts.onProgress?.({ jobId, written, total }),
    });
    this.jobs.set(jobId, job);
    this.logger.info(`export ${jobId}: ${req.format} -> ${path}`);
    void job
      .run()
      .then((result) => {
        this.logger.info(`export ${jobId}: ${result.written} rows written`);
        this.opts.onDone?.({ jobId, path: result.path, written: result.written });
      })
      .catch((err: unknown) => {
        const cancelled = isCfError(err) && err.code === 'CANCELLED';
        const message = err instanceof Error ? err.message : String(err);
        if (!cancelled) this.logger.error(`export ${jobId} failed: ${message}`);
        this.opts.onFailed?.({ jobId, message, cancelled });
      })
      .finally(() => this.jobs.delete(jobId));
    return jobId;
  }

  cancel(jobId: string): boolean {
    const job = this.jobs.get(jobId);
    if (!job) return false;
    job.cancel();
    return true;
  }

  get running(): number {
    return this.jobs.size;
  }
}
