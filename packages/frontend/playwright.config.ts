import path from 'node:path';

import { defineConfig, devices } from '@playwright/test';

// テスト専用の TALLY_HOME (global-setup 側と同じ値を使う)。
// registry.yaml とプロジェクトコピーをこの下に作る。
const TEST_TALLY_HOME = path.resolve(__dirname, '.playwright-tally-home');

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: process.env.CI ? [['list']] : 'list',

  globalSetup: './e2e/global-setup.ts',

  use: {
    baseURL: 'http://localhost:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // frontend の dev server を自動起動。ai-engine は未起動でもノード表示は動く (chat を開かない限り WS 接続なし)。
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      TALLY_HOME: TEST_TALLY_HOME,
      // Next.js の開発用ログをある程度抑える。
      NEXT_TELEMETRY_DISABLED: '1',
    },
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
