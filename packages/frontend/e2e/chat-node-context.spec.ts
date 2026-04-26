import { expect, type Page, test } from '@playwright/test';

// Issue #11 / PR #16: Chat タブにノードをコンテキストとして添付できるバー (ChatContextBar) の E2E。
// ai-engine は起動しないため、WebSocket 越しの実 AI 応答は検証対象外。
// 検証範囲は ChatContextBar の UI / store 操作のみ:
//   - 添付チップの表示
//   - キャンバスで選択したノードを「選択中のノードを添付」ボタンで追加
//   - ピッカーからの追加
//   - 個別 chip の x 解除
//   - 「すべて解除」(全解除) で空に
// チャット送信 (sendChatMessage) は ai-engine 必須なので、未起動状態での送信ボタン disabled を最後に確認。

const TARGET_TITLE_SELECT = '権限レベルの柔軟設定';
const TARGET_TITLE_PICKER = 'チーム招待機能';

async function openSampleProject(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('link', { name: /TaskFlow 招待機能追加/ }).click();
  await page.locator('.react-flow__node').first().waitFor({ state: 'visible' });
}

// 右サイドバーの Chat タブを開き、新規スレッドを作る。
// chat-context-bar testid が現れるまで待つ (WS 接続失敗は許容)。
async function openChatTabWithNewThread(page: Page): Promise<void> {
  await page.getByRole('tab', { name: 'Chat' }).click();
  await page.getByRole('button', { name: '+ 新規' }).click();
  await page.getByTestId('chat-context-bar').waitFor({ state: 'visible' });
}

function nodeByTitle(page: Page, title: string) {
  return page.locator('.react-flow__node').filter({ hasText: title }).first();
}

// 指定タイトルのノードをクリックして selected: { kind: 'node', id } 状態にする。
// React Flow の onNodeClick が発火する程度の単発クリックで十分。
async function selectNodeOnCanvas(page: Page, title: string): Promise<void> {
  const node = nodeByTitle(page, title);
  await node.click({ position: { x: 10, y: 10 } });
}

test.describe('Chat コンテキストノード操作', () => {
  test('Chat タブを開くと ChatContextBar が表示され初期は未添付', async ({ page }) => {
    await openSampleProject(page);
    await openChatTabWithNewThread(page);

    const bar = page.getByTestId('chat-context-bar');
    await expect(bar).toBeVisible();
    // 初期は chip が 0 件で「未添付」表記が出る。
    await expect(bar.getByTestId('chat-context-chip')).toHaveCount(0);
    await expect(bar.getByText('未添付')).toBeVisible();
    // 添付済みが 0 のときは「すべて解除」ボタンは出ない。
    await expect(page.getByRole('button', { name: 'コンテキストをすべて解除' })).toHaveCount(0);
  });

  test('キャンバスで選択中のノードをショートカットで添付できる', async ({ page }) => {
    await openSampleProject(page);
    await openChatTabWithNewThread(page);

    // キャンバスのノードをクリックして選択 (Chat タブを開いたままでも react-flow は触れる)。
    await selectNodeOnCanvas(page, TARGET_TITLE_SELECT);

    // 「選択中のノードを添付」ボタンが出る。クリックで chip 化。
    const addSelectedBtn = page.getByRole('button', { name: '選択中のノードを添付' });
    await expect(addSelectedBtn).toBeVisible();
    await addSelectedBtn.click();

    const bar = page.getByTestId('chat-context-bar');
    await expect(bar.getByTestId('chat-context-chip')).toHaveCount(1);
    // 同じノードを再度添付しようとしてもボタン自体が消える (canAttachSelected = false)。
    await expect(addSelectedBtn).toHaveCount(0);
  });

  test('ピッカーから別のノードを追加できる (合計 2 件)', async ({ page }) => {
    await openSampleProject(page);
    await openChatTabWithNewThread(page);

    // 1 件目: ショートカットで追加
    await selectNodeOnCanvas(page, TARGET_TITLE_SELECT);
    await page.getByRole('button', { name: '選択中のノードを添付' }).click();
    const bar = page.getByTestId('chat-context-bar');
    await expect(bar.getByTestId('chat-context-chip')).toHaveCount(1);

    // 2 件目: ピッカーから追加
    await page.getByRole('button', { name: 'コンテキストにノードを追加' }).click();
    const picker = page.getByRole('dialog', { name: 'コンテキストに追加するノードを選択' });
    await expect(picker).toBeVisible();
    // ピッカー内のボタンで該当ノードを 1 件 add。文字列短縮(36文字以下) のため title 完全一致で取れる。
    await picker.getByRole('button', { name: TARGET_TITLE_PICKER }).click();

    await expect(bar.getByTestId('chat-context-chip')).toHaveCount(2);
  });

  test('chip の x で 1 件削除し、「すべて解除」で空に戻せる', async ({ page }) => {
    await openSampleProject(page);
    await openChatTabWithNewThread(page);

    // 2 件添付して下準備。
    await selectNodeOnCanvas(page, TARGET_TITLE_SELECT);
    await page.getByRole('button', { name: '選択中のノードを添付' }).click();
    await page.getByRole('button', { name: 'コンテキストにノードを追加' }).click();
    const picker = page.getByRole('dialog', { name: 'コンテキストに追加するノードを選択' });
    await picker.getByRole('button', { name: TARGET_TITLE_PICKER }).click();

    const bar = page.getByTestId('chat-context-bar');
    await expect(bar.getByTestId('chat-context-chip')).toHaveCount(2);

    // 1 件目の chip にある「× 解除」ボタン (aria-label に「を解除」を含む) を 1 つ押す。
    const removeBtns = bar.getByRole('button', { name: /を解除$/ });
    await removeBtns.first().click();
    await expect(bar.getByTestId('chat-context-chip')).toHaveCount(1);

    // 「すべて解除」で残り 1 件も消す。
    await page.getByRole('button', { name: 'コンテキストをすべて解除' }).click();
    await expect(bar.getByTestId('chat-context-chip')).toHaveCount(0);
    await expect(bar.getByText('未添付')).toBeVisible();
  });

  test('未入力時は送信ボタンが disabled (ai-engine 未起動でも UI で確認できる)', async ({
    page,
  }) => {
    await openSampleProject(page);
    await openChatTabWithNewThread(page);

    // 何も入力していない状態 (text.trim().length === 0) では送信ボタンは disabled。
    // ai-engine が無くても WebSocket の有無に関係なく UI 単独で確認できる。
    const sendBtn = page.getByRole('button', { name: '送信' });
    await expect(sendBtn).toBeDisabled();
  });
});
