# Changelog

すべての変更を記録する。フォーマットは [Keep a Changelog](https://keepachangelog.com/) を参考にしている。
バージョニングは日付ベース (`YYYY.M.D.N`、同日再リリース時は `N` を増やす)。

## [2026.4.22.1] - 2026-04-22

プロジェクト作成/インポート周りの UX 改善。初回利用時のつまずきポイントと、フォルダピッカーの分かりにくさを解消。

### Added

- トップ画面のダークテーマ対応（プロジェクト画面と統一）
- フォルダピッカーの空状態メッセージ（「サブフォルダがありません」「隠しフォルダのみ」を明示）
- 「既存プロジェクトを選択」モードで `project.yaml` 無しのとき、理由を説明するヒント文を表示

### Changed

- 新規プロジェクトの「保存先」表示を「(未選択)」から「プロジェクト名を入力すると自動で設定されます」に変更（必須選択と誤解されない文言へ）
- 保存先変更ボタンを「別のフォルダにする」に統一（自動設定の上書きであることを明示）
- 選択ボタンの disabled 状態に視覚的スタイル（opacity 0.45 + cursor: not-allowed）を追加

### Fixed

- 初回プロジェクト作成時、デフォルト保存先ルート (`$TALLY_HOME/projects/`) が未作成だと「親ディレクトリが存在しない」エラーで失敗する問題

## [2026.4.22.0] - 2026-04-22

プロジェクトストレージ再設計。プロジェクトをリポジトリから独立した第一級の存在に昇格させ、0 件以上の `codebases[]` を参照できるモデルに刷新。保存先は XDG 準拠のグローバルディレクトリをデフォルトにし、レジストリによる明示発見 + バックエンド駆動フォルダピッカーで作成・インポートを行う。

### Added

- **プロジェクトレジストリ**: `~/.local/share/tally/registry.yaml` で既知プロジェクトを明示管理。`TALLY_HOME` 環境変数で上書き可能 (ADR-0009)
- **複数コードベース参照**: 1 プロジェクトが 0 件以上の `Codebase[]` を持てる。フロント + バック + 共有型などマルチリポを自然に扱える (ADR-0010)
- **フォルダピッカー**: バックエンド駆動 (`/api/fs/ls` + `/api/fs/mkdir`) のディレクトリブラウザ。プロジェクト作成・インポート・コードベース追加の全フローで利用
- **プロジェクトインポート**: 既存プロジェクト (別マシンから clone した repo 等) をレジストリに取り込む新規フロー
- **デフォルトパス提案 API** (`/api/projects/default-path`): プロジェクト名を slug 化し、`<TALLY_HOME>/projects/<slug>/` を衝突回避付きで提案
- **AI アクションの codebase 選択**: 0 件時は disable、1 件時は自動、複数件時は選択 UI を表示
- **ADR-0008 / 0009 / 0010** 新規追加（リポジトリ切り離し、レジストリ、複数 codebases）

### Changed

- **破壊的**: `Project.codebasePath: string` + `additionalCodebasePaths: string[]` を廃止、`Project.codebases: Codebase[]` に一本化 (ADR-0010)
- **破壊的**: `.tally/` サブディレクトリ規約を廃止。プロジェクトディレクトリ**直下**に `project.yaml` / `nodes/` / `edges/` / `chats/` を配置 (ADR-0008)
- **破壊的**: `TALLY_WORKSPACE` 環境変数と ghq 連携による暗黙スキャンを全廃。レジストリのみで発見 (ADR-0009)
- `CodeRefNode` に `codebaseId` を必須フィールドとして追加。参照先コードベースを明示
- `FileSystemProjectStore` / `FileSystemChatStore` / `initProject` / `clearProject` のコンストラクタ引数を `workspaceRoot` から `projectDir` にリネーム
- AI エージェント (`find-related-code` / `analyze-impact` / `codebase-anchor` 等) のシグネチャを `codebase: Codebase` 引数に統一。呼び出し側が明示的に対象 codebase を渡す
- プロジェクト作成時、YAML 書き込みは temp file → rename による原子的書き込みに変更

### Removed

- `packages/storage/src/paths.ts` (`project-dir.ts` に置換)
- `packages/storage/src/project-resolver.ts` (`registry.ts` の `listProjects` に置換)
- `packages/frontend/src/lib/project-resolver.ts`
- `packages/frontend/src/app/api/workspace-candidates/route.ts`
- 旧 `NewProjectDialog` の ghq 候補リスト UI
- 旧 `ProjectSettingsDialog` の `codebasePath` / `additionalCodebasePaths` 編集 UI
- ADR-0003 のステータスを `Superseded by ADR-0008` に更新

### Fixed

- **P1 regression**: `create_node` ツールが coderef proposal を作る際に `codebaseId` を自動注入するよう修正。これまで AI が生成した coderef proposal は `codebaseId` を持たず、`transmuteNode` の整合性検証で採用できないバグがあった
- `findDuplicateCoderef` が `codebaseId` 込みで比較するよう修正。同一相対 path が異なる codebase に存在するケースで誤検出していた
- `FolderBrowserDialog` のパステキスト入力を draft 管理に。Enter / blur で確定する方式にして、中間パスの解決失敗でスナップバックする UX バグを解消
