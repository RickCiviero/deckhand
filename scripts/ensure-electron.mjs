// npm may skip dependency install scripts (npm 11 allowScripts); make sure the Electron binary is present.
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';

const require = createRequire(import.meta.url);
let pkgDir;
try { pkgDir = dirname(require.resolve('electron/package.json')); } catch { process.exit(0); }
if (!existsSync(join(pkgDir, 'dist'))) {
  console.log('Downloading the Electron binary…');
  const r = spawnSync(process.execPath, [join(pkgDir, 'install.js')], { stdio: 'inherit' });
  if (r.status !== 0) { console.warn('Electron download failed; run `node node_modules/electron/install.js` manually.'); }
}
