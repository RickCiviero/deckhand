import { defineConfig } from '@playwright/test';
// Shared CI runners are slow and noisy: retry twice there (a retried pass is reported as "flaky", never hidden). Locally: no retries.
export default defineConfig({ testDir: 'e2e', testMatch: '**/*.spec.ts', workers: 1, timeout: 90_000, expect: { timeout: 8000 }, reporter: [['list']], retries: process.env['CI'] ? 2 : 0 });
