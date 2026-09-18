import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './e2e',
  timeout: 60000,
  workers: 1,
  use: {
    baseURL: process.env['REMVORA_E2E_URL'] ?? 'http://localhost:4200',
    channel: 'chrome',
    headless: true,
    trace: 'off',
    launchOptions: {
      args: process.env['REMVORA_E2E_SPKI']
        ? ['--ignore-certificate-errors-spki-list=' + process.env['REMVORA_E2E_SPKI']]
        : [],
    },
  },
  outputDir: '.runtime/playwright',
});
