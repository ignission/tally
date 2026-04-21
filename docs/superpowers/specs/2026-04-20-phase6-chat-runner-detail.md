# Phase 6 chat-runner 実装詳細 (Task 4 用)

Phase 6 plan Task 4 実装前の設計詰め。メイン spec は `docs/superpowers/specs/2026-04-20-phase6-chat-panel-design.md`。

## 解決する主要論点

1. MCP tool 承認 intercept の Promise 管理
2. tool_use の ID 整合 (SDK 内 id vs UI 承認 id)
3. メッセージ永続化タイミング (ストリーミング中 vs turn 末)
4. SDK multi-turn プロトコル (prompt 形式、履歴注入)
5. 同時 tool 呼び出しの扱い (並列承認 or 直列化)

---

## 1. MCP tool 承認 intercept

### 1.1 基本パターン

`buildTallyMcpServer` と別に `buildChatInterceptedMcpServer(deps)` を新設。
create_node / create_edge の handler を承認ガード付きで差し替える (find_related / list_by_type はそのまま素通し)。

```typescript
// chat-runner 内部
const pendingApprovals = new Map<string, (approved: boolean) => void>();

function awaitApproval(uiToolUseId: string): Promise<boolean> {
  return new Promise((resolve) => {
    pendingApprovals.set(uiToolUseId, resolve);
  });
}

// 外部から呼ばれる:
function approveTool(uiToolUseId: string, approved: boolean): void {
  const resolver = pendingApprovals.get(uiToolUseId);
  if (resolver) {
    pendingApprovals.delete(uiToolUseId);
    resolver(approved);
  }
  // 見つからない id は無視 (重複クリックや古い approval)
}

// tool handler (ラップ版):
tool('create_node', '...', CreateNodeInputSchema.shape, async (input) => {
  const uiToolUseId = newToolUseId();
  const block: ChatBlock = {
    type: 'tool_use',
    toolUseId: uiToolUseId,
    name: 'mcp__tally__create_node',
    input,
    approval: 'pending',
  };
  // 1) 永続化 (assistant msg に append)
  await chatStore.appendBlockToMessage(threadId, assistantMsgId, block);
  // 2) event 発火
  emit({ type: 'chat_tool_pending', messageId: assistantMsgId, toolUseId: uiToolUseId, name, input });
  // 3) 承認待ち
  const approved = await awaitApproval(uiToolUseId);
  // 4) approval 更新を永続化
  await chatStore.updateBlockApproval(threadId, assistantMsgId, uiToolUseId, approved ? 'approved' : 'rejected');
  // 5) 実行 or スキップ
  if (!approved) {
    const output = 'ユーザー却下';
    const resultBlock: ChatBlock = { type: 'tool_result', toolUseId: uiToolUseId, ok: false, output };
    await chatStore.appendBlockToMessage(threadId, assistantMsgId, resultBlock);
    emit({ type: 'chat_tool_result', messageId: assistantMsgId, toolUseId: uiToolUseId, ok: false, output });
    return { content: [{ type: 'text', text: output }], isError: true };
  }
  const res = await realCreateNode(input);
  const resultBlock: ChatBlock = {
    type: 'tool_result',
    toolUseId: uiToolUseId,
    ok: res.ok,
    output: res.output,
  };
  await chatStore.appendBlockToMessage(threadId, assistantMsgId, resultBlock);
  emit({ type: 'chat_tool_result', messageId: assistantMsgId, toolUseId: uiToolUseId, ok: res.ok, output: res.output });
  return { content: [{ type: 'text', text: res.output }], isError: !res.ok };
});
```

### 1.2 ID 整合方針

**SDK 内部の tool_use_id は使わない**。ChatRunner が UI 承認用に生成する `ui-toolUseId` (`tool-<nanoid10>`) が唯一の識別子。

