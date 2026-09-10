import * as React from 'react';
import { RowDetailPanel } from '../detail/RowDetailPanel';
import { QueryBar } from '../query-bar/QueryBar';
import { LogTable } from './LogTable';

/** Main area of an open workspace: query bar, virtualized log table, detail panel for the focused row. */
export function LogView(): React.JSX.Element {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <QueryBar />
      <div className="min-h-0 flex-1">
        <LogTable />
      </div>
      <RowDetailPanel />
    </div>
  );
}
