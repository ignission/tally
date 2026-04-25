import { expect, type Page, test } from '@playwright/test';

// Issue #12 / PR #15: キャンバスをスクロールパンに切替えノード操作感を改善。
//
// このテストは「思考のキャンバス」の操作感を担保する。検証する不変条件:
//  1. ペイン (キャンバス背面) は default カーソル (パンは DnD ではなくスクロールに集約)
//  2. ノード DOM はホバーで grab カーソル
//  3. wheel イベントで縦方向にパン (.react-flow__viewport の transform が変化)
//  4. Shift+wheel で横方向にパン (transform の translateX が変化)

async function openSampleProject(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('link', { name: /TaskFlow 招待機能追加/ }).click();
  // React Flow のノード描画と viewport の transform 反映 (fitView) を待つ。
  // 後続テストはノードが 1 件以上存在することを暗黙の前提とするため、ここで明示的に保証する。
  await expect(page.locator('.react-flow__node')).not.toHaveCount(0);
  await page.locator('.react-flow__node').first().waitFor({ state: 'visible' });
  await page.locator('.react-flow__viewport').first().waitFor({ state: 'attached' });
}

// .react-flow__viewport の inline style の transform を取得する。
// React Flow v12 系は `translate(Xpx, Ypx) scale(Z)` の形式で書き込む。
async function readViewportTransform(page: Page): Promise<string> {
  return await page.locator('.react-flow__viewport').first().evaluate((el) => {
    return (el as HTMLElement).style.transform;
  });
}

// transform 文字列から translate(x, y) を抽出。scale 部分は無視する。
// 前提: React Flow v12 系の `translate(Xpx, Ypx) scale(Z)` 形式。
// パース失敗時は黙って 0 を返さず throw する。CSS 形式が変わった場合に
// 偽陰性 (transform 不変判定で誤合格) を起こさず、即座に気付けるようにするため。
function parseTranslate(transform: string): { x: number; y: number } {
  const m = /translate\(\s*(-?[\d.]+)px\s*,\s*(-?[\d.]+)px\s*\)/.exec(transform);
  if (!m) {
    throw new Error(
      `viewport transform が想定形式 (translate(Xpx, Ypx) scale(Z)) ではない: ${JSON.stringify(transform)}`,
    );
  }
  return { x: Number(m[1]), y: Number(m[2]) };
}

test.describe('キャンバス操作感 (cursor / scroll-pan)', () => {
  test('ペインは default カーソル、ノードは grab カーソル', async ({ page }) => {
    await openSampleProject(page);

    // ペイン: パンを DnD から外したので default が当たっているはず。
    const paneCursor = await page
      .locator('.react-flow__pane')
      .first()
      .evaluate((el) => getComputedStyle(el).cursor);
    expect(paneCursor).toBe('default');

    // ノード: ホバーで grab。getComputedStyle はホバー擬似クラスでなく実際の cursor 値を返すので、
    // CSS で `.react-flow__node { cursor: grab }` が当たっていることを直接確認する。
    // 特定タイトルへの依存はフィクスチャ脆弱性を生むため、最初の 1 件で十分。
    const nodeCursor = await page
      .locator('.react-flow__node')
      .first()
      .evaluate((el) => getComputedStyle(el).cursor);
    expect(nodeCursor).toBe('grab');
  });

  test('wheel で縦方向にパンすると viewport の transform が変化する', async ({ page }) => {
    await openSampleProject(page);

    const before = parseTranslate(await readViewportTransform(page));

    // ペイン上で wheel を発火。React Flow は panOnScroll で deltaY を縦パンに変換する。
    const pane = page.locator('.react-flow__pane').first();
    const box = await pane.boundingBox();
    if (!box) throw new Error('pane bounding box not found');
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;

    // Playwright の mouse.wheel は wheel イベントを正しく発火し、React Flow が拾える。
    await page.mouse.move(cx, cy);
    await page.mouse.wheel(0, 200);

    // transform 反映は React Flow の内部 RAF を経由するので、変化を polling で待つ。
    await expect
      .poll(async () => parseTranslate(await readViewportTransform(page)).y, {
        timeout: 2000,
      })
      .not.toBe(before.y);

    const after = parseTranslate(await readViewportTransform(page));
    // 縦パンなので y が変わっている (符号は React Flow 内部実装に依存するので絶対値で見る)。
    expect(Math.abs(after.y - before.y)).toBeGreaterThan(10);
  });

  test('Shift+wheel で横方向にパンすると viewport の translateX が変化する', async ({ page }) => {
    await openSampleProject(page);

    const before = parseTranslate(await readViewportTransform(page));

    const pane = page.locator('.react-flow__pane').first();
    const box = await pane.boundingBox();
    if (!box) throw new Error('pane bounding box not found');
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;

    await page.mouse.move(cx, cy);
    // Shift を押しながら wheel を発火。Playwright の mouse.wheel は modifiers を直接持たないため、
    // keyboard.down('Shift') で押下状態を作る。
    // 前提: Shift+wheel はブラウザが deltaX として扱い、panOnScrollMode=Free が translateX を動かす。
    // 注意: CI ヘッドレス環境 (Chromium / Firefox / WebKit / OS) で deltaX 振替の挙動が変わる可能性があり、
    // 将来的に flake が出た場合はここを疑う (代替案: page.mouse.wheel に直接 deltaX を渡す等)。
    await page.keyboard.down('Shift');
    try {
      await page.mouse.wheel(0, 200);
    } finally {
      await page.keyboard.up('Shift');
    }

    await expect
      .poll(async () => parseTranslate(await readViewportTransform(page)).x, {
        timeout: 2000,
      })
      .not.toBe(before.x);

    const after = parseTranslate(await readViewportTransform(page));
    expect(Math.abs(after.x - before.x)).toBeGreaterThan(10);
  });
});
