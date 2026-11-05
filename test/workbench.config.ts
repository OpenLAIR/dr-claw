import { defineConfig } from '@playwright/test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
export default defineConfig({
  outputDir: join(tmpdir(), 'dr-claw-workbench-check', 'test-results'),
  testDir: '.', testMatch: 'workbench.spec.ts', workers: 1, timeout: 30000,
  reporter: 'list', use: { baseURL: process.env.WORKBENCH_URL || 'http://localhost:5145', channel: 'chrome', screenshot: 'only-on-failure' },
});
