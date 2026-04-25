import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// issue #12: Canvas の React Flow に渡す操作系 props は UX の根幹。
// 実際の React Flow のレンダリングは jsdom で重く脆い (現状 React 19 互換性問題で
// react-testing-library 経由のレンダリング自体が失敗する) ため、
// ソース上の props 設定をテキストレベルで検証する。
// 設定が消えれば本テストが落ちて気付ける。
describe('canvas.tsx の React Flow props (issue #12)', () => {
  it('panOnDrag=false / panOnScroll / panOnScrollMode=Free / zoomOnScroll=false が指定されている', async () => {
    const src = await readFile(path.resolve(__dirname, 'canvas.tsx'), 'utf8');
    expect(src).toMatch(/panOnDrag=\{false\}/);
    expect(src).toMatch(/panOnScroll(?!Mode)\s*$|panOnScroll(?!Mode)\s*\n/m);
    expect(src).toMatch(/panOnScrollMode=\{PanOnScrollMode\.Free\}/);
    expect(src).toMatch(/zoomOnScroll=\{false\}/);
  });
});
