import * as React from 'react';
import { Radio } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { EmptyState } from '../../components/ui/misc';
import { useConnections } from '../../queries/connections';
import { useUiStore } from '../../store/ui';

/** Placeholder until M7 delivers the connection -> org -> space -> app picker. */
export function StreamsPanel(): React.JSX.Element {
  const { data: connections } = useConnections();
  const setTab = useUiStore((s) => s.setSidePanelTab);
  const hasConnections = Boolean(connections?.length);
  return (
    <EmptyState
      icon={<Radio />}
      title="Stream picker coming next"
      description={
        hasConnections
          ? 'Selecting orgs, spaces and apps to stream arrives with the next milestone. Your connections are ready.'
          : 'Start by adding a connection and logging in. Then pick the apps whose logs you want to stream.'
      }
      action={
        hasConnections ? null : (
          <Button size="sm" variant="secondary" onClick={() => setTab('connections')}>
            Go to connections
          </Button>
        )
      }
    />
  );
}
