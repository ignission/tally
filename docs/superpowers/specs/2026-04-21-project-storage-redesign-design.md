# プロジェクトストレージ再設計

- **日付**: 2026-04-21
- **ステータス**: Design (未実装)
- **関連 ADR**: ADR-0008 / ADR-0009 / ADR-0010（新規）、ADR-0003（Supersede）

## 背景

現状の Tally は ADR-0003 に基づき、プロジェクトを対象リポジトリ直下の `.tally/` ディレクトリに YAML ファイル群として保存している。発見は `ghq list -p` と `TALLY_WORKSPACE` 環境変数によるスキャンで行う。

この設計は「1 プロジェクト = 1 リポジトリ」を前提としているが、実際のユースケースではフロントエンドとバックエンドが別リポジトリに分かれる構成が頻出する。現状では横断プロジェクトを素直に表現できない。

加えて、個人の思考ログ・初期検証段階のアイデアなど「まだリポジトリに紐付けたくない」プロジェクトの置き場所がない。

## 目標

1. プロジェクトをリポジトリから独立した第一級の存在として扱う
2. 0 件以上のコードベースを 1 プロジェクトから参照できる（未紐付けのアイデアから多リポジトリ横断プロジェクトまでを同一モデルで扱う）
3. 保存先をユーザーが任意に選べる（デフォルトは `~/.local/share/tally/projects/`）
4. 発見ロジックを明示レジストリに統一し、暗黙スキャンを廃止する
5. フォルダ選択ダイアログ（バックエンド駆動）でプロジェクト作成・インポートを行う

後方互換は維持しない。既存の `.tally/` 規約・`TALLY_WORKSPACE`・ghq 連携はすべて廃止し、ADR-0003 を Supersede する。

## アーキテクチャ概要

**コアコンセプト**: プロジェクト = 任意のディレクトリ。そのディレクトリ直下に `project.yaml` / `nodes/` / `edges/` / `chats/` を配置する。`.tally/` というサブディレクトリ規約は廃止する。

**5 本の柱**:

1. プロジェクト = ディレクトリ（`.tally/` 命名なし）
2. 場所は自由（デフォルト `~/.local/share/tally/projects/<slug>/` を提案、ユーザーが最終決定）
3. レジストリで管理（`~/.local/share/tally/registry.yaml`）
4. 複数コードベース（`codebases[]`、code ノードは `codebaseId` 参照）
5. フォルダピッカー必須（バックエンド駆動ブラウザ）

## データモデル

### Project 型

```ts
interface Project {
  id: string;                  // nanoid (proj_xxxxx)
  name: string;
  description?: string;
  codebases: Codebase[];       // 0 件以上（初期検討用に空配列を許容）
  createdAt: string;
  updatedAt: string;
}

interface Codebase {
  id: string;                  // ユーザー指定 short id
  label: string;               // 表示名
  path: string;                // 絶対パス
}
```

設計判断:
- `codebasePath: string` / `additionalCodebasePaths: string[]` は完全削除し、`codebases[]` に一元化
- `codebases` は空配列を許容する。これにより「まだリポジトリを決めていないアイデア段階」のプロジェクトを自然に扱える
- code ノードが存在するときは最低 1 件の codebase が必要（整合性制約）。code ノードが無ければ codebases は 0 件でよい
- `primary` フラグは持たない。必要なら配列順で表現（先頭が主）
- `Codebase.id` は code ノードからの参照キー。人間可読必須
- パスは絶対パス必須（マシン間持ち回りは別スコープ）

codebases 0 件時の UI 挙動:
- code ノード追加系 UI（コード参照ボタン、AI の「関連コード探索」等）はすべて無効化し、ツールチップで「コードベースを追加してください」と表示
- プロジェクト設定から後からいつでも codebase を追加できる

### CodeNode 型

```ts
interface CodeNode {
  id: string;
  type: 'code';
  codebaseId: string;          // 必須
  path: string;                // codebase root からの相対パス
  // ... 既存フィールド
}
```

- `codebaseId` 必須。古いスキーマのロードコードは存在させない
- `codebases[].id` に存在しない `codebaseId` を持つ code ノードは、ロード時に検出してエラー通知（自動削除はしない）

### バリデーション規約

