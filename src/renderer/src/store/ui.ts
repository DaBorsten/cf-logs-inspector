import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Theme = 'light' | 'dark' | 'system';
export type SidePanelTab = 'streams' | 'sessions' | 'connections';
export type ConnectionEditor = { mode: 'create' } | { mode: 'edit'; id: string };

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
}

/**
 * Renderer-only UI state. `theme` and the side panel tab persist in localStorage for now; the plan
 * moves global preferences to `<userData>/config.json` via a `settings:*` IPC in M12.
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
    }),
    {
      name: 'cf-log-inspector.ui',
      partialize: (s) => ({
        theme: s.theme,
        sidePanelTab: s.sidePanelTab,
        sidePanelOpen: s.sidePanelOpen,
      }),
    },
  ),
);
