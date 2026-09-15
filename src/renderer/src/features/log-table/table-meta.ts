import type { RowData } from '@tanstack/react-table';

/** Extra data the table passes to cell renderers (see `useReactTable({ meta })`). */
declare module '@tanstack/react-table' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface TableMeta<TData extends RowData> {
    /** Regexes highlighting query literals in message cells. */
    highlightTerms?: RegExp[];
    /** Whether a given (rowId, columnId) multiline cell is expanded to show all its lines. */
    isExpanded?: (rowId: string, columnId: string) => boolean;
    /** Toggles the expanded state of a (rowId, columnId) multiline cell. */
    toggleExpanded?: (rowId: string, columnId: string) => void;
  }
}

export {};
