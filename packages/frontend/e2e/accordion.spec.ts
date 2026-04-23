import { expect, type Page, test } from '@playwright/test';

// Issue #4: ノードのアコーディオン化。
// sample-project (TaskFlow 招待機能) を Playwright 専用 TALLY_HOME に登録した状態で、
// プロジェクトを開き、折りたたみ/展開の UI 挙動を検証する。

// sample-project に含まれる要求ノードの一部。折りたたみ時は見えず、展開すると見える。
// 「チーム招待機能」(x=40, y=40) は React Flow の fitView 後にツールバー右上と重なる位置に描画
// されるため、トグルクリックがツールバーに遮られる。ツールバーと干渉しない「権限レベルの柔軟設定」
// (x=40, y=260) を使う。
const TARGET_TITLE = '権限レベルの柔軟設定';
const TARGET_BODY_FRAGMENT = '招待時に権限を指定';

async function openSampleProject(page: Page): Promise<void> {
  await page.goto('/');
  // レジストリからの一覧表示を待つ。
  await page.getByRole('link', { name: /TaskFlow 招待機能追加/ }).click();
  // キャンバスが描画され React Flow のノード要素が出るまで待つ。
  await page.locator('.react-flow__node').first().waitFor({ state: 'visible' });
}

function nodeByTitle(page: Page, title: string) {
  return page.locator('.react-flow__node').filter({ hasText: title }).first();
}

test.describe('ノードのアコーディオン', () => {
  test('プロジェクトを開いた直後は全ノードが折りたたみ状態 (body が見えない)', async ({ page }) => {
    await openSampleProject(page);

    // タイトル自体は見える。
    await expect(page.getByText(TARGET_TITLE).first()).toBeVisible();

    // 折りたたみ時は body が DOM に存在しない (body は条件レンダリングで除去される)。
    // getByText 完全一致でなく "含む" 検索だと他のテキストにマッチしうるため、body 断片のピンポイント確認。
    await expect(page.getByText(TARGET_BODY_FRAGMENT)).toHaveCount(0);
  });

  test('トグルボタンをクリックすると個別ノードが展開し body が見える', async ({ page }) => {
    await openSampleProject(page);

    const node = nodeByTitle(page, TARGET_TITLE);
    const toggle = node.getByRole('button', { name: '展開' });
    await expect(toggle).toBeVisible();

    await toggle.click();

    // 展開後は body 断片が描画される。
    await expect(node.getByText(TARGET_BODY_FRAGMENT)).toBeVisible();

    // 再度クリックすると折りたたみに戻る。
    const collapseBtn = node.getByRole('button', { name: '折りたたみ' });
    await expect(collapseBtn).toBeVisible();
    await collapseBtn.click();
    await expect(node.getByText(TARGET_BODY_FRAGMENT)).toHaveCount(0);
  });

  test('ツールバーの「全展開」「全折りたたみ」が全ノードに一括適用される', async ({ page }) => {
    await openSampleProject(page);

    // 初期: 全ノード折りたたみなので body は 0 件。
    await expect(page.getByText(TARGET_BODY_FRAGMENT)).toHaveCount(0);

    // 全展開をクリック。
    await page.getByRole('button', { name: /全展開/ }).click();

    // 複数のノードで body が描画される。検証: ターゲットノードの body が見える。
    await expect(page.getByText(TARGET_BODY_FRAGMENT)).toHaveCount(1);

    // 展開済みボタン ▾ が複数あることも担保 (ノード数ぶんの「折りたたみ」aria-label が出る)。
    const collapseBtns = page.locator('.react-flow__node button[aria-label="折りたたみ"]');
    const count = await collapseBtns.count();
    expect(count).toBeGreaterThan(3);

    // 全折りたたみで戻す。
    await page.getByRole('button', { name: /全折りたたみ/ }).click();
    await expect(page.getByText(TARGET_BODY_FRAGMENT)).toHaveCount(0);
  });

  test('展開中のノードもドラッグで位置が変わる (トグルボタンがドラッグと競合しない)', async ({
    page,
  }) => {
    await openSampleProject(page);

    // 1 ノードだけ展開してドラッグ可能であることを確認する。
    const node = nodeByTitle(page, TARGET_TITLE);
    await node.getByRole('button', { name: '展開' }).click();
    await expect(node.getByText(TARGET_BODY_FRAGMENT)).toBeVisible();

    const boxBefore = await node.boundingBox();
    if (!boxBefore) throw new Error('node bounding box not found');

    // タイトル付近 (ボタンから離した位置) を掴んでドラッグ。
    const startX = boxBefore.x + boxBefore.width / 2;
    const startY = boxBefore.y + boxBefore.height - 10; // タイトル下端寄り
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    // React Flow はマイクロ動きだとドラッグ判定しないことがあるため十分大きく動かす。
    await page.mouse.move(startX + 120, startY + 80, { steps: 10 });
    await page.mouse.up();

    // ドラッグ後に位置が動いていること。
    const boxAfter = await node.boundingBox();
    if (!boxAfter) throw new Error('node bounding box not found after drag');
    const dx = Math.abs(boxAfter.x - boxBefore.x);
    const dy = Math.abs(boxAfter.y - boxBefore.y);
    expect(dx + dy).toBeGreaterThan(20);

    // ドラッグ後も展開状態が維持されている (body は見えたまま)。
    await expect(node.getByText(TARGET_BODY_FRAGMENT)).toBeVisible();
  });
});