- `codebases` は空配列可（`code` ノードが存在する場合のみ最低 1 件必要）
- `codebases[].id` に重複 → プロジェクト更新拒否
- `codebases[].id` は `/^[a-z][a-z0-9-]{0,31}$/` に制限（ファイルシステム安全な short ID）
- code ノード保存時、`codebaseId` がプロジェクト内に存在するか検証（失敗時はエラー、code ノードは作成しない）
- 既存 code ノードを持つプロジェクトから codebase を削除しようとした場合、その codebase を参照する code ノードがあるなら削除拒否（あるいは明示確認）

### project.yaml 例

```yaml
id: proj_abc123
name: TaskFlow 招待機能追加
description: SaaS にチーム招待機能を追加するプロジェクト
codebases:
  - id: frontend
    label: TaskFlow Web
    path: /Users/you/dev/github.com/acme/taskflow-web
  - id: backend
    label: TaskFlow API
    path: /Users/you/dev/github.com/acme/taskflow-api
createdAt: 2026-04-21T10:00:00Z
updatedAt: 2026-04-21T10:00:00Z
```

### nodes/code-*.yaml 例

```yaml
id: code_invite_handler
type: code
codebaseId: backend
path: src/handlers/invite.ts
x: 420
y: 180
title: 招待ハンドラ
```

## レジストリ

### ファイル配置

```
$XDG_DATA_HOME/tally/              (省略時 ~/.local/share/tally/)
├── registry.yaml                  # 既知プロジェクト一覧
└── projects/                      # デフォルト作成先（固定ではない）
    ├── taskflow-invite/           # ディレクトリ名はユーザーが決める（slug 提案）
    │   ├── project.yaml           # id は中身で管理（例: proj_abc123）
    │   ├── nodes/
    │   ├── edges/
    │   └── chats/
    └── personal-thoughts/ ...
```

`projects/` 配下はデフォルトの置き場。ユーザーが別パスを選べばそちらに作られ、`projects/` には作られない。

### registry.yaml スキーマ

```yaml
version: 1
projects:
  - id: proj_abc123
    path: /Users/you/.local/share/tally/projects/taskflow-invite
    lastOpenedAt: 2026-04-21T10:00:00Z
  - id: proj_xyz789
    path: /Users/you/dev/shared-specs/auth-migration
    lastOpenedAt: 2026-04-20T15:00:00Z
```

ディレクトリ名とプロジェクト id は独立していることに注意（ユーザーは dir 名を自由に決められる）。

- `id` は project.yaml の id と必ず一致
- `path` は絶対パス（プロジェクトディレクトリそのもの、`project.yaml` の親）
- `lastOpenedAt` は UI のソート用
- `version` はスキーマ進化のため

### 環境変数

- `TALLY_HOME`: レジストリとデフォルト projects/ の親ディレクトリ。省略時 `$XDG_DATA_HOME/tally` → `~/.local/share/tally`
- `TALLY_WORKSPACE` は廃止
- ghq 連携は廃止

### API（`packages/storage/src/registry.ts`）

```ts
export interface RegistryEntry {
  id: string;
  path: string;
  lastOpenedAt: string;
}

export interface Registry {
  version: 1;
  projects: RegistryEntry[];
}

export function resolveTallyHome(): string;
export function resolveRegistryPath(): string;
export function resolveDefaultProjectsRoot(): string;

export async function loadRegistry(): Promise<Registry>;
export async function saveRegistry(r: Registry): Promise<void>;

export async function listProjects(): Promise<RegistryEntry[]>;   // lastOpenedAt 降順
export async function registerProject(entry: { id: string; path: string }): Promise<void>;
export async function unregisterProject(id: string): Promise<void>;
export async function touchProject(id: string): Promise<void>;    // lastOpenedAt 更新
```

### 不整合処理

- path 先にディレクトリが無い: UI で「見つからない」状態表示 + 「再選択」or「レジストリから削除」を選ばせる。自動削除はしない
- path 先の project.yaml の id が registry と食い違う: エラー表示、ユーザーに修正させる
- id 重複がレジストリ内に存在: 後勝ち（warn ログ + 後発を採用）。作成時は衝突チェック後に新規 id を再生成

### 書き込みアトミシティ

