import * as React from 'react';
import { Radio } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { EmptyState, Spinner } from '../../components/ui/misc';
import { useConnections } from '../../queries/connections';
import { useCurrentWorkspace } from '../../queries/workspaces';
import { useUiStore } from '../../store/ui';
import { StreamList } from './StreamList';
import { StreamPicker } from './StreamPicker';

/** Streams tab: pick apps to stream into the open workspace and control the running streams. */
export function StreamsPanel(): React.JSX.Element {
  const { data: workspace } = useCurrentWorkspace();
  const { data: connections, isLoading } = useConnections();
  const setTab = useUiStore((s) => s.setSidePanelTab);

  if (!workspace) {
    return (
      <EmptyState
        icon={<Radio />}
        title="No workspace open"
        description="Streams store their entries in the open workspace. Open or create one first."
      />
    );
  }
  if (isLoading) {
    return (
      <div className="flex justify-center p-4">
        <Spinner />
      </div>
    );
  }
  if (!connections?.length) {
    return (
      <EmptyState
        icon={<Radio />}
        title="Add a connection to start streaming"
        description="Streams read logs from a Cloud Foundry connection. Add one and log in, then pick the apps to follow."
        action={
          <Button size="sm" variant="secondary" onClick={() => setTab('connections')}>
            Go to connections
          </Button>
        }
      />
    );
  }
  return (
    <div className="flex flex-col">
      <StreamPicker />
      <StreamList />
    </div>
  );
}
