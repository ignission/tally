# 03. アーキテクチャ

## 全体構成

Tally はモノレポ構成で、4つの主要パッケージから成る。

```
tally/
├── packages/
│   ├── core/        # 型定義・ドメインロジック・YAML スキーマ
│   ├── frontend/    # Next.js, キャンバスUI
│   ├── ai-engine/   # Claude Agent SDK ラッパー、WebSocketサーバー
│   └── storage/     # プロジェクトディレクトリへの YAML 読み書き、レジストリ管理
```

## レイヤー構成

```
┌─────────────────────────────────────────────┐
│  Frontend (Next.js + React Flow)             │
│  - キャンバス / ノード編集 / 詳細シート           │
└────────┬───────────────────────┬─────────────┘
         │ HTTP (REST)            │ WebSocket
┌────────┴────────────┐  ┌───────┴──────────────┐
│  Backend API         │  │  AI Engine            │
│  (Next.js Routes)    │  │  (Agent SDK Wrapper)  │
│  - CRUD              │  │  - 詳細化              │
│  - Project 管理       │  │  - 関連コード探索       │
└────────┬────────────┘  │  - 影響分析            │
         │                │  - ストーリー分解       │
┌────────┴────────────┐  │  - 論点抽出            │
│  Storage Layer       │  │  - 要求書取り込み       │
│  - YAML 読み書き       │  └───────────┬──────────┘
│  - projectDir 操作  │              │
└─────────────────────┘              │
                                      │ Claude Agent SDK
                                      │ (Read / Glob / Grep / MCP)
                                      ▼
                           ┌──────────────────────┐
                           │  Existing Codebase    │
                           │  (Git Repository)     │
                           └──────────────────────┘
```

## 各パッケージの責務

### packages/core

型定義とドメインロジックのみ。他パッケージから依存される一番下の層。

- `types.ts`：Node, Edge, Project, NodeType, EdgeType 等の型定義
- `meta.ts`：UI メタデータ（NODE_META, EDGE_META）
- `schema.ts`：YAML バリデーション用の Zod スキーマ
- `id.ts`：ID 生成ユーティリティ

**UI 依存・I/O 依存は一切含めない**。React も Node.js の fs も import しない。

### packages/frontend

Next.js 15 App Router ベースのフロントエンド。

- `app/`：Next.js ページとレイアウト
- `components/canvas/`：React Flow ベースのキャンバス
- `components/sheet/`：詳細シート、パネル類
- `components/nodes/`：ノード型ごとのカスタムレンダラ
- `lib/store.ts`：Zustand ストア（キャンバス状態）
- `lib/api.ts`：バックエンド API クライアント
- `lib/ws.ts`：AI Engine WebSocket クライアント

### packages/ai-engine

Claude Agent SDK のラッパー。単独プロセスとして起動し、フロントから WebSocket で叩く。

- `server.ts`：WebSocket サーバー起動
- `tools/`：Tally カスタムツール（tally_create_node など）
- `agents/`：各 AI アクションの実装
  - `decompose-to-stories.ts`
  - `find-related-code.ts`
  - `analyze-impact.ts`
  - `extract-questions.ts`
  - `ingest-document.ts`

ストリーミングで進捗をフロントに流す（`thinking` / `tool_use` / `tool_result` / `done`）。

### packages/storage

永続化層。プロジェクトディレクトリ直下の YAML ファイルを読み書きする。`.tally/` サブディレクトリは設けない。

- `project-store.ts`：プロジェクト単位の CRUD（projectDir 引数で初期化）
- `registry-store.ts`：レジストリ（`$TALLY_HOME/registry.yaml`）の読み書き
- `node-store.ts`：ノード単位の CRUD
- `edge-store.ts`：エッジ単位の CRUD
- `yaml.ts`：YAML 読み書きユーティリティ
- `watcher.ts`：ファイル監視（外部変更の反映）

MVP では DB を使わず、ファイルシステムのみ。将来的に SQLite or PostgreSQL への差し替え可能にするため、`ProjectStore` インターフェースで抽象化する。

## データフロー

### ノード作成（フロント起点）

```
User clicks "+ Add Node"
  → Zustand store updates (optimistic)
  → POST /api/projects/:id/nodes
    → storage.addNode(projectId, node)
      → write <projectDir>/nodes/<id>.yaml
  → Response { node: Node }
  → Zustand confirms
```

### AI アクション（ストーリー分解）

```
User taps "UC" node → "ストーリー分解"
  → Frontend opens WS connection
  → Send { kind: 'decompose_to_stories', projectId, nodeId }
  → AI Engine:
    - Fetch UC node from Storage
    - Invoke Agent SDK query()
    - System prompt: "SysML準拠で分解..."
    - Claude uses tools:
      - Read/Glob/Grep existing code
      - tally_create_node (x3 for stories)
      - tally_create_edge (x3 for contain edges)
    - Each tool call streams progress:
      - 'thinking' → shown in sidebar
      - 'tool_use' → spinner badge
      - 'tool_result' → triggers canvas refresh
  → Done event → WS closes
  → Frontend re-fetches project state
```

## プロセス構成

開発時・本番ともに3プロセス構成。

```
$ pnpm dev
├── frontend (Next.js dev server, :3000)
├── ai-engine (WebSocket server, :3001)
└── storage (inline in Next.js Route Handlers)
```

AI Engine を別プロセスにする理由：
- Agent SDK のエージェントループが長時間走るため、Next.js のリクエストタイムアウトに引っかかる
- ストリーミングの取り回しが WebSocket の方が素直
- 将来的に別言語（Python 等）で書き換える可能性を残す

## 型共有

`packages/core` の型定義を、`frontend` と `ai-engine` が直接 import する。`storage` は YAML 読み書き時に Zod でバリデーション。

## 外部依存

### 必須

- `@anthropic-ai/claude-agent-sdk`（AI Engine）
- `@xyflow/react`（Frontend, React Flow）
- `next`（Frontend）
- `zustand`（Frontend）
- `js-yaml`（Storage）
- `zod`（Core, Storage）
- `ws`（AI Engine）

### 開発

- `typescript`
- `vitest`（テスト）
- `@biomejs/biome`（Lint + Format、ADR-0004）

## 環境変数

```
ANTHROPIC_API_KEY=sk-ant-...   # Claude Agent SDK
TALLY_AI_PORT=3001             # AI Engine WebSocket ポート
TALLY_HOME=~/.local/share/tally  # レジストリ・デフォルトプロジェクト置き場（省略時はこの値）
```

## セキュリティ考慮

- API キーは環境変数経由、UI には出さない
- Agent SDK の `permissionMode` は `acceptEdits` ではなく明示的に制限（MVPでは read-only ツールのみ許可）
- 外部リポジトリを読む場合、読み取り専用モード
- コード内容を Claude に送る前にユーザー同意（ON/OFF 切替）