理由:
- SDK の tool() handler は `input` のみ受け、SDK 内部 id は見えない
- model のストリーム中の assistant message に含まれる SDK id を追う必要があるが、MVP では不要
- 我々が生成した id は永続化とも承認 UI とも一貫して使える

トレードオフ: SDK の log / debug で参照する時に 2 系統の id があることになる。Phase 7 で対応検討。

---

## 2. メッセージ永続化タイミング

### 2.1 User message

user 入力を受けた瞬間に `appendMessage` で永続化。event `chat_user_message_appended` を送信。

### 2.2 Assistant message (ストリーミング中)

turn 開始時に空 blocks の assistant message を `appendMessage` で作成 (ID 確保)。その後はブロック単位で追記:

- **text block**: SDK からストリーミングで届く。**メモリ上で累積**、turn 末にまとめて永続化 (text delta は event でフロント側へリアルタイム送信、永続化は遅延)
- **tool_use block (pending)**: 承認 intercept に入る時点で**即永続化** (クラッシュしても pending 状態が残る)
- **tool_use block (approved/rejected)**: 承認後に`updateBlockApproval` で in-place 更新
- **tool_result block**: 実行 or 却下直後に**即永続化** (append)

turn 末の処理: 累積した text blocks を assistant message の先頭 (or tool_use より前) に挿入した形で `replaceMessageBlocks` で書き戻す。

### 2.3 chat-store に追加する helper

```typescript
interface ChatStore {
  // 既存 ... 
  // 単一ブロック追加 (tool_use や tool_result の incremental append 用)
  appendBlockToMessage(threadId: string, messageId: string, block: ChatBlock): Promise<ChatThread>;
  // blocks 配列を丸ごと置換 (turn 末の text blocks 統合用)
  replaceMessageBlocks(threadId: string, messageId: string, blocks: ChatBlock[]): Promise<ChatThread>;
  // 特定 toolUseId の approval 状態を更新 (承認後の block 書き戻し用)
  updateBlockApproval(
    threadId: string,
    messageId: string,
    toolUseId: string,
    approval: 'approved' | 'rejected',
  ): Promise<ChatThread>;
}
```

Task 2 の FileSystemChatStore にこれらを追加して Task 4 実装を楽にする。

---

## 3. SDK multi-turn プロトコル

### 3.1 現実的な制約

Claude Agent SDK の `query({ prompt, options })` は 1 回の推論セッション。session を跨ぐ会話は SDK 側で管理しない前提 (SDK 内部に session id があっても `query` の options には無い)。

### 3.2 MVP プロトコル

各 user turn で以下を実行:
1. スレッド全履歴 (`thread.messages`) をロード
2. 過去 messages を **単一 prompt** に encode:
   - `assistant` の text blocks / `user` の text blocks のみ (tool_use/result は省略、model が自分で `list_by_type` 等で再取得する)
   - 形式:
     ```
     <conversation_history>
     <message role="user">X</message>
     <message role="assistant">Y</message>
     ...
     </conversation_history>
     <current_user_message>W</current_user_message>
     ```
3. system prompt: Phase 6 spec § 3.5 の指示 + cwd 説明
4. `sdk.query({ prompt, options })` 実行
5. 結果をストリーミング + 永続化
6. turn 終了で次の user 入力待ち

### 3.3 履歴長の制限

MVP では token 計算なし。10 turn 超えたら AI の応答でも `list_by_type` 呼んで補うのに任せる。Phase 7 で summary/pruning 検討。

### 3.4 tool_use/result は履歴に含めない理由

model は過去の tool_use 結果を prompt で再 parse するより、必要なら `list_by_type` や `find_related` を再実行する方が確実。tool_result の長い JSON が履歴を圧迫するのも避けたい。

欠点: model が「さっき Glob したファイル一覧」を忘れる → 必要なら再度 Glob する。MVP 許容。

---

## 4. 同時 tool 呼び出しの扱い

### 4.1 SDK の挙動