registry.yaml は temp file → rename で原子的に書く。プロジェクト内の YAML 群も同方式（既存 `yaml.ts` に atomicWriteFile ヘルパを揃える）。

## フォルダブラウザ

### バックエンド API（Next.js Route Handlers）

```
GET /api/fs/ls?path=<abs-path>
```

レスポンス:

```ts
interface FsListResponse {
  path: string;                    // 正規化された絶対パス
  parent: string | null;           // 1 つ上。ルート時は null
  entries: FsEntry[];              // ディレクトリのみ
  containsProjectYaml: boolean;    // この dir が project.yaml を含むか
}

interface FsEntry {
  name: string;
  path: string;
  isHidden: boolean;               // 先頭 "." 判定
  hasProjectYaml: boolean;         // この子が project.yaml を含むか（インポート用ヒント）
}
```

仕様:
- `path` 未指定時は `os.homedir()` にフォールバック
- ディレクトリのみ返す（ファイル非表示）
- 隠しディレクトリは `isHidden: true` で返し、フロントでトグル表示
- `~` / 環境変数展開はサーバ側で行わない（クライアントが絶対パスを明示）
- エラーは HTTP 400/403/404 を使い分け（権限・不在・不正パス）

バリデーション（path パラメータ）:
- 絶対パスであること（`path.isAbsolute()` チェック）。相対パスは 400
- `path.resolve()` 後に再度絶対パス性と正規化（`..` 解決後のパス）を検証
- 正規化後パスと受信パスが乖離する（= `..` 経由で上位に抜けようとした）場合、受信パスをそのまま受理した結果ではなく正規化後のパスで処理する（path traversal 対策）
- 明示的にアクセス拒否するディレクトリは設けない（ローカル dev tool 前提のため）が、`/proc` `/sys` など読み取り困難な領域は 200 で空 entries に丸める

セキュリティ:
- Tally は localhost 限定 dev tool 前提。API は任意 `path` を読むため `127.0.0.1` バインド・CORS 無効を維持
- symlink は辿る（ユーザー期待値）。`/proc`, `/sys` などシステムパスは深入りしない（200 で空 entries）

```
POST /api/fs/mkdir
{ "path": string, "name": string }
```

- `path/name` で安全に mkdir
- 既存時は 409
- `name` は path separator・`.`/`..` を拒否、空文字列も拒否
- `path` は `GET /api/fs/ls` と同じバリデーション（絶対パス + `path.resolve` 後再検証）
- `path.join(path, name)` 後、正規化したパスが元の `path` の配下にあることを再確認（path traversal 二重防御）

### `FolderBrowserDialog` コンポーネント

Props:

```ts
interface FolderBrowserDialogProps {
  open: boolean;
  initialPath?: string;            // 省略時 ~
  purpose: 'create-project' | 'import-project' | 'add-codebase';
  onConfirm: (absolutePath: string) => void;
  onClose: () => void;
}
```

- `purpose` は表示テキスト・確定ボタンラベル・確定条件を切り替える。**全ケースで返り値は「確定した絶対パス 1 本」** という一貫した契約を持つ
  - create-project: 選択 dir を**プロジェクトルートそのもの**として確定。ダイアログ自身は dir の中身を制約せず返り値としてパスを返すだけ（空・非空の判定は呼び出し側 = NewProjectDialog 側で行う。後述のバリデーション参照）。呼び出し側はこのパスに直接 `project.yaml` / `nodes/` / `edges/` を書き込む
  - import-project: 選択 dir に `project.yaml` 必須（無ければ disabled）。そのままプロジェクトルートとして登録
  - add-codebase: 選択 dir をそのまま codebase path に
- **ディレクトリ名とプロジェクト id は独立**。id は内部識別子、ディレクトリ名は人間が好きに決める（例：`acme-taskflow-invite/`）。レジストリが両者を紐付ける
- UI ロジックは共通

### UI レイアウト（概略）

```
┌─────────────────────────────────────────────┐
│ 保存先フォルダを選択                         │
├─────────────────────────────────────────────┤
│ [ /Users/you/dev/acme         ] [ ↑ 親 ]   │
│ ───────────────────────────────────────────│
│ 📁 taskflow-web                             │
│ 📁 taskflow-api          (project.yaml あり)│
│ 📁 docs                                     │
│ ...                                          │
│ [☐] 隠しフォルダを表示                      │
├─────────────────────────────────────────────┤
│ [+ 新規フォルダ]      [キャンセル] [選択]   │
└─────────────────────────────────────────────┘
```

