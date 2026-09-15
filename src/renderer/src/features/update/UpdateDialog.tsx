import * as React from 'react';
import { Download, RefreshCw, RotateCcw } from 'lucide-react';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import { errorMessage } from '../../api/client';
import {
  useAppInfo,
  useCheckForUpdate,
  useDownloadUpdate,
  useInstallUpdate,
  useUpdateStatus,
} from '../../queries/update';

export interface UpdateDialogProps {
  open: boolean;
  onOpenChange(open: boolean): void;
}

export function UpdateDialog({ open, onOpenChange }: UpdateDialogProps): React.JSX.Element {
  const { data: info } = useAppInfo();
  const { data: status } = useUpdateStatus(open);
  const check = useCheckForUpdate();
  const download = useDownloadUpdate();
  const install = useInstallUpdate();

  const state = status?.state ?? 'idle';
  const busy = check.isPending || state === 'checking' || state === 'downloading';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>About cf-log-inspector</DialogTitle>
          <DialogDescription>Version and update information.</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Installed version</span>
            <span className="font-medium">{info ? `v${info.version}` : '…'}</span>
          </div>

          {info && !info.packaged ? (
            <p className="text-xs text-muted-foreground">
              This is a development build; update checks are disabled.
            </p>
          ) : (
            <UpdateStatusRow
              status={status}
              checkError={check.error}
              downloadError={download.error}
            />
          )}
        </div>

        <DialogFooter>
          {state === 'downloaded' ? (
            <Button onClick={() => install.mutate()} loading={install.isPending}>
              <RotateCcw /> Restart &amp; install
            </Button>
          ) : state === 'available' ? (
            <Button onClick={() => download.mutate()} loading={download.isPending}>
              <Download /> Download update
            </Button>
          ) : (
            <Button
              variant="outline"
              onClick={() => check.mutate()}
              loading={busy}
              disabled={!info?.packaged}
            >
              <RefreshCw /> Check for updates
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function UpdateStatusRow({
  status,
  checkError,
  downloadError,
}: {
  status: { state: string; version?: string; percent?: number; message?: string } | undefined;
  checkError: unknown;
  downloadError: unknown;
}): React.JSX.Element {
  const state = status?.state ?? 'idle';
  if (checkError || downloadError || state === 'error') {
    return (
      <div className="flex items-center justify-between">
        <span className="text-muted-foreground">Status</span>
        <Badge variant="destructive">
          {errorMessage(checkError ?? downloadError) || status?.message || 'Update check failed'}
        </Badge>
      </div>
    );
  }
  switch (state) {
    case 'checking':
      return <StatusLine label="Status" value={<Badge variant="secondary">Checking…</Badge>} />;
    case 'available':
      return (
        <StatusLine
          label="Status"
          value={
            <Badge variant="warning">
              Update available{status?.version ? `: v${status.version}` : ''}
            </Badge>
          }
        />
      );
    case 'downloading':
      return (
        <StatusLine
          label="Status"
          value={<Badge variant="secondary">Downloading… {status?.percent ?? 0}%</Badge>}
        />
      );
    case 'downloaded':
      return (
        <StatusLine
          label="Status"
          value={
            <Badge variant="success">
              Ready to install{status?.version ? `: v${status.version}` : ''}
            </Badge>
          }
        />
      );
    case 'not-available':
      return <StatusLine label="Status" value={<Badge variant="muted">Up to date</Badge>} />;
    default:
      return <StatusLine label="Status" value={<Badge variant="muted">Not checked</Badge>} />;
  }
}

function StatusLine({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      {value}
    </div>
  );
}
