import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      // tsconfig の paths と揃える (Next.js の `@/` エイリアス)。
      '@': path.resolve(__dirname, 'src'),
    },
  },
  // React 17+ の自動 JSX ランタイム: テスト側で import React が不要になる。
  // Next.js 本体は tsconfig.jsx: 'preserve' のまま SWC が処理するので影響なし。
  esbuild: {
    jsx: 'automatic',
  },
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    // *.test.ts は node、*.test.tsx は jsdom (React コンポーネントテスト用)。
    environmentMatchGlobs: [
      ['src/**/*.test.tsx', 'jsdom'],
      ['src/**/*.test.ts', 'node'],
    ],
    environment: 'node',
    setupFiles: ['./vitest.setup.ts'],
  },
});