- パンくずはクリッカブル（各階層へジャンプ）
- テキスト入力でパス直打ち + Enter で移動（パワーユーザー向け）
- エントリクリックで潜る
- 子が project.yaml を持つ場合はバッジ表示
- 「新規フォルダ」は name 入力 → POST /api/fs/mkdir → 作成した dir に自動で移動
- キーボード: ↑↓ で選択、Enter で潜る、Cmd+Enter で確定

### NewProjectDialog 刷新

フィールド:
- プロジェクト名（必須）
- 説明（任意）
- プロジェクトルート（既定 `<TALLY_HOME>/projects/<プロジェクト名をslug化した候補>/`、「フォルダを変更」で FolderBrowserDialog）
- codebases[]（任意、0 件可。「+ 追加」で FolderBrowserDialog → short id / label 入力）

プロジェクトルートの決定ルール:
- 作成時点で id を先行生成するのではなく、**ユーザーが確定したディレクトリそのもの** をルートとする。id はレジストリ登録時に nanoid で生成し、project.yaml に記録するだけ
- デフォルト候補パスは名前入力に応じてリアルタイムで更新される（例：名前「TaskFlow 招待機能」→ `<TALLY_HOME>/projects/taskflow-invite/`）。slug 衝突時はサフィックスを付与
- デフォルト候補 dir が既に存在する場合、ユーザーに警告を表示し、「別名にする」or「フォルダを変更」を促す
- 「フォルダを変更」でユーザーが指定したパスは、**指定 dir そのものがプロジェクトルートになる**（その中にサブディレクトリを勝手に作らない）

バリデーション（NewProjectDialog 側で実施、FolderBrowserDialog 確定後に呼び出し側がチェック）:
- 名前必須
- プロジェクトルートは以下のいずれか（これ以外は作成ボタン disabled、メッセージで誘導）:
  - 存在しないパス（親ディレクトリが存在する必要あり）→ 作成時に mkdir
  - 既存の**空**ディレクトリ → そのまま使う
- 既に `project.yaml` を含む dir が選ばれた場合は「これは既存プロジェクト。インポートする？」と ProjectImportDialog への誘導を表示
- 非空だが `project.yaml` を含まない dir が選ばれた場合は「このディレクトリは空ではありません」と警告し disabled
- `codebases[].id` 重複不可

### ProjectImportDialog（新規）

- FolderBrowserDialog（purpose: 'import-project'）
- `project.yaml` を含む dir 選択 → registry に登録
- 重複 id は検出してエラー（別のプロジェクトと id 衝突した旨を表示）

### トップページ刷新

- `fetchWorkspaceCandidates()` 削除
- `fetchRegistryProjects()` に置換、lastOpenedAt 降順で一覧
- 各行に「開く」「レジストリから外す」「dir をエクスプローラで開く」
- 上部に「+ 新規プロジェクト」「既存を読み込む」の 2 アクション

## 変更対象・削除対象

### 削除

| パス | 理由 |
|---|---|
| `packages/storage/src/project-resolver.ts` | ghq/workspace scan 廃止、registry に置換 |
| `packages/storage/src/project-resolver.test.ts` | 上記に伴い |
| `packages/storage/src/index.ts` の `discoverProjects` / `listWorkspaceCandidates` / `resolveProjectById` / `loadProjectById` / `ProjectHandle` / `WorkspaceCandidate` export | 旧発見モデル廃止 |
| `packages/storage/src/index.ts` の `resolveTallyPaths` / `TallyPaths` export | `.tally/` 規約廃止（`project-dir.ts` に置換） |
| `packages/frontend/src/app/api/workspace-candidates/route.ts` | candidates API 廃止 |
| `packages/frontend/src/lib/api.ts` の `fetchWorkspaceCandidates`, `WorkspaceCandidate` | candidates モデル廃止 |
| `NewProjectDialog` の candidates UI 一式 | 刷新 |
| 環境変数 `TALLY_WORKSPACE` 参照箇所すべて | 廃止 |
| `.tally/` 規約（コード・ドキュメント・examples・テストフィクスチャ） | プロジェクト dir 名の規約を外す |
| `Project` / `ProjectMeta` の `codebasePath` / `additionalCodebasePaths` フィールド（`packages/core/src/schema.ts`）とその依存テスト | `codebases[]` に統合 |

