# Phase 6: チャットパネル (対話 UX) — 設計書

- 日付: 2026-04-20
- ステータス: Accepted (brainstorming で合意)
- 関連: `docs/01-concept.md` / `docs/04-roadmap.md` / ADR-0005 (proposal 採用) / ADR-0007 (エージェントツール制約) / Phase 5c-5e spec

## 目的

Phase 5a-5e のボタン型エージェントは「ワンショット実行」。入力を渡したら AI が一気に proposal を生成し、ユーザーは後から採用/却下で仕分ける。これは

- スコープを事前に詰められない (例: Confluence import 1 語で 11 枚生える)
- AI に「違う、もう少しこっち寄り」を伝える術がない
- 要求→UC の decomposition のような対話的掘り下げが出来ない

という根本課題を抱える。Phase 6 ではキャンバスの右サイドバーに **チャットパネル** を追加し、対話で要件を詰めながら proposal 生成を個別承認する UX を導入する。

Tally のコンセプト (思考のキャンバス) と Claude Code のチャット体験を統合する位置づけ。ボタン型は「スコープ確定後の素早い実行用」として残置。

## Keep it simple (MVP 範囲)

**スコープに含む**:
- 右サイドバー Detail タブの隣に Chat タブを新設
- マルチスレッド (プロジェクトごと複数、独立コンテキスト)
- 各スレッドは `.tally/chats/<thread-id>.yaml` に永続化
- user メッセージ / AI メッセージ / tool 呼び出しをストリーミング表示
- `create_node` / `create_edge` の tool 呼び出しは **個別承認 (Y/N)** を挟む
- 承認済み tool 呼び出しの結果がキャンバスに反映される (既存 node_created / edge_created と同じ経路)
- allowedTools: MCP 4 個 (`create_node` / `create_edge` / `find_related` / `list_by_type`) + codebasePath 設定時のみ `Read` / `Glob` / `Grep`

**スコープ外 (Phase 7+ 判断)**:
- スレッド検索 / 並び替え / アーカイブ / タグ
- チャットからの既存エージェント呼び出し (chain mode)
- スレッド間でのコンテキスト持ち出し (pin, reference)
- 共同編集 (1 スレッド複数ユーザー)
- リッチメッセージ (画像、埋め込みノードカード以外)
- message レベルの編集/再実行
- 失敗した承認 flow の auto-retry

## 全体構成

```
Phase 6 スコープ
├── core: (変更なし or 軽微)
├── storage:
│   ├── Chat / ChatMessage schema + YAML I/O (.tally/chats/<id>.yaml)
│   └── listChats / getChat / createChat / appendMessage
├── ai-engine:
│   ├── 新 WS エンドポイント /chat (複数ターン、セッション単位接続)
│   ├── chat-runner: マルチターン実行 + tool 承認 intercept
│   └── existing agent-runner 相当の流れを multi-turn 対応に
├── frontend:
│   ├── ChatTab (右サイドバー Detail と切替)
│   ├── スレッド一覧 + 新規 / 切替 UI
│   ├── メッセージリスト (user / assistant / tool_use(pending_approval)/tool_result)
│   ├── 入力欄 (送信)
│   └── 承認 UI (pending tool_use カードに「承認」「却下」ボタン)
├── frontend API routes:
│   ├── GET /api/projects/[id]/chats
│   ├── POST /api/projects/[id]/chats (新規スレッド)
│   ├── GET /api/projects/[id]/chats/[threadId]
│   └── DELETE /api/projects/[id]/chats/[threadId] (Phase 7、MVP 不要)
└── docs:
    ├── 04-roadmap.md: Phase 6 章追加
    ├── phase-6-manual-e2e.md
    └── phase-6-progress.md
```

---

## 1. ドメインモデル: Chat / ChatMessage

### 1.1 型定義 (core に追加)

`packages/core/src/types.ts`:

