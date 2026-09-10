import { create } from 'zustand';
import { EMPTY_SELECTION, type Selection } from '../features/log-table/selection';

interface SelectionState {
  selection: Selection;
  setSelection(next: Selection | ((prev: Selection) => Selection)): void;
  clear(): void;
  /** Detail panel visibility (independent of selection so it can be closed and reopened). */
  detailOpen: boolean;
  setDetailOpen(open: boolean): void;
}

/** Ephemeral (not persisted) selection and detail panel state shared by table and detail panel. */
export const useSelectionStore = create<SelectionState>()((set) => ({
  selection: EMPTY_SELECTION,
  setSelection: (next) =>
    set((s) => {
      const selection = typeof next === 'function' ? next(s.selection) : next;
      return { selection, detailOpen: selection.focus !== null ? true : s.detailOpen };
    }),
  clear: () => set({ selection: EMPTY_SELECTION }),
  detailOpen: false,
  setDetailOpen: (detailOpen) => set({ detailOpen }),
}));
