import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Theme = 'light' | 'dark' | 'system';
export type SidePanelTab = 'streams' | 'sessions' | 'connections';
export type ConnectionEditor = { mode: 'create' } | { mode: 'edit'; id: string };
export type DetailTab = 'message' | 'table' | 'json' | 'raw';

export interface StreamPickerState {
  connectionId: string | null;
  orgGuid: string | null;
  spaceGuid: string | null;
  recent: boolean;
}

interface UiState {
  theme: Theme;
  setTheme(theme: Theme): void;
  sidePanelTab: SidePanelTab;
  setSidePanelTab(tab: SidePanelTab): void;
  sidePanelOpen: boolean;
  toggleSidePanel(): void;
  /** Connection id whose login dialog is open. */
  loginConnectionId: string | null;
  openLogin(connectionId: string): void;
  closeLogin(): void;
  connectionEditor: ConnectionEditor | null;
  openConnectionEditor(editor: ConnectionEditor): void;
  closeConnectionEditor(): void;
  workspaceDialogOpen: boolean;
  setWorkspaceDialogOpen(open: boolean): void;
  /** Tab the detail panel opens on; falls back to `message` when an entry has no parsed JSON. */
  defaultDetailTab: DetailTab;
  setDefaultDetailTab(tab: DetailTab): void;
  /** Last connection/org/space chosen in the streams picker (survives tab switches and restarts). */
  streamPicker: StreamPickerState;
  setStreamPicker(patch: Partial<StreamPickerState>): void;
}

export const initialStreamPicker: StreamPickerState = {
  connectionId: null,
  orgGuid: null,
  spaceGuid: null,
  recent: true,
};

/**
 * Renderer-only UI state. `theme`, the side panel and the picker selection persist in localStorage for
 * now; the plan moves global preferences to `<userData>/config.json` via a `settings:*` IPC in M12.
 */
export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      theme: 'system',
      setTheme: (theme) => set({ theme }),
      sidePanelTab: 'connections',
      setSidePanelTab: (sidePanelTab) => set({ sidePanelTab, sidePanelOpen: true }),
      sidePanelOpen: true,
      toggleSidePanel: () => set((s) => ({ sidePanelOpen: !s.sidePanelOpen })),
      loginConnectionId: null,
      openLogin: (loginConnectionId) => set({ loginConnectionId }),
      closeLogin: () => set({ loginConnectionId: null }),
      connectionEditor: null,
      openConnectionEditor: (connectionEditor) => set({ connectionEditor }),
      closeConnectionEditor: () => set({ connectionEditor: null }),
      workspaceDialogOpen: false,
      setWorkspaceDialogOpen: (workspaceDialogOpen) => set({ workspaceDialogOpen }),
      defaultDetailTab: 'table',
      setDefaultDetailTab: (defaultDetailTab) => set({ defaultDetailTab }),
      streamPicker: initialStreamPicker,
      setStreamPicker: (patch) => set((s) => ({ streamPicker: { ...s.streamPicker, ...patch } })),
    }),
    {
      name: 'cf-log-inspector.ui',
      partialize: (s) => ({
        theme: s.theme,
        sidePanelTab: s.sidePanelTab,
        sidePanelOpen: s.sidePanelOpen,
        defaultDetailTab: s.defaultDetailTab,
        streamPicker: s.streamPicker,
      }),
    },
  ),
);
