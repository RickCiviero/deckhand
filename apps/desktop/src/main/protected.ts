/** Protected View: files that came from the internet (Windows Mark of the Web, macOS quarantine) open with scripts and remote content off and no editing until the user allows it. */
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';

export async function fromInternet(file: string): Promise<boolean> {
  if (process.env['DECKHAND_FORCE_PROTECTED'] === '1') return true; // tests
  try {
    if (process.platform === 'win32') {
      const zone = await fs.readFile(`${file}:Zone.Identifier`, 'utf8');
      return Number(/ZoneId\s*=\s*(\d)/.exec(zone)?.[1] ?? 0) >= 3;
    }
    if (process.platform === 'darwin') {
      return await new Promise<boolean>((resolve) => execFile('/usr/bin/xattr', ['-p', 'com.apple.quarantine', file], { timeout: 3000 }, (err, out) => resolve(!err && out.trim().length > 0)));
    }
  } catch { /* no mark: a normal file */ }
  return false;
}
