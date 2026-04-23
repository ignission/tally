---
paths:
  - "packages/**"
---

# テストルール

## フレームワーク

- **vitest** で統一（全パッケージ共通）
- テストファイル: 対象ファイルと同じディレクトリに `*.test.ts` / `*.test.tsx`
- 実行: ルートから `pnpm test`（全パッケージ）、個別は `pnpm -F @tally/<package> test`

## テスト方針

### ユニットテスト必須

- `packages/core` のスキーマ・ID 生成ロジック
- `packages/storage` の YAML 読み書き、レジストリ操作、プロジェクト初期化
- `packages/ai-engine` の tools / agents の入出力契約
- `packages/frontend` の Zustand ストア、React Flow アダプタ、UI 純粋関数

### モック化

- **Claude Agent SDK 呼び出しはモック**（実際の API は呼ばない）
- **ファイルシステムはインメモリ**（`memfs` or tmpdir 使い捨て）
- **ネットワーク呼び出しはモック**

### 禁止事項

- 本物の `~/.local/share/tally/registry.yaml` に書き込むテスト（`TALLY_HOME` で隔離）
- テスト間の状態共有（各テストは独立）

## カバレッジ

- 重要ロジック（エッジ種別判定、プロジェクト検索、YAML パース）は必ずカバー
- UI の見た目だけの部分はカバレッジ不要
