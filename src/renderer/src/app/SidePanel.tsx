import * as React from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { ConnectionsPanel } from '../features/connections/ConnectionsPanel';
import { SessionsPanel } from '../features/sessions/SessionsPanel';
import { StreamsPanel } from '../features/streams/StreamsPanel';
import { useUiStore, type SidePanelTab } from '../store/ui';

export function SidePanel(): React.JSX.Element {
  const tab = useUiStore((s) => s.sidePanelTab);
  const setTab = useUiStore((s) => s.setSidePanelTab);
  return (
    <aside className="flex w-80 shrink-0 flex-col border-r bg-card">
      <Tabs
        value={tab}
        onValueChange={(v) => setTab(v as SidePanelTab)}
        className="flex min-h-0 flex-1 flex-col"
      >
        <div className="border-b p-2">
          <TabsList className="w-full">
            <TabsTrigger value="streams">Streams</TabsTrigger>
            <TabsTrigger value="sessions">Sessions</TabsTrigger>
            <TabsTrigger value="connections">Connections</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="streams" className="min-h-0 flex-1 overflow-auto">
          <StreamsPanel />
        </TabsContent>
        <TabsContent value="sessions" className="min-h-0 flex-1 overflow-auto">
          <SessionsPanel />
        </TabsContent>
        <TabsContent value="connections" className="min-h-0 flex-1 overflow-auto">
          <ConnectionsPanel />
        </TabsContent>
      </Tabs>
    </aside>
  );
}
