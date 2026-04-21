# Phase 5e: ingest-document にディレクトリ入力を追加 — 設計書

- 日付: 2026-04-20
- ステータス: Accepted (brainstorming で合意、keep it simple スコープ)
- 関連: `docs/04-roadmap.md` Phase 5 / ADR-0005 / ADR-0006 / ADR-0007 / `docs/superpowers/specs/2026-04-20-phase5d-ingest-document-design.md`

## 目的

Phase 5d で `ingest-document` が貼り付けテキストから requirement + usecase proposal を生成できるようになった。Phase 5e では **既存システムの仕様キャッチアップ** を一段階自動化する: ユーザーが「docs ディレクトリ」を指定するだけで、AI が配下の Markdown を順次読み込み、req/UC proposal にまとめる。

ドッグフード対象は対象リポジトリの `docs/` (ADR + superpowers plans/specs を含む Markdown 群)。各 plan/spec が 1 機能に対応しているため、ingest 後にキャンバスに「対象リポジトリが持つ機能マップ」が浮かび上がる想定。

## Keep it simple

MVP は既存 `ingest-document` の入力形式を拡張する最小改修。専用エージェント新設や UX 再設計には踏み込まない。

**スコープ (MVP)**:
- ingest-document の入力を discriminated union に拡張: `{ source: 'paste', text } | { source: 'docs-dir', dirPath }`
- docs-dir モード: AI が `Glob` + `Read` で対象ディレクトリ配下の `*.md` を走査し、req + usecase + satisfy エッジを生成
- UI はタブ切替え (貼り付け / ディレクトリ)

**スコープ外 (Phase 5f+ で可)**:
- コードベース直接スキャン (`summarize-codebase`)
- as-is / to-be 区別の schema 化
- オンボーディングフロー再設計
- 階層表示やキャンバスの認知負荷対策 (ノード爆発の UI)
- 部分再 ingest / インクリメンタル更新
- doc → node の trace エッジ (出典保持)

## 全体構成

```
Phase 5e スコープ
├── core: 変更なし
├── ai-engine:
│   ├── ingest-document.ts 拡張:
│   │   ├── inputSchema を discriminated union に
│   │   ├── validateInput で docs-dir のパス検証 + cwd 返却
│   │   ├── buildPrompt を source 別に分岐 (paste / docs-dir)
│   │   └── allowedTools に 'Read' / 'Glob' を追加
│   └── agent-runner: 変更なし (既に cwd / input を buildPrompt に伝搬済み)
├── frontend:
│   ├── IngestDocumentDialog 拡張:
│   │   ├── タブ切替え (貼り付け / ディレクトリ)
│   │   ├── docs-dir タブ: dirPath input (デフォルト `docs`)
│   │   └── 送信時は source 別の input を startIngestDocument に渡す
│   ├── store.startIngestDocument のシグネチャ変更 (text → input 全体)
│   └── runAgentWithInput は変更なし (既に任意 input 対応)
└── docs:
    ├── 04-roadmap.md: Phase 5e 追記 + 完了マーク
    ├── phase-5e-manual-e2e.md 新規
    └── phase-5e-progress.md 新規
```

---

## 1. ai-engine: ingest-document 拡張

### 1.1 inputSchema (discriminated union)

`packages/ai-engine/src/agents/ingest-document.ts`:

```typescript
const IngestDocumentInputSchema = z.discriminatedUnion('source', [
  z.object({
    source: z.literal('paste'),
    text: z.string().min(1).max(50_000),
  }),
  z.object({
    source: z.literal('docs-dir'),
    dirPath: z.string().min(1).max(500),
  }),
]);
type IngestDocumentInput = z.infer<typeof IngestDocumentInputSchema>;
```

### 1.2 validateInput

- paste: 既存通り `{ ok: true }` を返す (anchor 無し / cwd 無し)
- docs-dir:
  - `path.resolve(workspaceRoot, dirPath)` で絶対パス化
  - 解決先が `workspaceRoot` の **配下**であること (`..` でエスケープ不可)
  - 存在する + ディレクトリであること
  - OK なら `{ ok: true, cwd: workspaceRoot }` を返す (Read/Glob の基点)

