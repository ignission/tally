# @tally/ai-engine

Claude Agent SDK を使った AI 支援レイヤー。独立プロセスとして起動し、フロントから WebSocket で叩く。

## 責務

- 各 AI アクション（詳細化 / 関連コード探索 / 影響分析 / ストーリー分解 / 論点抽出 / 要求書取り込み）の実装
- Tally 固有のカスタムツール提供（`tally_create_node`, `tally_create_edge` 等）
- Claude Agent SDK の組み込みツール（Read, Glob, Grep）を使った既存コード探索
- WebSocket によるストリーミング通信

## 技術選定

- **`@anthropic-ai/claude-agent-sdk`**: エージェントループ、ツール実行、コンテキスト管理
- **`ws`**: WebSocket サーバー
- **`zod`**: ツール引数のバリデーション

ADR-0002 参照。

## ディレクトリ構造

```
src/
├── server.ts                 # WebSocket サーバーエントリ
├── tools/
│   ├── index.ts              # createTallyTools
│   └── store-interface.ts    # ProjectStore インターフェース
├── agents/
│   ├── decompose-to-stories.ts
│   ├── find-related-code.ts
│   ├── analyze-impact.ts
│   ├── extract-questions.ts
│   └── ingest-document.ts
├── dispatch.ts               # リクエスト → エージェントのディスパッチ
└── types.ts                  # AgentMessage 型など
```

## プロトコル

WebSocket で以下のメッセージをやり取りする。

### クライアント → サーバー

```typescript
type AgentRequest =
  | { kind: 'decompose_to_stories'; projectId: string; nodeId: string }
  | { kind: 'find_related_code';    projectId: string; nodeId: string }
  | { kind: 'analyze_impact';        projectId: string; nodeId: string }
  | { kind: 'extract_questions';     projectId: string; nodeId: string }
  | { kind: 'ingest_document';       projectId: string; text: string };
```

### サーバー → クライアント（ストリーミング）

```typescript
type AgentMessage =
  | { kind: 'thinking'; text: string }        // Claude の思考
  | { kind: 'tool_use'; tool: string; input: unknown }  // ツール呼び出し開始
  | { kind: 'tool_result'; tool: string; output: string }  // ツール実行結果
  | { kind: 'done'; summary: string }         // 完了
  | { kind: 'error'; message: string };
```

## セキュリティ

- API キーは環境変数経由（`ANTHROPIC_API_KEY`）
- MVP では読み取り専用ツール（Read, Glob, Grep）のみ許可
- Edit, Bash は許可しない（将来別途 ADR で検討）

## 開発

```bash
pnpm --filter @tally/ai-engine dev      # nodemon で起動
pnpm --filter @tally/ai-engine test
```

## 環境変数

```
ANTHROPIC_API_KEY=sk-ant-...
TALLY_AI_PORT=3001
```
