// Generates the benchmark corpus: test-decks/decks/bench/*.html + manifest.json. Run: npm run gen:bench
// Original decks that reproduce the structures popular HTML presentation tools and hand-made decks use (see scripts/bench/*.mjs).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '..', 'test-decks', 'decks', 'bench');
mkdirSync(out, { recursive: true });
const names = ['reveal-full', 'impress-3d', 'css-only', 'scroll-story', 'canvas-stage', 'timeline-demo', 'dashboard', 'media-carousel', 'marp-svg', 'i18n-typography', 'long-deck'];
const manifest = [];
for (const n of names) {
  const d = (await import(`./bench/${n}.mjs`)).default;
  writeFileSync(join(out, d.file), d.html);
  manifest.push({ file: `bench/${d.file}`, ...d.meta });
  console.log(d.file.padEnd(26), String(d.html.length).padStart(7), 'bytes', d.meta.slides, 'slides');
}
writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
