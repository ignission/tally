import { expect, type Locator, type Page, test } from '@playwright/test';

// Issue #13 / PR #14: ノード移動を Ctrl+Z で最大 3 回 Undo する。
// E2E: Playwright 専用 TALLY_HOME に登録された sample-project を開き、
// ドラッグでノードを動かしたあと Ctrl+Z で元位置に戻ることを検証する。
//
// 検証観点:
// - 1 回の移動が Undo で戻る
// - 連続 3 回の移動が 3 回まで Undo で戻せる (FIFO 上限)
// - 4 回の移動を行った場合、最古の 1 件は履歴から押し出され、4 回目の Undo では戻らない
// - Detail パネルの input にフォーカス中の Ctrl+Z はキャンバス Undo を発火しない
// - アコーディオンの展開/折りたたみは履歴に積まれない (Undo 後も展開状態は維持されない=戻らない)

// accordion.spec.ts と同じ流儀でツールバー / fitView と干渉しにくい既知ノードを使う。
const TARGET_TITLE = '権限レベルの柔軟設定';

async function openSampleProject(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('link', { name: /TaskFlow 招待機能追加/ }).click();
  await page.locator('.react-flow__node').first().waitFor({ state: 'visible' });
}

function nodeByTitle(page: Page, title: string): Locator {
  return page.locator('.react-flow__node').filter({ hasText: title }).first();
}

// React Flow の transform を読み取って論理座標 (translate3d 後の x/y) を出す。
// ドラッグでビューポートが動いていなければ画面 boundingBox の差分でも十分だが、
// より直接的な検証のため React Flow が style に設定する論理座標も使えるよう用意する。
async function readNodeTopLeft(node: Locator): Promise<{ x: number; y: number }> {
  const box = await node.boundingBox();
  if (!box) throw new Error('node bounding box not found');
  return { x: box.x, y: box.y };
}

// ノード中央付近 (タイトル下端寄り) を掴んで dx/dy だけ動かす。
// React Flow はマイクロドラッグだと「クリック」と判定するため十分大きく動かす。
async function dragNodeBy(
  page: Page,
  node: Locator,
  dx: number,
  dy: number,
): Promise<{ before: { x: number; y: number }; after: { x: number; y: number } }> {
  const box = await node.boundingBox();
  if (!box) throw new Error('node bounding box not found');
  const startX = box.x + box.width / 2;
  const startY = box.y + box.height - 10; // タイトル下端寄り (ボタンを避ける)
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + dx, startY + dy, { steps: 10 });
  await page.mouse.up();
  // onNodeDragStop → moveNode (PATCH) → store 更新が走り終えるまで少し待つ。
  await page.waitForTimeout(150);
  const after = await readNodeTopLeft(node);
  return { before: { x: box.x, y: box.y }, after };
}

// 引数で指定した locator にフォーカスがない状態で Ctrl+Z を撃ちたいので、
// 一度キャンバス背景をクリックしてから keyboard 入力する。
async function pressUndoOnCanvas(page: Page): Promise<void> {
  // pane (背景) をクリックしてフォーカスを外す。
  await page.locator('.react-flow__pane').click({ position: { x: 5, y: 5 } });
  // body にフォーカスがある状態で Ctrl+Z。
  await page.keyboard.press('Control+z');
  // 楽観更新 + PATCH の往復。タイミング依存を避けるためわずかに待つ。
  await page.waitForTimeout(150);
}

