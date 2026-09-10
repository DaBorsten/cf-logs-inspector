import * as React from 'react';
import { CheckCircle2, FolderOpen, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import {
  EXPORT_FIXED_COLUMNS,
  type ExportFormat,
  type ExportRequest,
  type ExportScope,
} from '@shared/model/export';
import type { PropInfo } from '@shared/model/query';
import { errorMessage, invoke } from '../../api/client';
import { useApiEvent } from '../../api/useApiEvent';
import { Button } from '../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import { formatCount } from '../../lib/utils';
import { FIXED_COLUMNS, PROP_PREFIX, type ColumnLayout } from '../log-table/columns';

export interface ExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Filter scope of the table (session ids, dql, time, sort, snapshot). */
  scope: ExportScope;
  /** Rows matching the scope within the snapshot. */
  total: number;
  selectedIds: number[];
  loadedIds: number[];
  layout: ColumnLayout;
  props: PropInfo[];
}

type ScopeChoice = 'all' | 'selected' | 'loaded';
type ColumnChoice = 'visible' | 'all';
type Phase =
  | { kind: 'idle' }
  | { kind: 'running'; jobId: string; path: string; written: number; total: number }
  | { kind: 'done'; path: string; written: number }
  | { kind: 'failed'; message: string; cancelled: boolean };

const FORMATS: { value: ExportFormat; label: string; hint: string }[] = [
  {
    value: 'ndjson',
    label: 'NDJSON',
    hint: 'One JSON object per line; streams well into other tools.',
  },
  { value: 'json', label: 'JSON array', hint: 'A single JSON array of objects.' },
  {
    value: 'csv',
    label: 'CSV',
    hint: 'Comma separated with a header row; nested values as JSON text.',
  },
];

/** Maps table layout column ids to export columns (visible order, or everything). */
export function exportColumns(
  choice: ColumnChoice,
  layout: ColumnLayout,
  props: PropInfo[],
): string[] {
  if (choice === 'visible') return [...layout.order];
  return [...EXPORT_FIXED_COLUMNS.map((c) => c.id), ...props.map((p) => `${PROP_PREFIX}${p.key}`)];
}

