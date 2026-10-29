import { build } from 'esbuild';
import { mkdirSync } from 'node:fs';
mkdirSync('dist', { recursive: true });
await build({
  entryPoints: ['src/index.ts'], bundle: true, minify: false, format: 'iife', target: 'chrome140',
  outfile: 'dist/agent.js', define: { __DECKHAND_TOKEN__: '__DECKHAND_TOKEN_PLACEHOLDER__' }, legalComments: 'none',
});
console.log('agent built');