```typescript
export interface ChatMessage {
  id: string;                            // msg-<nanoid>
  role: 'user' | 'assistant';            // system は別途管理 (永続化しない)
  // 複数ブロック可: text / tool_use / tool_result
  blocks: ChatBlock[];
  createdAt: string;
}

export type ChatBlock =
  | { type: 'text'; text: string }
  | {
      type: 'tool_use';
      toolUseId: string;
      name: string;                      // 'mcp__tally__create_node' 等
      input: unknown;                    // 生 input
      // user の承認状態。pending | approved | rejected。
      // approved 後に実際に tool が走り、tool_result が追従する。
      approval: 'pending' | 'approved' | 'rejected';
    }
  | {
      type: 'tool_result';
      toolUseId: string;
      ok: boolean;
      output: string;                    // create_node の場合は JSON 文字列
    };

export interface ChatThread {
  id: string;                            // chat-<nanoid>
  projectId: string;
  title: string;                         // 最初の user message から抜粋 or ユーザー命名
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
}
```

zod スキーマも同様に `packages/core/src/schema.ts` に追加。

### 1.2 永続化

`packages/storage/src/`:
- `chat-store.ts`: `.tally/chats/<thread-id>.yaml` 単位で read/write
- `ChatStore` interface:
  - `listChats(): Promise<ChatThreadMeta[]>` (summary だけ、メッセージは含めない)
  - `getChat(threadId): Promise<ChatThread | null>`
  - `createChat(meta): Promise<ChatThread>` (空 messages の新規)
  - `appendMessage(threadId, message): Promise<ChatThread>`
  - `updateMessageBlock(threadId, msgId, blockIdx, newBlock)`: 承認状態変更や tool_result 追加時に部分更新
  - `updateChatTitle(threadId, title)` (初回 user msg で自動命名)

ファイル 1 枚 = 1 スレッド。読み書き時にロック不要 (単一ユーザー前提、ADR-0003)。

---

## 2. UI: 右サイドバーのチャットタブ

### 2.1 レイアウト

既存の右サイドバー (Detail Sheet) を `Tab` 2 枚に変える:

- **Detail** タブ: 既存の選択ノード / エッジ詳細 (無変更)
- **Chat** タブ: 本 Phase で新規

タブヘッダは小さく (40px 高) 、切替はクリック。デフォルトは Detail 選択時に Detail、それ以外 Chat (または最後に使ったタブを保持)。

### 2.2 Chat タブ内部レイアウト

```
┌──────────────────────────────────┐
│ ▼ スレッド: 要件を詰める          + 新規  │
├──────────────────────────────────┤
│  [user] Confluence から要求取り込みたい │
│  [AI]  スコープを教えてください...   │
│  [AI] 🔧 create_node requirement  │
│      "Confluence 取り込み機能"      │
│      [ 承認 ] [ 却下 ]              │
│  ...                             │
├──────────────────────────────────┤
│ [ 入力欄........................] 送信 │
└──────────────────────────────────┘
```

- 上部: スレッド selector (dropdown) + 新規ボタン
- 中央: メッセージリスト (スクロール可、下にスクロールピン)
- 下部: 入力欄 (textarea、Shift+Enter で改行 / Enter で送信)

### 2.3 メッセージ表示

- `user`: 右寄せ、background 濃い青
- `assistant text`: 左寄せ、通常テキスト
- `tool_use` pending: カード形式、tool 名 + input 概要 + 承認/却下ボタン
- `tool_use` approved: カード形式 (チェック付き、ボタン消滅)
- `tool_use` rejected: カード形式 (バツ印、薄く)
- `tool_result`: 簡易表示 (`ok: node created id=...`)

### 2.4 承認フロー UX

- `tool_use(approval=pending)` が到着 → カードに「承認 / 却下」ボタン
- クリック → `/chat/{threadId}/approve` に `{toolUseId, approved: bool}` を送信 (WS 経由)
- server が tool 実行 or skip → `tool_result` block を送信
- AI は tool_result を受けて次のターンへ