export function ExportDialog(props: ExportDialogProps): React.JSX.Element {
  const { open, onOpenChange, scope, total, selectedIds, loadedIds, layout } = props;
  const [format, setFormat] = React.useState<ExportFormat>('ndjson');
  const [scopeChoice, setScopeChoice] = React.useState<ScopeChoice>('all');
  const [columnChoice, setColumnChoice] = React.useState<ColumnChoice>('visible');
  const [phase, setPhase] = React.useState<Phase>({ kind: 'idle' });

  React.useEffect(() => {
    if (open) setPhase({ kind: 'idle' });
  }, [open]);
  React.useEffect(() => {
    if (selectedIds.length === 0 && scopeChoice === 'selected') setScopeChoice('all');
  }, [selectedIds.length, scopeChoice]);

  useApiEvent('export:progress', (ev) => {
    setPhase((p) =>
      p.kind === 'running' && p.jobId === ev.jobId
        ? { ...p, written: ev.written, total: ev.total }
        : p,
    );
  });
  useApiEvent('export:done', (ev) => {
    setPhase((p) =>
      p.kind === 'running' && p.jobId === ev.jobId
        ? { kind: 'done', path: ev.path, written: ev.written }
        : p,
    );
  });
  useApiEvent('export:failed', (ev) => {
    setPhase((p) =>
      p.kind === 'running' && p.jobId === ev.jobId
        ? { kind: 'failed', message: ev.message, cancelled: ev.cancelled }
        : p,
    );
  });

  const counts: Record<ScopeChoice, number> = {
    all: total,
    selected: selectedIds.length,
    loaded: loadedIds.length,
  };

  const start = async (): Promise<void> => {
    const columns = exportColumns(columnChoice, layout, props.props);
    const req: ExportRequest = {
      format,
      columns,
      scope:
        scopeChoice === 'all'
          ? scope
          : { ids: scopeChoice === 'selected' ? selectedIds : loadedIds },
    };
    try {
      const started = await invoke('export:run', req);
      if (!started.jobId || !started.path) return; // save dialog cancelled
      setPhase({
        kind: 'running',
        jobId: started.jobId,
        path: started.path,
        written: 0,
        total: counts[scopeChoice],
      });
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const cancel = (): void => {
    if (phase.kind === 'running') void invoke('export:cancel', { jobId: phase.jobId });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => phase.kind !== 'running' && onOpenChange(o)}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Export entries</DialogTitle>
          <DialogDescription>
            Writes the entries to a file of your choice. Large exports stream in the background.
          </DialogDescription>
        </DialogHeader>

        {phase.kind === 'idle' ? (
          <div className="flex flex-col gap-4 text-xs">
            <fieldset className="flex flex-col gap-1.5">
              <legend className="mb-1 font-medium">Format</legend>
              {FORMATS.map((f) => (
                <label key={f.value} className="flex items-start gap-2">
                  <input
                    type="radio"
                    name="export-format"
                    value={f.value}
                    checked={format === f.value}
                    onChange={() => setFormat(f.value)}
                  />
                  <span>
                    <span className="font-medium">{f.label}</span>
                    <span className="ml-2 text-muted-foreground">{f.hint}</span>
                  </span>
                </label>
              ))}
            </fieldset>
            <fieldset className="flex flex-col gap-1.5">
              <legend className="mb-1 font-medium">Rows</legend>
              {(
                [
                  ['all', 'All entries matching the current query'],
                  ['selected', 'Selected rows'],
                  ['loaded', 'Rows loaded in the table'],
                ] as [ScopeChoice, string][]
              ).map(([value, label]) => (
                <label key={value} className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="export-scope"
                    value={value}
                    checked={scopeChoice === value}
                    disabled={value === 'selected' && selectedIds.length === 0}
                    onChange={() => setScopeChoice(value)}
                  />
                  <span>{label}</span>
                  <span className="text-muted-foreground">({formatCount(counts[value])})</span>
                </label>
              ))}
            </fieldset>
            <fieldset className="flex flex-col gap-1.5">
              <legend className="mb-1 font-medium">Columns</legend>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="export-columns"
                  checked={columnChoice === 'visible'}
                  onChange={() => setColumnChoice('visible')}
                />
                Visible columns (
                {layout.order
                  .map(
                    (c) =>
                      FIXED_COLUMNS.find((f) => f.id === c)?.label ?? c.replace(PROP_PREFIX, ''),
                  )
                  .join(', ')}
                )
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="export-columns"
                  checked={columnChoice === 'all'}
                  onChange={() => setColumnChoice('all')}
                />
                All fields including raw line and every discovered property (
                {EXPORT_FIXED_COLUMNS.length + props.props.length})
              </label>
            </fieldset>
          </div>
        ) : phase.kind === 'running' ? (
          <div className="flex flex-col gap-2 text-xs" role="status">
            <p className="truncate font-mono text-muted-foreground" title={phase.path}>
              {phase.path}
            </p>
            <div className="h-2 overflow-hidden rounded bg-muted">
              <div
                className="h-full bg-primary transition-[width]"
                style={{
                  width: `${phase.total > 0 ? Math.min(100, (phase.written / phase.total) * 100) : 0}%`,
                }}
              />
            </div>
            <p>
              {formatCount(phase.written)} of {formatCount(phase.total)} entries written…
            </p>
          </div>
        ) : phase.kind === 'done' ? (
          <div
            className="flex items-start gap-2 rounded-md border border-success/40 bg-success/10 p-3 text-xs"
            role="status"
          >
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
            <div className="min-w-0">
              <p className="font-medium">Exported {formatCount(phase.written)} entries</p>
              <p className="truncate font-mono text-muted-foreground" title={phase.path}>
                {phase.path}
              </p>
            </div>
          </div>
        ) : (
          <div
            className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs"
            role="alert"
          >
            <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
            <p>
              {phase.cancelled ? 'Export cancelled; the partial file was removed.' : phase.message}
            </p>
          </div>
        )}

        <DialogFooter>
          {phase.kind === 'idle' ? (
            <>
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button onClick={() => void start()} disabled={counts[scopeChoice] === 0}>
                Export {formatCount(counts[scopeChoice])} entries…
              </Button>
            </>
          ) : phase.kind === 'running' ? (
            <Button variant="destructive" onClick={cancel}>
              Cancel export
            </Button>
          ) : (
            <>
              {phase.kind === 'done' ? (
                <Button
                  variant="outline"
                  onClick={() => void invoke('export:reveal', { path: phase.path })}
                >
                  <FolderOpen /> Reveal in folder
                </Button>
              ) : (
                <Button variant="outline" onClick={() => setPhase({ kind: 'idle' })}>
                  Back
                </Button>
              )}
              <Button onClick={() => onOpenChange(false)}>Done</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
