import { defineConfig } from '@playwright/test';

const baseURL = 'http://127.0.0.1:4173/session-shape/';

export default defineConfig({
  testDir: './e2e',
  // Keep browser tests outside Vitest's *.test / *.spec discovery.
  testMatch: '**/*.e2e.ts',
  forbidOnly: !!process.env.CI,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL,
    browserName: 'chromium',
    headless: true,
    bypassCSP: false,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm run build && npm run preview -- --host 127.0.0.1 --port 4173 --strictPort',
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
