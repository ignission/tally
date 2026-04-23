---
paths:
  - "packages/**"
---

# パッケージ構成ルール

Tally は pnpm workspaces のモノレポ。各パッケージは責務が明確に分かれている。

## 責務

| パッケージ | 責務 | 依存可能先 |
|---|---|---|
| `packages/core` | ノード/エッジの型定義・スキーマ（zod）・ID/メタデータヘルパ | 他パッケージ依存禁止 |
| `packages/storage` | YAML ファイル永続化、プロジェクトディレクトリ/レジストリ管理 | core のみ |
| `packages/ai-engine` | Claude Agent SDK ラッパー、WebSocket サーバー、AI エージェント・tools | core / storage |
| `packages/frontend` | Next.js 16 App Router、React Flow キャンバス、Zustand ストア | core（型のみ） |

## ルール

- **型定義は `packages/core` 以外で定義しない**。ノード型・エッジ型を別パッケージで再定義してはならない
- **frontend から storage/ai-engine を直接 import しない**。Next.js の Route Handler 経由 or WebSocket 経由でアクセス
- **core は他パッケージに依存しない**。循環依存を避けるため
- **1 ファイル 500 行超えそうなら分割を検討**
- **ファイル名は kebab-case**（`node-canvas.tsx`、`project-store.ts`）

## 例外

- テスト (`*.test.ts`) は対象パッケージの内部 import OK
- `packages/*/package.json` の workspace 依存は `workspace:*` を使う
