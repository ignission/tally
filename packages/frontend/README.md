# @tally/frontend

Next.js 15 App Router ベースのフロントエンド。キャンバスUIを担当。

## 責務

- キャンバスの表示と編集（React Flow ベース）
- ノード・エッジのインタラクション
- 詳細シート（ノード編集パネル）
- AI Engine との WebSocket 通信
- Next.js Route Handlers によるストレージ層へのプロキシ

## 技術選定

- **Next.js 15+** (App Router)
- **React Flow** (`@xyflow/react`): グラフ描画
- **Zustand**: 状態管理
- **CSS-in-JS** (コンポーネント内の style オブジェクト直書き、styled-components は使わない)

## ディレクトリ構造

```
src/
├── app/
│   ├── layout.tsx
│   ├── page.tsx              # プロジェクト一覧
│   ├── projects/[id]/page.tsx  # プロジェクト表示
│   └── api/
│       └── projects/
│           ├── route.ts           # GET /api/projects, POST
│           └── [id]/
│               ├── route.ts       # GET / PATCH / DELETE
│               ├── nodes/route.ts
│               └── edges/route.ts
├── components/
│   ├── canvas/
│   │   ├── Canvas.tsx           # メインキャンバス
│   │   └── canvas-controls.tsx
│   ├── nodes/                   # ノード型ごとのレンダラ
│   │   ├── RequirementNode.tsx
│   │   ├── UseCaseNode.tsx
│   │   ├── UserStoryNode.tsx
│   │   ├── QuestionNode.tsx
│   │   ├── CodeRefNode.tsx
│   │   ├── IssueNode.tsx
│   │   └── ProposalNode.tsx
│   ├── edges/
│   │   └── TypedEdge.tsx        # エッジ種別ごとの線種
│   └── sheet/
│       ├── DetailSheet.tsx      # 詳細シート
│       ├── NodePalette.tsx      # 新規ノード追加
│       └── AIActionPanel.tsx    # AI アクション実行UI
└── lib/
    ├── store.ts                 # Zustand ストア
    ├── api.ts                   # バックエンド API クライアント
    └── ws.ts                    # AI Engine WS クライアント
```

## 開発

```bash
pnpm --filter @tally/frontend dev        # http://localhost:3321
pnpm --filter @tally/frontend build
pnpm --filter @tally/frontend typecheck
```
