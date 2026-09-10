import { BrowserWindow, dialog, shell } from 'electron';
import { EXPORT_EXTENSIONS } from '@shared/model/export';
import type { AppContext } from '../context';
import { handle } from './handle';
import { exportCancelSchema, exportRevealSchema, exportRunSchema } from './schemas';

export function registerExportHandlers(ctx: AppContext): void {
  handle('export:run', exportRunSchema, async (req, { sender }) => {
    const db = ctx.workspaces.db(); // fails early when no workspace is open
    const ext = EXPORT_EXTENSIONS[req.format];
    const win = BrowserWindow.fromWebContents(sender);
    const opts: Electron.SaveDialogOptions = {
      title: 'Export log entries',
      defaultPath:
        req.suggestedName ??
        `cf-logs-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.${ext}`,
      filters: [
        { name: req.format.toUpperCase(), extensions: [ext] },
        { name: 'All files', extensions: ['*'] },
      ],
    };
    const result = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts);
    if (result.canceled || !result.filePath) return { jobId: null };
    const jobId = ctx.exports.start(db, req, result.filePath);
    return { jobId, path: result.filePath };
  });
  handle('export:cancel', exportCancelSchema, ({ jobId }) => {
    ctx.exports.cancel(jobId);
  });
  handle('export:reveal', exportRevealSchema, ({ path }) => {
    shell.showItemInFolder(path);
  });
}
