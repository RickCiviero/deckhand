/** User settings (Options): JSON in app data, validated on read and write. Trust Center defaults apply to each newly opened document. */
import { app, ipcMain, type IpcMainInvokeEvent } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

const fields = z.object({
  scripts: z.boolean(), // SEC-06: run deck scripts while editing
  remote: z.enum(['allow', 'block', 'ask']), // SEC-05; ask = start blocked when the deck uses external content, with a message bar to allow it: remote fonts, images and scripts
  aiEnabled: z.boolean(), // AIG-06
  aiAllowExternal: z.boolean(), // AIS-04
  aiMaxToolCalls: z.number().int().min(1).max(200), // AIT-04
  aiAskBefore: z.boolean(), // AIE-05: preview changes, apply only after "Apply"
  updates: z.enum(['notify', 'off']), // PLT-06: notify = ask GitHub once per start which release is newest; the app never downloads or installs anything
});
export type Settings = z.infer<typeof fields>;
const DEFAULTS: Settings = { scripts: true, remote: 'allow', aiEnabled: true, aiAllowExternal: false, aiMaxToolCalls: 40, aiAskBefore: false, updates: 'notify' };
// no .default() on the fields: a partial schema would fill them in and a patch would silently reset every other setting
const patchSchema = fields.partial().strict();

const file = (): string => path.join(app.getPath('userData'), 'settings.json');

/** Administrator policy (AIS-06, PLT-06): a JSON file with any of the settings above. Its values win over the user's and cannot be changed in Options. */
const policyPath = (): string => process.env['DECKHAND_POLICY_FILE']
  ?? (process.platform === 'win32' ? path.join(process.env['ProgramData'] ?? 'C:\ProgramData', 'Deckhand', 'policy.json')
    : process.platform === 'darwin' ? '/Library/Application Support/Deckhand/policy.json' : '/etc/deckhand/policy.json');
async function loadPolicy(): Promise<Partial<Settings>> {
  try { return fields.partial().strict().parse(JSON.parse(await fs.readFile(policyPath(), 'utf8'))); } catch { return {}; }
}

/** User values with the administrator policy on top; `locked` names the settings the policy fixes. */
export async function loadSettings(): Promise<Settings & { locked: string[] }> {
  let user: Settings = { ...DEFAULTS };
  try { user = { ...DEFAULTS, ...fields.partial().parse(JSON.parse(await fs.readFile(file(), 'utf8'))) }; } catch { /* defaults */ }
  const policy = await loadPolicy();
  return { ...user, ...policy, locked: Object.keys(policy) };
}

export function registerSettings(check: (e: IpcMainInvokeEvent) => void): void {
  ipcMain.handle('settings:get', async (e) => { check(e); return loadSettings(); });
  // read-modify-write is serialised: quick successive changes (several checkboxes) must not overwrite each other
  let chain: Promise<unknown> = Promise.resolve();
  ipcMain.handle('settings:set', (e, patch: unknown) => {
    check(e);
    const run = async (): Promise<Settings & { locked: string[] }> => {
      const { locked, ...cur } = await loadSettings();
      const asked = patchSchema.parse(patch);
      for (const k of locked) delete (asked as Record<string, unknown>)[k]; // the policy wins; the user's stored value for a locked key is left alone
      const next: Settings = { ...cur, ...asked };
      const stored = await fs.readFile(file(), 'utf8').then((t) => fields.partial().parse(JSON.parse(t)), () => ({}));
      await fs.writeFile(file(), JSON.stringify({ ...DEFAULTS, ...stored, ...asked }, null, 2));
      return { ...next, locked };
    };
    const p = chain.then(run, run);
    chain = p.catch(() => undefined);
    return p;
  });
}
