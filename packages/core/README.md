# @tally/core

Tally のドメイン型定義とドメインロジック。他パッケージから依存される最下層。

## 責務

- `Node`, `Edge`, `Project`, `NodeType`, `EdgeType` などの型定義
- UI メタデータ (`NODE_META`, `EDGE_META`)
- YAML バリデーション用 Zod スキーマ
- ID 生成ユーティリティ
- ドメインロジック（論点の決定判定、ストーリーの進捗計算など、I/Oを伴わないロジック）

## 禁止事項

**このパッケージに以下を含めない**:

- React / Next.js などの UI フレームワーク
- Node.js の fs / path / http などの I/O
- データベースクライアント
- AI SDK

型と純粋関数のみ。テストは Vitest で完結させる。

## ディレクトリ構造

```
src/
├── types.ts        # Node, Edge, Project 等の型
├── meta.ts         # NODE_META, EDGE_META
├── schema.ts       # Zod スキーマ
├── id.ts           # ID 生成
├── logic/          # 純粋ドメインロジック
│   ├── question.ts   # 論点の決定判定
│   └── story.ts      # ストーリー進捗計算
└── index.ts        # 公開API
```

## 開発

```bash
pnpm --filter @tally/core dev      # watch モード
pnpm --filter @tally/core test     # テスト
pnpm --filter @tally/core build    # ビルド
```

詳細は `docs/02-domain-model.md` 参照。
