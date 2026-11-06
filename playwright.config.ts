import { defineConfig } from '@playwright/test';
// Shared CI runners are slow and noisy: retry twice there (a retried pass is reported as "flaky", never hidden). Locally: no retries.
export default defineConfig({ testDir: 'e2e', testMatch: '**/*.spec.ts', workers: 1, timeout: process.env['CI'] ? 150_000 : 90_000, // a loaded macOS runner needs over 90 s for the heaviest benchmark decks (a worker killed at the limit also fails the run during teardown)
  expect: { timeout: 8000 }, reporter: [['list']], retries: process.env['CI'] ? 2 : 0 });
