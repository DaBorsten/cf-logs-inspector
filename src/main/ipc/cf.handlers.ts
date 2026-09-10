import type { AppContext } from '../context';
import { handle } from './handle';
import { appsSchema, connectionIdSchema, spacesSchema } from './schemas';

export function registerCfHandlers(ctx: AppContext): void {
  handle('cf:orgs', connectionIdSchema, async ({ connectionId }) => {
    const rt = await ctx.connections.runtime(connectionId);
    return rt.cc.listOrgs();
  });
  handle('cf:spaces', spacesSchema, async ({ connectionId, orgGuid }) => {
    const rt = await ctx.connections.runtime(connectionId);
    return rt.cc.listSpaces(orgGuid);
  });
  handle('cf:apps', appsSchema, async ({ connectionId, spaceGuid }) => {
    const rt = await ctx.connections.runtime(connectionId);
    return rt.cc.listApps(spaceGuid);
  });
}