---

## 3. server-side: 新 WS エンドポイント /chat

### 3.1 接続モデル

- 既存 `/agent` はエージェント 1 回実行で 1 接続。`/chat` は **スレッド 1 本 = 1 接続** (長寿命)
- 接続時のメッセージ: `{ type: 'open', projectId, threadId }` → 過去履歴 load + session 開始
- user からのメッセージ: `{ type: 'user_message', text }`
- user からの承認: `{ type: 'approve_tool', toolUseId, approved: boolean }`
- server → user のイベント (既存 `AgentEvent` を拡張):
  - `chat_opened` (初期化完了)
  - `chat_message_started` / `chat_text_delta` / `chat_message_completed` (ストリーミング)
  - `chat_tool_pending` (承認待ち)
  - `chat_tool_result` (承認後の結果)
  - `chat_turn_ended` (AI のターン終了)
  - `error`

### 3.2 chat-runner (新規)

`packages/ai-engine/src/chat-runner.ts`:

- スレッドの過去メッセージを SDK に prompt history として渡す
- user の新メッセージを追加
- SDK の query を実行、生成メッセージを逐次 chat storage に append しつつ WS 経由で送信
- `tool_use` が出たら: 自動実行せず `chat_tool_pending` 送信 + Promise で user 応答待ち
- user が approve → tool 実際に走る → `tool_result` emit + chat storage に追記 + WS 送信
- user が reject → `tool_result` を `{ ok: false, output: 'ユーザー却下' }` で合成 + 次ターンへ
- AI が turn 終了 (stop_reason=end_turn) → `chat_turn_ended` 送信して user 入力待ち

### 3.3 tool interception

MCP tool handler を wrapper で包む:

```typescript
async function interceptedCreateNode(input) {
  const toolUseId = nextId();
  emit({ type: 'chat_tool_pending', toolUseId, name: 'mcp__tally__create_node', input });
  appendBlock({ type: 'tool_use', toolUseId, name: ..., input, approval: 'pending' });
  const decision = await awaitApproval(toolUseId);  // user 応答を Promise で待つ
  if (decision.approved) {
    const res = await realCreateNodeHandler(input);
    appendBlock({ type: 'tool_result', toolUseId, ok: res.ok, output: res.output });
    emit({ type: 'chat_tool_result', toolUseId, ok: res.ok, output: res.output });
    return res;
  }
  const rejected = { ok: false, output: 'ユーザー却下' };
  appendBlock({ type: 'tool_result', toolUseId, ok: false, output: 'ユーザー却下' });
  emit({ type: 'chat_tool_result', toolUseId, ok: false, output: 'ユーザー却下' });
  return rejected;
}
```

- `awaitApproval` は chat-runner 内で Map<toolUseId, resolver> を保持、WS の `approve_tool` メッセージ受信で resolve する
- `find_related` / `list_by_type` は **承認不要** (読み取りのみなので)。`create_node` / `create_edge` のみ intercept

### 3.4 allowedTools

- `mcp__tally__create_node` + `mcp__tally__create_edge` (承認 intercept 対象)
- `mcp__tally__find_related` + `mcp__tally__list_by_type` (読み取り、intercept 不要)
- codebasePath が project meta にあれば `Read` / `Glob` / `Grep` も追加 (探索読み取り)

ADR-0007 準拠: agent-runner と同じく `tools: builtInOnly`, `settingSources: []`, `permissionMode: 'dontAsk'` で自動承認範囲を allowedTools だけに絞る。`Bash` / `Edit` / `Write` は絶対に渡さない。

### 3.5 system prompt

