import { create } from 'zustand';
import { EMPTY_SELECTION, type Selection } from '../features/log-table/selection';

interface SelectionState {
  selection: Selection;
  setSelection(next: Selection | ((prev: Selection) => Selection)): void;
  clear(): void;
  /** Detail panel visibility (independent of selection so it can be closed and reopened). */
  detailOpen: boolean;
  /**
   * Once the user has manually toggled `detailOpen` (closing or reopening it), selection changes
   * stop auto-opening the panel; only the explicit toggle controls visibility from then on.
   */
  detailAutoOpenDisabled: boolean;
  setDetailOpen(open: boolean): void;
}

/** Ephemeral (not persisted) selection and detail panel state shared by table and detail panel. */
export const useSelectionStore = create<SelectionState>()((set) => ({
  selection: EMPTY_SELECTION,
  setSelection: (next) =>
    set((s) => {
      const selection = typeof next === 'function' ? next(s.selection) : next;
      const autoOpen = selection.focus !== null && !s.detailAutoOpenDisabled;
      return { selection, detailOpen: autoOpen ? true : s.detailOpen };
    }),
  clear: () => set({ selection: EMPTY_SELECTION }),
  detailOpen: false,
  detailAutoOpenDisabled: false,
  setDetailOpen: (detailOpen) => set({ detailOpen, detailAutoOpenDisabled: true }),
}));
