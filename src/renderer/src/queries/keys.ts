/** TanStack Query keys. Keep them here so event handlers can invalidate precisely. */
export const qk = {
  version: ['app', 'version'] as const,
  workspaces: ['workspaces'] as const,
  currentWorkspace: ['workspace', 'current'] as const,
  workspaceStats: ['workspace', 'stats'] as const,
  connections: ['connections'] as const,
  auth: (connectionId: string) => ['auth', connectionId] as const,
  sessions: ['sessions'] as const,
  orgs: (connectionId: string) => ['cf', connectionId, 'orgs'] as const,
  spaces: (connectionId: string, orgGuid: string) =>
    ['cf', connectionId, 'spaces', orgGuid] as const,
  apps: (connectionId: string, spaceGuid: string) =>
    ['cf', connectionId, 'apps', spaceGuid] as const,
  entries: ['entries'] as const,
  props: ['props'] as const,
};
