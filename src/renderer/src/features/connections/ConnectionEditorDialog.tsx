import * as React from 'react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import { useConnections } from '../../queries/connections';
import { useUiStore } from '../../store/ui';
import { ConnectionForm } from './ConnectionForm';

export function ConnectionEditorDialog(): React.JSX.Element {
  const editor = useUiStore((s) => s.connectionEditor);
  const close = useUiStore((s) => s.closeConnectionEditor);
  const { data: connections } = useConnections();
  const initial =
    editor?.mode === 'edit' ? connections?.find((c) => c.id === editor.id) : undefined;
  const open = editor !== null && (editor.mode === 'create' || initial !== undefined);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent size="md" className="max-h-[90vh]">
        <DialogHeader>
          <DialogTitle>
            {initial ? `Edit connection: ${initial.name}` : 'Add connection'}
          </DialogTitle>
          <DialogDescription>
            Where to reach Cloud Foundry and how to log in. Tokens are stored encrypted; passwords
            never.
          </DialogDescription>
        </DialogHeader>
        {open ? (
          <ConnectionForm
            key={initial?.id ?? 'new'}
            {...(initial ? { initial } : {})}
            onCancel={close}
            onSaved={(profile) => {
              toast.success(
                initial
                  ? `Connection "${profile.name}" saved`
                  : `Connection "${profile.name}" added`,
              );
              close();
            }}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
