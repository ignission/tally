---
paths:
  - "packages/frontend/**"
---

# フロントエンド開発ルール

## 技術スタック（固定）

- **Next.js 16+ App Router**（Pages Router は使わない）
- **React Flow** でキャンバス描画
- **Zustand** で状態管理（グローバル状態はここに集約）
- **CSS-in-JS**：コンポーネント内の `style` オブジェクト直書き
  - **styled-components / emotion / tailwind は使わない**
- **TypeScript strict**

## ディレクトリ構成

```
packages/frontend/src/
├── app/                    # App Router（page.tsx, layout.tsx, route handler）
│   └── api/                # Route Handlers
├── components/             # UI コンポーネント
│   ├── canvas/             # React Flow キャンバス本体
│   ├── nodes/              # カスタムノード（requirement, uc, story, question, proposal, ...）
│   ├── edges/              # カスタムエッジ（satisfy, contain, derive, refine, verify, trace）
│   ├── details/            # ノード詳細パネル
│   ├── chat/               # チャット UI
│   └── ...
└── lib/                    # ユーティリティ、ws クライアント、store
```

## ノード・エッジ

- **ノード型・エッジ型は `@tally/core` から import**（再定義禁止）
- AI 生成ノードは `type: 'proposal'` + 破線枠描画
- 論点ノードは「選択肢未決定=破線、決定=実線＋バッジ」で可逆

## 禁止事項

- `localStorage` / `sessionStorage` を使わない（将来の Artifact 対応のため）
- グローバルな `window` 直アクセス（SSR 互換のため `'use client'` 境界を守る）
- インラインの `<style>` タグ（`style` オブジェクトを使う）