### 新規

| パス | 役割 |
|---|---|
| `packages/storage/src/registry.ts` | Registry CRUD |
| `packages/storage/src/registry.test.ts` | 単体テスト |
| `packages/storage/src/project-dir.ts` | projectDir からの paths 解決 |
| `packages/frontend/src/app/api/fs/ls/route.ts` | ディレクトリ一覧 API |
| `packages/frontend/src/app/api/fs/mkdir/route.ts` | 新規フォルダ作成 API |
| `packages/frontend/src/components/dialog/folder-browser-dialog.tsx` | フォルダブラウザモーダル |
| `packages/frontend/src/components/dialog/project-import-dialog.tsx` | インポート用 |
| `docs/adr/0008-project-independent-from-repo.md` | ADR-0003 を Supersede |
| `docs/adr/0009-project-registry.md` | レジストリ機構 |
| `docs/adr/0010-multiple-codebases.md` | codebases[] モデル |

### 変更

| パス | 変更 |
|---|---|
| `packages/core/src/schema.ts` | Project / ProjectMeta / Codebase / CodeNode 型刷新（`codebasePath`・`additionalCodebasePaths` 削除、`codebases: Codebase[]` 追加、code ノードに `codebaseId` 追加） |
| `packages/core/src/schema.test.ts` | 上記に追従 |
| `packages/storage/src/paths.ts` | registry 対応、`.tally/` サブディレクトリ廃止 |
| `packages/storage/src/init-project.ts` | registry 登録追加、codebases 0 件可 |
| `packages/storage/src/project-store.ts` | workspaceRoot → projectDir rename、codebases 対応 |
| `packages/frontend/src/components/dialog/new-project-dialog.tsx` | 全面刷新 |
| `packages/frontend/src/components/dialog/project-settings-dialog.tsx` + `.test.tsx`（新規作成） | 削除した旧版に代わり、`codebases[]` の追加・削除・並び替え・ラベル編集を提供。0 件運用（初期アイデア）から後付けで codebase を足せる受け皿。FolderBrowserDialog（purpose: 'add-codebase'）を利用 |
| `packages/frontend/src/lib/api.ts` | registry 系クライアント追加、candidates 系削除、project meta CRUD を codebases[] 対応 |
| `packages/frontend/src/lib/store.ts` | `patchProjectMeta` 等を codebases[] 対応に刷新 |
| `packages/frontend/src/app/api/projects/[id]/route.ts` | codebases[] の読み書き、旧フィールド削除 |
| `packages/frontend/src/components/ai-actions/*` (codebase-agent-button, find-related-code-button, analyze-impact, extract-questions, graph-agent-button 等) | code 参照系 UI を codebases[] 前提に調整、codebases 0 件時は disabled |
| AI Engine (`agent-runner.ts`, `agents/codebase-anchor.ts`, `agents/find-related-code.ts`, `agents/analyze-impact.ts` ほか) | 単一 `codebasePath` 前提を捨て、対象 codebase を引数に取るよう改修（0 件時は呼び出し側が制御） |
| トップページ（projects 一覧） | registry 駆動 |
| `examples/sample-project/` | `.tally/` 廃止に伴い構造変更、旧フィクスチャ（taskflow-backend 参照など）を新 codebases[] モデルに書き換え |
| CLAUDE.md | `.tally/` 言及の除去、registry ベースに更新 |
| README.md | 起動方法・利用フロー更新 |
| `docs/adr/0003-git-managed-yaml.md` | ステータスを Superseded に更新、新 ADR へリンク |

**波及範囲の注記**: 旧 `codebasePath` / `additionalCodebasePaths` を参照するテスト・ロジックは core / storage / frontend / ai-engine 横断で 27 ファイル以上に渡る。実装時は `packages/core` の型変更を起点にコンパイルエラーを潰す方式が安全。

## テスト戦略

### packages/storage

