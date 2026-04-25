import path from 'node:path';
import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const alias = {
  // tsconfig の paths と揃える (Next.js の `@/` エイリアス)。
  '@': path.resolve(__dirname, 'src'),
};

export default defineConfig({
  resolve: { alias },
  test: {
    // Vitest 4 で environmentMatchGlobs が削除されたため projects で環境を切り分ける。
    // .test.tsx は jsdom (React コンポーネントテスト)、.test.ts は node。
    projects: [
      {
        plugins: [react()],
        resolve: { alias },
        test: {
          name: 'jsdom',
          include: ['src/**/*.test.tsx'],
          environment: 'jsdom',
          setupFiles: ['./vitest.setup.ts'],
          // React 19 では `React.act` が development build にしか含まれない。
          // testing-library が React.act を必要とするので test 実行は development 扱いにする。
          // (NODE_ENV=test だと react.production.js が読まれて React.act が undefined になる)
          env: { NODE_ENV: 'development' },
        },
      },
      {
        resolve: { alias },
        test: {
          name: 'node',
          include: ['src/**/*.test.ts'],
          environment: 'node',
          setupFiles: ['./vitest.setup.ts'],
        },
      },
    ],
  },
});