test.describe('ノード移動 Undo', () => {
  test('1 回の移動を Ctrl+Z で元位置に戻せる', async ({ page }) => {
    await openSampleProject(page);
    const node = nodeByTitle(page, TARGET_TITLE);

    const initial = await readNodeTopLeft(node);
    const { after: moved } = await dragNodeBy(page, node, 140, 90);
    expect(Math.abs(moved.x - initial.x) + Math.abs(moved.y - initial.y)).toBeGreaterThan(20);

    await pressUndoOnCanvas(page);

    const restored = await readNodeTopLeft(node);
    // ピクセル単位での完全一致は React Flow の浮動小数で揺れることがあるため
    // 1px 程度の誤差は許容する。
    expect(Math.abs(restored.x - initial.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(restored.y - initial.y)).toBeLessThanOrEqual(1);
  });

  test('連続 3 回の移動を 3 回まで Undo で戻せる (FIFO 上限)', async ({ page }) => {
    await openSampleProject(page);
    const node = nodeByTitle(page, TARGET_TITLE);

    const initial = await readNodeTopLeft(node);
    // 3 回移動。各移動が「同じ位置」と判定されないように違う方向に動かす。
    await dragNodeBy(page, node, 60, 0);
    await dragNodeBy(page, node, 0, 60);
    await dragNodeBy(page, node, -40, 30);

    const afterAllMoves = await readNodeTopLeft(node);
    expect(
      Math.abs(afterAllMoves.x - initial.x) + Math.abs(afterAllMoves.y - initial.y),
    ).toBeGreaterThan(20);

    // 3 回 Undo すると初期位置に戻る。
    await pressUndoOnCanvas(page);
    await pressUndoOnCanvas(page);
    await pressUndoOnCanvas(page);

    const restored = await readNodeTopLeft(node);
    expect(Math.abs(restored.x - initial.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(restored.y - initial.y)).toBeLessThanOrEqual(1);
  });

  test('4 回移動した場合、4 回目の Undo は履歴上限により効かない (最古の 1 件は失われる)', async ({
    page,
  }) => {
    await openSampleProject(page);
    const node = nodeByTitle(page, TARGET_TITLE);

    const initial = await readNodeTopLeft(node);
    // 4 回移動 (履歴上限 3 を超える)。
    await dragNodeBy(page, node, 60, 0);
    const afterFirst = await readNodeTopLeft(node);
    await dragNodeBy(page, node, 0, 60);
    await dragNodeBy(page, node, -30, 0);
    await dragNodeBy(page, node, 0, -30);

    // 3 回 Undo で「2 回目の移動後の位置」へ戻るはず (= 1 回目移動後の位置)。
    await pressUndoOnCanvas(page);
    await pressUndoOnCanvas(page);
    await pressUndoOnCanvas(page);

    const afterThreeUndo = await readNodeTopLeft(node);
    // 3 回戻したら「1 回目移動後の位置」(= 2 回目移動の直前) と一致するはず。
    // 古い履歴 (initial への Undo) は破棄されているため initial には戻らない。
    expect(Math.abs(afterThreeUndo.x - afterFirst.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(afterThreeUndo.y - afterFirst.y)).toBeLessThanOrEqual(1);

    // 4 回目の Undo は履歴 0 件で no-op。位置は変わらない。
    await pressUndoOnCanvas(page);
    const afterFourthUndo = await readNodeTopLeft(node);
    expect(Math.abs(afterFourthUndo.x - afterFirst.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(afterFourthUndo.y - afterFirst.y)).toBeLessThanOrEqual(1);

    // initial 位置とは明確にずれていること (= 1 回目の移動分は戻せない)。
    expect(
      Math.abs(afterFourthUndo.x - initial.x) + Math.abs(afterFourthUndo.y - initial.y),
    ).toBeGreaterThan(20);
  });

  test('Detail パネルの input にフォーカス中の Ctrl+Z ではノード位置は戻らない (実装ガード)', async ({
    page,
  }) => {
    await openSampleProject(page);
    const node = nodeByTitle(page, TARGET_TITLE);

    const initial = await readNodeTopLeft(node);
    await dragNodeBy(page, node, 120, 80);
    const moved = await readNodeTopLeft(node);

    // ノードを選択して Detail シートを開き、タイトル input にフォーカスする。
    await node.click();
    const titleInput = page.getByLabel('タイトル');
    await expect(titleInput).toBeVisible();
    await titleInput.focus();
    // input にフォーカスがある状態で Ctrl+Z。
    // 実装は isEditableTarget で input/textarea を弾くため、ノード位置は戻らない。
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(150);

    const stillMoved = await readNodeTopLeft(node);
    // moved 位置から動いていない。
    expect(Math.abs(stillMoved.x - moved.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(stillMoved.y - moved.y)).toBeLessThanOrEqual(1);
    // initial と比べて十分ずれている。
    expect(
      Math.abs(stillMoved.x - initial.x) + Math.abs(stillMoved.y - initial.y),
    ).toBeGreaterThan(20);

    // フォーカスを外して Ctrl+Z すれば今度は戻る (履歴は消費されていない証拠)。
    await pressUndoOnCanvas(page);
    const restored = await readNodeTopLeft(node);
    expect(Math.abs(restored.x - initial.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(restored.y - initial.y)).toBeLessThanOrEqual(1);
  });

  test('アコーディオン展開/折りたたみは履歴に積まれず Undo で戻らない', async ({ page }) => {
    await openSampleProject(page);
    const node = nodeByTitle(page, TARGET_TITLE);

    // 折りたたみ → 展開のトグル操作 (移動ではない)。
    const expandBtn = node.getByRole('button', { name: '展開' });
    await expandBtn.click();
    // 展開状態になり、折りたたみボタンが出る。
    await expect(node.getByRole('button', { name: '折りたたみ' })).toBeVisible();

    // この状態で Ctrl+Z しても、moveHistory は空のまま no-op (展開は履歴に積まない)。
    await pressUndoOnCanvas(page);

    // Undo 後も展開状態は維持される (= 履歴には何も積まれていなかった証拠)。
    await expect(node.getByRole('button', { name: '折りたたみ' })).toBeVisible();
  });
});
