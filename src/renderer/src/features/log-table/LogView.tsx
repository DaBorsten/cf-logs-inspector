import * as React from 'react';
import { QueryInput } from '../query-bar/QueryInput';
import { LogTable } from './LogTable';

/** Main area of an open workspace: query bar above the virtualized log table. */
export function LogView(): React.JSX.Element {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <QueryInput />
      <div className="min-h-0 flex-1">
        <LogTable />
      </div>
    </div>
  );
}
