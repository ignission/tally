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
// TODO: React 19 + RTL 互換が解決したら、ソーステキスト読取ではなく実 DOM 検証に切替予定。
describe('canvas.tsx の React Flow props (issue #12)', () => {
  it('panOnDrag=false / panOnScroll / panOnScrollMode=Free / zoomOnScroll=false が指定されている', async () => {
    const src = await readFile(path.resolve(__dirname, 'canvas.tsx'), 'utf8');
    // 意図: 各 prop が「指定されている」ことだけを担保する。
    // 値の形式 (shorthand boolean / `={true}` / `={someVar}`) には依存しない。
    // panOnScroll は panOnScrollMode と前方一致するため、否定先読みで識別子境界を切る。
    expect(src).toMatch(/panOnDrag=\{false\}/);
    expect(src).toMatch(/\bpanOnScroll\b(?!Mode)/);
    expect(src).toMatch(/panOnScrollMode=\{PanOnScrollMode\.Free\}/);
    expect(src).toMatch(/zoomOnScroll=\{false\}/);
  });
});