```
あなたは Tally の対話アシスタントです。ユーザーと自然に対話しながら、
キャンバスに requirement / usecase / userstory / question / issue / coderef の
proposal ノードを生やし、必要に応じて satisfy / contain / derive / refine エッジを
張ってあげます。

重要な方針:
- 一度にノードを作りすぎない。ユーザーの意図を確認してから小刻みに create_node を呼ぶ。
- create_node / create_edge は必ずユーザー承認を経る (サーバ側で承認 UI を挟む)。
- 迷ったら質問する。勝手に決めない。
- 既存ノードを把握したい時は list_by_type / find_related を遠慮なく使う (これは承認不要)。
- コードを読みたい時は Glob / Grep / Read (codebasePath あり時のみ)。

出力規約 (tool_use):
- create_node(adoptAs, title, body, additional?): title は "[AI] " プレフィックス推奨
- create_edge(from, to, type): SysML 2.0 エッジ種別
```

---

## 4. frontend 実装

### 4.1 WS クライアント拡張

`packages/frontend/src/lib/ws.ts`:
- 既存 `startAgent` に加えて `openChat(projectId, threadId): ChatHandle` を追加
- `ChatHandle`:
  - `events: AsyncIterable<ChatEvent>` — server から流れるイベント
  - `sendUserMessage(text)` / `approveTool(toolUseId, approved)` — クライアント → server
  - `close()` — 切断

### 4.2 store 拡張

`packages/frontend/src/lib/store.ts`:

```typescript
interface ChatThreadState {
  id: string;
  title: string;
  messages: ChatMessage[];
  streaming: boolean;    // AI ターン中
  handle: ChatHandle | null;  // 現在開いてるなら
}

// CanvasState に追加:
chatThreads: Record<string, ChatThreadState>;  // threadId → state
activeChatThreadId: string | null;
chatTabVisible: boolean;

openChat: (threadId: string) => Promise<void>;
createChat: () => Promise<string>;  // 新スレッド作成、id 返す
switchChat: (threadId: string) => void;
sendChatMessage: (text: string) => Promise<void>;
approveChatTool: (toolUseId: string, approved: boolean) => Promise<void>;
```

### 4.3 新規コンポーネント

- `packages/frontend/src/components/chat/chat-tab.tsx` (外枠 + スレッド selector + content)
- `packages/frontend/src/components/chat/chat-thread-list.tsx` (dropdown or list)
- `packages/frontend/src/components/chat/chat-messages.tsx` (メッセージリスト、自動スクロール)
- `packages/frontend/src/components/chat/chat-message.tsx` (1 msg、role 別 render)
- `packages/frontend/src/components/chat/tool-approval-card.tsx` (tool_use pending 時のカード UI)
- `packages/frontend/src/components/chat/chat-input.tsx` (textarea + 送信)

### 4.4 DetailSheet の改修

- 現在: 選択ノードなら Detail / 無選択なら「ノードを選択してください」
- 新: 上部タブ 2 枚 (`Detail` / `Chat`)。Detail タブは既存の中身、Chat タブは ChatTab。
- タブ状態はローカル (useState) で OK、プロジェクト内グローバルには持たない (永続化不要)

---

## 5. API routes

- `GET /api/projects/[id]/chats` → `{ threads: ChatThreadMeta[] }`
- `POST /api/projects/[id]/chats` → 新規スレッド作成 `{ threadId, title }`
- `GET /api/projects/[id]/chats/[threadId]` → フル `ChatThread`

WS の `/chat` は `packages/ai-engine` 側で別エンドポイントとして実装 (既存 `/agent` 同居)。

---

## 6. テスト方針

### 6.1 ユニット

| package | テスト |
|---|---|
| core | Chat* schema のパース / 拒否 |
| storage | ChatStore の CRUD + 複数スレッド + YAML 往復 |
| ai-engine | chat-runner の multi-turn (mock SDK) / tool 承認 Promise 解決 / 拒否時の tool_result 合成 |
| ai-engine | tool allowlist (承認 intercept が create_* のみ、find/list は素通り) |
| frontend | store の openChat / sendChatMessage / approveChatTool シナリオ |
| frontend | ChatTab / ChatMessage / ToolApprovalCard のレンダリング |

