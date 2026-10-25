import { defineConfig } from './apps/web/node_modules/@playwright/test/index.mjs';
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 45000,
  retries: 0,
  workers: 1,
  reporter: [['list'], ['json', { outputFile: 'test-results/browser-results.json' }]],
  use: {
    baseURL: 'http://127.0.0.1:5173',
    browserName: 'chromium',
    channel: 'chrome',
    viewport: { width: 1512, height: 982 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
});
