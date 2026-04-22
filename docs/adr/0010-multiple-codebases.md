# ADR-0010: 複数 codebases の参照モデル

- **日付**: 2026-04-21
- **ステータス**: Accepted

## コンテキスト

旧 `Project` 型は `codebasePath: string`（プライマリ）と `additionalCodebasePaths: string[]`（追加）という非対称な構造を持っていた。この構造には以下の問題がある。

- 「どれがプライマリか」の意味が AI エージェントと UI で曖昧
- 追加 codebase の扱い（探索するか、参照だけか）が未定義
- フロントエンド + バックエンドのようなマルチリポ構成がファーストクラスで表現できない
- `additionalCodebasePaths` が空配列のときと `null` のときで挙動が揺れる

## 決定

- `Project.codebases: Codebase[]` に一本化する
- `Codebase` の型定義:
  ```typescript
  interface Codebase {
    id: string;    // ユーザー指定の short ID、正規表現 /^[a-z][a-z0-9-]{0,31}$/
    label: string; // UI 表示用のラベル
    path: string;  // 絶対パスまたはプロジェクトディレクトリからの相対パス
  }
  ```
- `code` ノード（`coderef`）は `codebaseId` フィールドで属する codebase を参照する（必須）
- codebases は 0 件を許容する（初期アイデア段階では空、後から追加できる）
- `primary` フラグは持たず、配列の先頭が主 codebase とする慣例を採用する

### project.yaml の例

```yaml
id: proj_abc123
name: TaskFlow 招待機能追加
codebases:
  - id: backend
    label: バックエンド (Rails)
    path: /home/user/dev/taskflow-backend
  - id: frontend
    label: フロントエンド (Next.js)
    path: /home/user/dev/taskflow-frontend
```

## 影響

- AI エージェントの探索対象選択ロジックは別 spec のスコープ（このADRは「どう表現するか」のみ決める）
- coderef ノード追加時に `codebaseId` の整合性を storage 層で検証する
- 1 プロジェクト = 1 リポジトリの暗黙前提を破壊するため、関連するコード・ドキュメントを全面的に見直す
- 旧 `codebasePath` / `additionalCodebasePaths` フィールドは移行スクリプトで `codebases` に変換する

## 参考

- spec §データモデル: `docs/superpowers/specs/2026-04-21-project-storage-redesign-design.md`
- [ADR-0008: プロジェクトをリポジトリから切り離す](./0008-project-independent-from-repo.md)