- `registry.test.ts`: load/save ラウンドトリップ、重複 id、touch 順序、壊れた YAML のリカバリ
- `project-dir.test.ts`: projectDir から paths 生成の境界
- `init-project.test.ts`: registry 登録と project dir 作成の原子性、codebases 0 件でも成功すること、project dir が非空かつ project.yaml 無しで拒否、id 衝突時の再生成
- tmp dir fixture で XDG_DATA_HOME を差し替え、マシン環境に依存しない

### packages/frontend

- `folder-browser-dialog.test.tsx`: 潜る / 戻る / 新規作成 / 確定のユーザーフロー（Testing Library）
- `new-project-dialog.test.tsx`: 名前必須・プロジェクトルート空 dir 判定・codebases 0 件でも作成可のバリデーション
- `project-import-dialog.test.tsx`: project.yaml 有無で確定ボタン活性制御
- API ルート（fs/ls, fs/mkdir）の単体テスト: symlink, 権限エラー, 存在しないパス, path traversal 防止

### E2E（Playwright が動く段階で）

- 新規作成 → FolderBrowser → 作成 → トップに表示 → 開く → リロード後も残る
- 既存プロジェクトのインポート
- レジストリ path 消失後の UI 表示

### 廃棄

- 既存 `project-resolver.test.ts`
- ghq / TALLY_WORKSPACE を前提とした既存テスト

## ADR 構成

1. **ADR-0008: プロジェクトをリポジトリから切り離す**
   - コンテキスト: マルチレポ横断プロジェクト、repo に縛られない思考単位
   - 決定: プロジェクト = 任意のディレクトリ、`.tally/` 規約廃止
   - 影響: ADR-0003 Superseded

2. **ADR-0009: プロジェクトレジストリによる発見**
   - コンテキスト: 暗黙スキャンは予測不能
   - 決定: `~/.local/share/tally/registry.yaml` による明示レジストリのみ
   - 影響: TALLY_WORKSPACE 廃止、ghq 連携削除

3. **ADR-0010: 複数 codebases の参照モデル**
   - コンテキスト: 1 プロジェクト = 1 repo の破綻
   - 決定: `codebases[]`、code ノードは `codebaseId` 参照
   - 影響: AI エージェントの探索対象を「codebase を選択 / すべて」に拡張する後続作業

## スコープ境界

### AI Engine の in-scope / out-of-scope

データモデル刷新に伴い AI Engine の関数群もシグネチャ変更が避けられないため、最低限の修正を in-scope に含める。新機能は別 spec に回す。

**in-scope（このspec で扱う、regression 防止の最低限修正）**:
- 単一 `codebasePath` への参照を `codebases[]` に置き換えるシグネチャ改修
- 呼び出し側が対象 codebase（1 件）を引数で指定する形に変更
- 既存の単一 codebase 機能が壊れない範囲でコンパイルを通す
- codebases 0 件時は呼び出し側（UI）で操作を無効化するため、engine 側は `codebases.length === 0` のケースを受け取らない前提でよい

**out-of-scope（別 spec で扱う）**:
- 複数 codebases を跨いだ探索（cwd 切替、結果マージ、エージェント並行実行）
- ユーザーが「どの codebase を探索対象にするか」を選ぶ UI と API
- codebases 間のクロスリファレンス（backend の関数から frontend の呼び出し箇所を辿る等）

### そのほかの非スコープ

- Git 公開ワークフロー（registry 外部のチーム共有、プロジェクト dir の repo 化ヘルパ）
- マシン間移動（絶対パス持ち回り問題。将来 `Codebase.path` に変数展開や overlay を検討）
- レジストリの並行編集（現時点ではロック不要、将来必要なら fcntl lock）

## 実装順序の目安

1. `packages/core` 型刷新
2. `packages/storage/src/registry.ts` + テスト
3. `packages/storage/src/init-project.ts` / `project-store.ts` 刷新
4. バックエンド API（fs/ls, fs/mkdir）
5. `FolderBrowserDialog` + 単体テスト
6. `NewProjectDialog` 刷新
7. `ProjectImportDialog`
8. トップページ刷新
9. examples / docs / CLAUDE.md / README.md 更新
10. ADR 3 本 commit

詳細な実装計画は別途 `writing-plans` スキルで作成する。