Claude モデルは 1 メッセージ内に複数の tool_use block を出し得る。SDK は各 tool の handler を**並列に呼ぶ可能性**がある (実装依存)。

### 4.2 MVP 方針: 直列化

`pendingApprovals` Map は複数同時 entry を許容するが、**UI 側は直列承認前提**で設計する:

- 複数 pending が走っても event は個別に emit される
- UI は pending カードを複数表示、ユーザーは上から順に承認
- 各 handler は自分の id の approval が解決すれば進む

実装上: 並列 handler が同じ assistant message に同時 appendBlock する可能性あり → `FileSystemChatStore.appendBlockToMessage` を **排他ロック (mutex)** で直列化する。単一ユーザー前提だが handler 並列に備える。

簡易 mutex:
```typescript
class FileSystemChatStore {
  private writeLocks = new Map<string, Promise<unknown>>();
  private async withWriteLock<T>(threadId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.writeLocks.get(threadId) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    this.writeLocks.set(threadId, next);
    try {
      return await next;
    } finally {
      if (this.writeLocks.get(threadId) === next) this.writeLocks.delete(threadId);
    }
  }
  async appendBlockToMessage(threadId, messageId, block) {
    return this.withWriteLock(threadId, async () => {
      const thread = await this.getChat(threadId);
      if (!thread) throw ...;
      // ... patch and writeYaml
    });
  }
}
```

これで同一スレッドへの書き込みは FIFO 直列化される。

---

## 5. Task 2 への追加実装 (Task 4 着手前に取り込む)

`FileSystemChatStore` に以下を追加:
- `appendBlockToMessage(threadId, messageId, block)`
- `replaceMessageBlocks(threadId, messageId, blocks)`
- `updateBlockApproval(threadId, messageId, toolUseId, approval)`
- 内部 write mutex (`withWriteLock`)

テストも追加 (各 helper に 2-3 本、並列 append で競合無しを確認する test)。

これは Task 2 の follow-up commit として chat-store 側だけ先にマージすると Task 4 の実装が楽。

---

## 6. Task 4 の RED テストに反映する仕様

実装規模を踏まえ、Task 4 の test を以下に具体化:

1. **text-only 応答**: user msg → AI text ストリーム → turn end、assistant msg に text block が保存されている
2. **tool_use 承認**: user msg → AI tool_use → pending event 発火 → `approveTool(id, true)` で Promise 解決 → handler 実行 → node 作成 → tool_result event
3. **tool_use 却下**: 上と同じだが `approveTool(id, false)` → handler スキップ → 却下 tool_result
4. **複数 tool_use 直列**: 1 turn で 2 つの create_node → 両方 pending が emit される → 順次承認 → 両方 node 作成
5. **履歴注入**: 2 回目の user turn で build した prompt に過去の user/assistant text が含まれる (mock SDK に渡された prompt を検証)
6. **read-only tool は承認不要**: find_related / list_by_type は intercept されず即実行

---

## 7. plan Task 4 の修正点

元の Task 4 では chat-runner の詳細が pseudocode + TODO 多めだった。実装時は本ドキュメントの § 1-6 を参照して書く。

重要な追加:
- Task 2 の FileSystemChatStore に 3 helper + mutex を追加する先行コミットを入れてから Task 4 に進む (plan 上は Task 4 の Step 0 として扱う)
- Task 4 の test は § 6 の 6 パターンをカバー

---

## 8. 未解決事項 (実装中に詰める)

- SDK query の戻り値が text delta (token ごと) か完成 message 単位かで event 発火方針が変わる。実測してから決める
- text delta の流量が多い場合 emit が詰まる可能性 (WebSocket 送信バッファ)。MVP では無視、E2E で確認
- SDK が tool 並列呼び出しを実際にするか未検証。直列化前提でも MVP は動く想定
- `pathToClaudeCodeExecutable` 周りは既存 `agent-runner` から流用

以上。
