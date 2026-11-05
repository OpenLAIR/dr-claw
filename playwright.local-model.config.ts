import { defineConfig } from '@playwright/test';

// Only serve the React fixture; never start the app backend or read user settings.
export default defineConfig({
  testDir: './test',
  testMatch: 'local-model-settings.spec.ts',
  use: { baseURL: 'http://127.0.0.1:5198', browserName: 'chromium' },
  reporter: 'list',
  webServer: {
    command: 'npx vite --config test/vite.local-model.config.ts',
    url: 'http://127.0.0.1:5198',
    reuseExistingServer: false,
  },
});