### 6.2 手動 E2E

`docs/phase-6-manual-e2e.md`:

1. 空プロジェクト作成 → 右サイドバー Chat タブ → 新規スレッド
2. user: "Confluence import 機能追加したい"
3. AI: スコープ確認質問
4. user: "認証と、ページ 1 枚取り込みだけ"
5. AI: `create_node(adoptAs=requirement, title=Confluence 接続...)` tool_use pending
6. user: 承認 → requirement ノードがキャンバスに生える
7. AI: 次の `create_node(adoptAs=usecase, ...)` tool_use pending
8. user: 却下 → カードが灰色に、AI が続き質問
9. 途中で新規スレッド作成 → 別コンテキストで会話
10. 既存スレッドへ切替 → 履歴保持確認
11. サーバ再起動 → `.tally/chats/<id>.yaml` から再 load 成功

---

## 7. follow-up (Phase 7+)

- **スレッド管理 UX**: 検索 / ピン留め / アーカイブ / リネーム / 削除
- **チェーン実行**: チャットから既存ボタンエージェント (decompose-to-stories 等) を tool として呼べる
- **会話から要約生成**: 長いスレッドから要点抽出して新スレッドのシードに
- **proposal 採用の chat 側 UI**: 承認時に adoptAs 変更 / 座標調整できる
- **複数 approve の batching**: 連続 tool_use を 1 回の UI 操作で承認
- **message 再実行**: 任意 user message をエディットして再実行 (branching)
- **モデル選択**: Opus / Sonnet / Haiku 切替 (コスト調整)
- **スレッド間リンク**: 「このスレッドの議論からこのノード生まれた」トレース

---

## 8. 受入条件

1. `pnpm -r test` / `pnpm -r typecheck` 全緑
2. 右サイドバーに Chat タブが出る、Detail と切替可能
3. 新規スレッド作成 → user メッセージ送信 → AI からストリーミングで応答到達
4. AI が `create_node` を呼ぶと承認 UI が出る、承認で node 作成、却下でスキップ
5. 承認済み create_node の結果がキャンバスに即反映 (既存 Zustand node_created 経路)
6. 同プロジェクトで複数スレッド作成 → 切替で独立コンテキスト保持
7. `.tally/chats/<id>.yaml` にスレッドが永続化、リロード後も復元
8. ADR-0007 準拠: Bash / Edit / Write は allowedTools に無く SDK 経由で実行されない
9. codebasePath 設定済みなら AI が Glob/Read で codebase を読める

---

## 9. 実装規模見積もり

- core / schema: 0.3 日
- storage (ChatStore + YAML): 0.5 日
- ai-engine (chat-runner + WS /chat + tool 承認 intercept): **1.5-2 日** (最も重い)
- frontend (ChatTab + 下位コンポーネント + store 拡張 + ws 拡張): **1.5 日**
- API routes: 0.3 日
- テスト + E2E doc: 0.5 日
- **合計 4.5〜5 日** (通しで分割実装)

段階投入の推奨順:
1. storage + schema (裏側を先に固める)
2. ai-engine chat-runner (承認含む、mock SDK でテスト)
3. WS プロトコルを frontend `ws.ts` に繋ぐ
4. UI (ChatTab、メッセージ、承認カード)
5. スレッド管理 (一覧 / 切替 / 新規)
6. E2E 手動確認
7. follow-up フィードバックを Phase 7 で

---

## 10. オープン論点

なし。brainstorming で以下を合意済み:
- 既存ボタン UX と共存
- 個別承認 (tool 毎)
- 右サイドバー Detail と共存 (タブ切替)
- マルチスレッド、.tally/chats/ で永続化
- allowedTools は MCP 4 個 + codebasePath 時のみコード探索