```typescript
async validateInput({ workspaceRoot }, input) {
  if (input.source === 'paste') {
    return { ok: true };
  }
  const resolved = path.resolve(workspaceRoot, input.dirPath);
  const rel = path.relative(workspaceRoot, resolved);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    return {
      ok: false,
      code: 'bad_request',
      message: `dirPath が workspaceRoot 配下ではない: ${input.dirPath}`,
    };
  }
  try {
    const st = await fs.stat(resolved);
    if (!st.isDirectory()) {
      return {
        ok: false,
        code: 'bad_request',
        message: `dirPath がディレクトリではない: ${input.dirPath}`,
      };
    }
  } catch {
    return {
      ok: false,
      code: 'not_found',
      message: `dirPath が存在しない: ${input.dirPath}`,
    };
  }
  return { ok: true, cwd: workspaceRoot };
}
```

### 1.3 buildPrompt の分岐

`buildPrompt({ input })` で source を見て分岐:

**paste モード** (既存のまま):
- systemPrompt: Phase 5d の内容
- userPrompt: 貼り付けテキストを挿入

**docs-dir モード**:

```
あなたは Tally の要求書取り込みアシスタント (ディレクトリ版) です。
指定されたディレクトリ配下の Markdown ファイル群を読み、
プロジェクトの骨格となる requirement と usecase を proposal として生成します。

手順:
1. Glob('{dirPath}/**/*.md') で Markdown を列挙する (10〜50 ファイル想定)。
2. 各ファイルを Read で読み、システム全体が実現している / 実現しようとしている機能を把握する。
3. 「何を達成したいか」(ビジネス目標・顧客要望) を 5〜15 個の requirement proposal として抽出する。
4. 各要求を達成する機能を 10〜30 個の usecase proposal として抽出する。
5. requirement → usecase の関係を satisfy エッジで張る。
6. 最後に「読んだファイル数」「抽出した req/UC 数」「大まかな領域分類」を 4〜6 行で要約する。

出力規約は paste モードと同じ:
- create_node(adoptAs="requirement", title="[AI] <短い要求>", body="<要求の意図、背景>")
- create_node(adoptAs="usecase", title="[AI] <UC 名>", body="<UC のトリガ / 主な流れ / 終了条件>")
- create_edge(type="satisfy", from=<requirement id>, to=<usecase id>)

ツール使用方針: Glob / Read / mcp__tally__* のみ使用。Bash / Edit / Write は使わない。

Markdown 以外のファイル (image, binary) は読まない。
{dirPath} の外には Glob しない。
個数目安は上限であり、情報が薄ければ少なくて構わない。
```

user prompt:
```
以下のディレクトリを走査し、requirement と usecase proposal を生成してください。

対象ディレクトリ: {dirPath} (workspaceRoot からの相対)
```

### 1.4 allowedTools

```typescript
allowedTools: [
  'mcp__tally__create_node',
  'mcp__tally__create_edge',
  'mcp__tally__find_related',
  'mcp__tally__list_by_type',
  'Read',
  'Glob',
],
```

paste モードでも `Read` / `Glob` が利用可能になるが、プロンプトに file 参照が一切無いため AI は呼ばない想定。ADR-0007 の「allowedTools は MCP + built-in の許可リスト」という方針に沿う。

### 1.5 Registry / agent-runner

変更なし。Phase 5d で既に `input: parsed.data` を buildPrompt に伝搬済み、`cwd` も validateInput 結果から agent-runner が SDK options に渡している。

---

## 2. frontend: ダイアログ拡張

### 2.1 IngestDocumentDialog

`packages/frontend/src/components/dialog/ingest-document-dialog.tsx`:

- 上部にタブ 2 枚: **「貼り付け」** / **「ディレクトリ」**
- 貼り付けタブ: 既存の textarea (paste モード)
- ディレクトリタブ: 単一 input (placeholder `docs`、デフォルト値 `docs`)
- 下部は共通の「取り込む」「キャンセル」ボタン + エラー表示

state:
```typescript
const [mode, setMode] = useState<'paste' | 'docs-dir'>('paste');
const [text, setText] = useState('');
const [dirPath, setDirPath] = useState('docs');
```

送信時:
```typescript
const input: IngestDocumentInput =
  mode === 'paste'
    ? { source: 'paste', text }
    : { source: 'docs-dir', dirPath };
const result = await startIngestDocument(input);
```

