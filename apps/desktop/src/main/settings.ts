/** User settings (Options): JSON in app data, validated on read and write. Trust Center defaults apply to each newly opened document. */
import { app, ipcMain, type IpcMainInvokeEvent } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

const fields = z.object({
  scripts: z.boolean(), // SEC-06: run deck scripts while editing
  remote: z.enum(['allow', 'block']), // SEC-05: remote fonts, images and scripts
  aiEnabled: z.boolean(), // AIG-06
  aiAllowExternal: z.boolean(), // AIS-04
  aiMaxToolCalls: z.number().int().min(1).max(200), // AIT-04
});
export type Settings = z.infer<typeof fields>;
const DEFAULTS: Settings = { scripts: true, remote: 'allow', aiEnabled: true, aiAllowExternal: false, aiMaxToolCalls: 40 };
// no .default() on the fields: a partial schema would fill them in and a patch would silently reset every other setting
const patchSchema = fields.partial().strict();

const file = (): string => path.join(app.getPath('userData'), 'settings.json');

export async function loadSettings(): Promise<Settings> {
  try { return { ...DEFAULTS, ...fields.partial().parse(JSON.parse(await fs.readFile(file(), 'utf8'))) }; } catch { return { ...DEFAULTS }; }
}

export function registerSettings(check: (e: IpcMainInvokeEvent) => void): void {
  ipcMain.handle('settings:get', async (e) => { check(e); return loadSettings(); });
  // read-modify-write is serialised: quick successive changes (several checkboxes) must not overwrite each other
  let chain: Promise<unknown> = Promise.resolve();
  ipcMain.handle('settings:set', (e, patch: unknown) => {
    check(e);
    const run = async (): Promise<Settings> => {
      const next: Settings = { ...(await loadSettings()), ...patchSchema.parse(patch) };
      await fs.writeFile(file(), JSON.stringify(next, null, 2));
      return next;
    };
    const p = chain.then(run, run);
    chain = p.catch(() => undefined);
    return p;
  });
}
