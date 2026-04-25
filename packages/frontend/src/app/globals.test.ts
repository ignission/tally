import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// issue #12: キャンバスの操作感を CSS で担保する。
// React Flow のクラスを globals.css で上書きしているため、
// 必要なルールが消えていないことをテストで担保する。
describe('globals.css のキャンバス操作ルール', () => {
  it('React Flow キャンバスの操作感ルールがすべて含まれている', async () => {
    const css = await readFile(path.resolve(__dirname, 'globals.css'), 'utf8');

    // panOnDrag=false の前提で、ペインは default カーソル。
    expect(css).toMatch(/\.react-flow__pane\s*\{[^}]*cursor:\s*default/);
    // ノードホバーは grab。
    expect(css).toMatch(/\.react-flow__node\s*\{[^}]*cursor:\s*grab/);
    // ドラッグ中は grabbing + 半透明 (ゴーストイメージ風)。
    expect(css).toMatch(/\.react-flow__node\.dragging[^{]*\{[^}]*cursor:\s*grabbing/);
    expect(css).toMatch(/\.react-flow__node\.dragging[^{]*\{[^}]*opacity:\s*0\.7/);
  });
});