disabled 条件:
- paste モード: `text.trim().length === 0`
- docs-dir モード: `dirPath.trim().length === 0`
- 共通: `anyBusy`

エラー時は Phase 5d 同様に text / dirPath を保持、ダイアログ維持。

### 2.2 store.startIngestDocument シグネチャ変更

```typescript
// Before (Phase 5d)
startIngestDocument: (text: string) => Promise<{ ok: boolean; errorMessage?: string }>;

// After (Phase 5e)
startIngestDocument: (
  input: IngestDocumentInput,
) => Promise<{ ok: boolean; errorMessage?: string }>;
```

表示ラベル (runningAgent.inputNodeId) は:
- paste: `text.slice(0, 40)` + `…`
- docs-dir: `dirPath`

### 2.3 store test / dialog test 更新

既存テストの `startIngestDocument('...')` 呼び出しを `startIngestDocument({ source: 'paste', text: '...' })` に書き換え。docs-dir モードの新テストを追加。

---

## 3. テスト方針

### 3.1 ユニット (+目安 12 本)

| package | テスト |
|---|---|
| ai-engine | discriminatedUnion の paste 受理 / docs-dir 受理 / 不正値拒否 (+3) |
| ai-engine | validateInput docs-dir: workspaceRoot 外拒否 / 非ディレクトリ拒否 / OK 時 cwd 返却 (+3) |
| ai-engine | buildPrompt paste は既存プロンプト / docs-dir は Glob/Read 使用指示を含む (+2) |
| ai-engine | allowedTools に Read, Glob が含まれる (+1) |
| frontend | IngestDocumentDialog: タブ切替え + docs-dir 入力で startIngestDocument が呼ばれる (+2) |
| frontend | store.startIngestDocument が docs-dir input を WS に送る (+1) |

### 3.2 手動 E2E

`docs/phase-5e-manual-e2e.md` 新規:

1. 対象リポジトリ (`TALLY_WORKSPACE=~/dev/github.com/your-org`) を開く
2. 「要求書から取り込む」→ ディレクトリタブ → `docs` → 取り込む
3. 進捗パネルに Glob → 複数 Read → tool_use (create_node x N / create_edge x M) が流れる
4. ダイアログ自動クローズ、キャンバスに req 5-15 + UC 10-30 + satisfy エッジが生える
5. 個々の proposal を採用 → 正規ノード化
6. 気になる UC で「関連コードを探す」→ backend/frontend の実コードと紐付け
7. 全体として対象リポジトリの「何が実現されているか」の地図が出来る

### 3.3 ロードマップ / 進捗

`docs/04-roadmap.md` に Phase 5e 節 (ingest-document ディレクトリ対応) 追加 + 完了マーク。`docs/phase-5e-progress.md` を Phase 5d と同形式で作成。

---

## 4. follow-up (Phase 5f+)

- **ファイル拡張子フィルタ可変**: `.md` 以外 (`.adoc` / `.rst`) への対応
- **再 ingest 時の重複ガード**: 同じ docs 変更→再実行で proposal が倍になる問題
- **doc → node の trace エッジ**: 出典 (どの MD から生成されたか) を保持する metadata
- **summarize-codebase エージェント**: docs が無い or 古いプロジェクトのため、コードから直接 req/UC 逆生成
- **as-is / to-be 区別の schema 化**: 既存仕様と新機能要求を Node 上で区別
- **階層表示**: req/UC が多くなった時のキャンバス認知負荷対策 (collapse / group)
- **大規模 docs の分割 ingest**: 100+ ファイルを multi-turn で

---

## 5. 受入条件

1. `pnpm -r test` / `pnpm -r typecheck` 全緑
2. paste モードの挙動が Phase 5d から変わっていない (互換性)
3. 実リポジトリ `docs/` で手動 E2E が動作し、req / UC proposal が生成される
4. `..` や絶対パスで workspaceRoot 外を指定すると `bad_request` で拒否される
5. ADR-0007 準拠: Bash / Edit / Write は allowedTools に無く、SDK 経由で実行されない

---

## 6. オープン論点

なし。brainstorming で合意済み:
- 入力: ディレクトリパス 1 つ (デフォルト `docs`)
- エージェント: ingest-document 拡張 (discriminated input)
- 出力: paste と同じ req + usecase + satisfy
- UI: 既存ダイアログにタブ 2 枚
