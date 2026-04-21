# プロジェクトストレージ再設計 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** プロジェクトをリポジトリから独立した第一級の存在に昇格させ、0 件以上の `codebases[]` を参照できるモデルに刷新。保存先は XDG 準拠のグローバルディレクトリをデフォルトにし、レジストリによる明示発見 + バックエンド駆動フォルダピッカーで作成・インポートを行う。

**Architecture:** `.tally/` 規約を廃止し「プロジェクト = 任意のディレクトリ」に統一。レジストリ (`~/.local/share/tally/registry.yaml`) が既知プロジェクト一覧を保持。後方互換は一切維持しない破壊的変更で、ADR-0003 は Superseded とし新 ADR 3 本を追加。

**Tech Stack:** TypeScript (core / storage / frontend / ai-engine)、Zod（型とバリデーション）、Next.js 15 App Router（Route Handlers）、Vitest（全パッケージ）、Testing Library（frontend）、pnpm workspaces。

**Spec:** `docs/superpowers/specs/2026-04-21-project-storage-redesign-design.md`

---

## 実装前の重要な前提

- **コードノードの型名**: spec では便宜上「code ノード」と呼んでいるが、実コードでは `coderef` を使う（`packages/core/src/schema.ts` の `NODE_TYPES`）。プラン内では `coderef` を使う
- **プロジェクト ID 形式**: `newProjectId()` は `proj-<10文字nanoid>` を返す（`packages/core/src/id.ts`）。spec の表記 `proj_abc123` はイメージで、実際は `-` 区切り
- **YAML 永続化**: `packages/storage/src/yaml.ts` の `readYaml` / `writeYaml` (Zod validation 付き) を使う。アトミック書き込みが必要な箇所は本計画の Task 3 で追加する
- **破壊的変更**: 既存ファイル・型・テストを大量に削除／書き換える。型変更を起点にコンパイルエラーを潰す順序で進める

---

## ファイル構造

### 新規作成
- `packages/storage/src/registry.ts` — レジストリ CRUD
- `packages/storage/src/registry.test.ts`
- `packages/storage/src/project-dir.ts` — projectDir 直下の path 解決（旧 `paths.ts` 置換）
- `packages/storage/src/project-dir.test.ts`
- `packages/frontend/src/app/api/fs/ls/route.ts` — ディレクトリ一覧 API
- `packages/frontend/src/app/api/fs/ls/route.test.ts`
- `packages/frontend/src/app/api/fs/mkdir/route.ts` — 新規フォルダ API
- `packages/frontend/src/app/api/fs/mkdir/route.test.ts`
- `packages/frontend/src/components/dialog/folder-browser-dialog.tsx`
- `packages/frontend/src/components/dialog/folder-browser-dialog.test.tsx`
- `packages/frontend/src/components/dialog/project-import-dialog.tsx`
- `packages/frontend/src/components/dialog/project-import-dialog.test.tsx`
- `docs/adr/0008-project-independent-from-repo.md`
- `docs/adr/0009-project-registry.md`
- `docs/adr/0010-multiple-codebases.md`

### 削除
- `packages/storage/src/project-resolver.ts` + `.test.ts`
- `packages/storage/src/paths.ts` + `.test.ts`（`project-dir.ts` に役割移管）
- `packages/frontend/src/app/api/workspace-candidates/route.ts`
- `packages/frontend/src/lib/project-resolver.ts`（フロント側にも残がある。後述 Task で確認）

### 書き換え
- `packages/core/src/schema.ts`（`ProjectMetaSchema` / `ProjectMetaPatchSchema` / `CodeRefNodeSchema`）
- `packages/core/src/schema.test.ts`
- `packages/storage/src/index.ts` — export 整理
- `packages/storage/src/init-project.ts` + `.test.ts`
- `packages/storage/src/project-store.ts` + `.test.ts`
- `packages/storage/src/clear-project.ts` + `.test.ts`（`workspaceRoot` → `projectDir` rename に伴い）
- `packages/storage/src/chat-store.ts` + `.test.ts`（同上）
- `packages/frontend/src/lib/api.ts`
- `packages/frontend/src/lib/store.ts`
- `packages/frontend/src/app/api/projects/route.ts`
- `packages/frontend/src/app/api/projects/[id]/route.ts`
- `packages/frontend/src/components/dialog/new-project-dialog.tsx` + `.test.tsx`（全面刷新）
- `packages/frontend/src/components/dialog/project-settings-dialog.tsx` + `.test.tsx`（`codebases[]` 対応に全面刷新）
- `packages/frontend/src/app/page.tsx`（トップページ、registry 駆動）
- `packages/ai-engine/src/agents/codebase-anchor.ts` + `.test.ts`
- `packages/ai-engine/src/agents/find-related-code.ts` + `.test.ts`
- `packages/ai-engine/src/agents/analyze-impact.ts` + `.test.ts`
- `packages/ai-engine/src/agents/extract-questions.ts` + `.test.ts`
- `packages/ai-engine/src/agent-runner.ts` + `.test.ts`
- `packages/frontend/src/components/ai-actions/*`（codebase 参照系 UI を codebases[] 前提に）
- `examples/sample-project/`（ディレクトリ構造刷新）
- `docs/adr/0003-git-managed-yaml.md`（Superseded に更新）
- `CLAUDE.md` / `README.md`

---

## Phase 1: Core データモデル

### Task 1: CodebaseSchema 追加と ProjectMetaSchema 刷新

**Files:**
- Modify: `packages/core/src/schema.ts:142-175`
- Test: `packages/core/src/schema.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`packages/core/src/schema.test.ts` に追加:

```ts
import { describe, expect, it } from 'vitest';
import { CodebaseSchema, ProjectMetaSchema } from './schema';

describe('CodebaseSchema', () => {
  it('id / label / path を必須で受け入れる', () => {
    const input = { id: 'frontend', label: 'TaskFlow Web', path: '/abs/path' };
    expect(CodebaseSchema.parse(input)).toEqual(input);
  });

  it('id が空文字は拒否', () => {
    expect(() => CodebaseSchema.parse({ id: '', label: 'x', path: '/abs' })).toThrow();
  });

  it('id は kebab-case 英小文字 32 字以内', () => {
    expect(() => CodebaseSchema.parse({ id: 'Frontend', label: 'x', path: '/abs' })).toThrow();
    expect(() =>
      CodebaseSchema.parse({ id: 'a'.repeat(33), label: 'x', path: '/abs' }),
    ).toThrow();
    expect(CodebaseSchema.parse({ id: 'a', label: 'x', path: '/abs' }).id).toBe('a');
  });
});

describe('ProjectMetaSchema (刷新後)', () => {
  it('codebases: Codebase[] を必須で受け入れる (空配列可)', () => {
    const meta = {
      id: 'proj-abc',
      name: 'p',
      codebases: [],
      createdAt: '2026-04-21T00:00:00Z',
      updatedAt: '2026-04-21T00:00:00Z',
    };
    expect(ProjectMetaSchema.parse(meta).codebases).toEqual([]);
  });

  it('codebasePath / additionalCodebasePaths を受け入れない', () => {
    const meta = {
      id: 'proj-abc',
      name: 'p',
      codebases: [],
      codebasePath: '/x', // 旧フィールド、もう存在しない
      createdAt: '2026-04-21T00:00:00Z',
      updatedAt: '2026-04-21T00:00:00Z',
    };
    // passthrough してないので余計なキーは単に無視されるが、型に存在しないことを別途検証
    const parsed = ProjectMetaSchema.parse(meta);
    expect('codebasePath' in parsed).toBe(false);
  });

  it('codebases[].id の重複を拒否', () => {
    const meta = {
      id: 'proj-abc',
      name: 'p',
      codebases: [
        { id: 'dup', label: 'A', path: '/a' },
        { id: 'dup', label: 'B', path: '/b' },
      ],
      createdAt: '2026-04-21T00:00:00Z',
      updatedAt: '2026-04-21T00:00:00Z',
    };
    expect(() => ProjectMetaSchema.parse(meta)).toThrow(/codebases\[\]\.id/);
  });
});
```

- [ ] **Step 2: テストを走らせ失敗確認**

Run: `pnpm -F @tally/core test -- schema.test`
Expected: `CodebaseSchema` / 新仕様テスト が FAIL

- [ ] **Step 3: 最小実装**

`packages/core/src/schema.ts` の 142〜175 行目（プロジェクトスキーマ部分）を全面書き換え:

```ts
// ----------------------------------------------------------------------------
// プロジェクトスキーマ
// ----------------------------------------------------------------------------

export const CodebaseSchema = z.object({
  id: z
    .string()
    .regex(/^[a-z][a-z0-9-]{0,31}$/u, {
      message: 'codebase id は先頭英小文字 + 英小文字/数字/ハイフン、32 字以内',
    }),
  label: z.string().min(1),
  path: z.string().min(1),
});

export type Codebase = z.infer<typeof CodebaseSchema>;

// project.yaml に対応する meta のみのスキーマ。
// ノード・エッジはファイル分割で永続化するため、ここには含めない。
export const ProjectMetaSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    description: z.string().optional(),
    // 0 件以上。code ノードが存在するときは最低 1 件必要（整合性は storage 層で検証）。
    codebases: z.array(CodebaseSchema),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .superRefine((meta, ctx) => {
    const ids = meta.codebases.map((c) => c.id);
    const dup = ids.find((id, idx) => ids.indexOf(id) !== idx);
    if (dup !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `codebases[].id 重複: ${dup}`,
        path: ['codebases'],
      });
    }
  });

// 実行時に Project 全体を扱う際の合成スキーマ (メモリ上表現)。
export const ProjectSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    description: z.string().optional(),
    codebases: z.array(CodebaseSchema),
    createdAt: z.string(),
    updatedAt: z.string(),
    nodes: z.array(NodeSchema),
    edges: z.array(EdgeSchema),
  })
  .superRefine((p, ctx) => {
    const ids = p.codebases.map((c) => c.id);
    const dup = ids.find((id, idx) => ids.indexOf(id) !== idx);
    if (dup !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `codebases[].id 重複: ${dup}`,
        path: ['codebases'],
      });
    }
  });

// PATCH /api/projects/:id の body スキーマ。codebases 全置換のみ許可（部分更新はしない）。
export const ProjectMetaPatchSchema = z
  .object({
    name: z.string().min(1).optional(),
    description: z.string().nullable().optional(),
    codebases: z.array(CodebaseSchema).optional(),
  })
  .strict()
  .superRefine((patch, ctx) => {
    if (patch.codebases) {
      const ids = patch.codebases.map((c) => c.id);
      const dup = ids.find((id, idx) => ids.indexOf(id) !== idx);
      if (dup !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `codebases[].id 重複: ${dup}`,
          path: ['codebases'],
        });
      }
    }
  });
```

- [ ] **Step 4: テストを走らせ成功確認**

Run: `pnpm -F @tally/core test -- schema.test`
Expected: 追加した `CodebaseSchema` / `ProjectMetaSchema (刷新後)` の全テストが PASS

- [ ] **Step 5: コミット**

```bash
git add packages/core/src/schema.ts packages/core/src/schema.test.ts
git commit -m "feat(core): CodebaseSchema追加、ProjectMetaSchemaをcodebases[]に刷新

codebasePath / additionalCodebasePaths を削除し、codebases: Codebase[] に統一。
0件許容 + id 重複チェック。ProjectMetaPatchSchema も codebases 全置換方式に。"
```

---

### Task 2: CodeRefNode に codebaseId を必須化

**Files:**
- Modify: `packages/core/src/schema.ts:96-105`
- Test: `packages/core/src/schema.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`packages/core/src/schema.test.ts` に追加:

```ts
import { CodeRefNodeSchema } from './schema';

describe('CodeRefNodeSchema (codebaseId 必須化)', () => {
  const base = { id: 'c-1', x: 0, y: 0, title: 't', body: 'b', type: 'coderef' as const };

  it('codebaseId 必須', () => {
    expect(() => CodeRefNodeSchema.parse(base)).toThrow();
  });

  it('codebaseId があれば合格', () => {
    expect(CodeRefNodeSchema.parse({ ...base, codebaseId: 'frontend' }).codebaseId).toBe(
      'frontend',
    );
  });

  it('codebaseId が空文字は拒否', () => {
    expect(() => CodeRefNodeSchema.parse({ ...base, codebaseId: '' })).toThrow();
  });
});
```

- [ ] **Step 2: テスト失敗確認**

Run: `pnpm -F @tally/core test -- schema.test`
Expected: `CodeRefNodeSchema (codebaseId 必須化)` が FAIL

- [ ] **Step 3: 最小実装**

`packages/core/src/schema.ts` の `CodeRefNodeSchema` を置き換え:

```ts
export const CodeRefNodeSchema = z.object({
  ...baseNodeShape,
  type: z.literal('coderef'),
  codebaseId: z.string().min(1),
  filePath: z.string().optional(),
  startLine: z.number().int().nonnegative().optional(),
  endLine: z.number().int().nonnegative().optional(),
  summary: z.string().optional(),
  // analyze-impact 由来のみ記入 (find-related-code は書かない)。spec §1 の棲み分け契約。
  impact: z.string().optional(),
});
```

- [ ] **Step 4: テスト成功確認**

Run: `pnpm -F @tally/core test -- schema.test`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add packages/core/src/schema.ts packages/core/src/schema.test.ts
git commit -m "feat(core): CodeRefNode に codebaseId を必須フィールドとして追加"
```

---

## Phase 2: Storage レイヤー

### Task 3: yaml.ts に atomicWriteFile を追加

**Files:**
- Modify: `packages/storage/src/yaml.ts`
- Test: `packages/storage/src/yaml.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`packages/storage/src/yaml.test.ts` に追加:

```ts
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { atomicWriteFile } from './yaml';

describe('atomicWriteFile', () => {
  it('temp → rename で書き込み、既存を上書きする', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tally-atomic-'));
    const target = path.join(dir, 'a.txt');
    await fs.writeFile(target, 'old');
    await atomicWriteFile(target, 'new');
    expect(await fs.readFile(target, 'utf8')).toBe('new');
    // 同じディレクトリに .tmp が残っていない
    const entries = await fs.readdir(dir);
    expect(entries.filter((e) => e.endsWith('.tmp'))).toHaveLength(0);
  });

  it('親ディレクトリが無ければエラー', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tally-atomic-'));
    await expect(
      atomicWriteFile(path.join(dir, 'nope', 'a.txt'), 'x'),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: テスト失敗確認**

Run: `pnpm -F @tally/storage test -- yaml.test`
Expected: FAIL（`atomicWriteFile` 未定義）

- [ ] **Step 3: 最小実装**

`packages/storage/src/yaml.ts` の末尾に追加:

```ts
import { promises as fs } from 'node:fs';
import path from 'node:path';

// 書き込み途中のプロセスダウンでファイルが半壊するのを防ぐため、
// 同じディレクトリに .tmp-<pid>-<rand> を書いてから rename で置き換える。
export async function atomicWriteFile(filePath: string, data: string): Promise<void> {
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  const tmp = path.join(dir, `.${base}.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`);
  try {
    await fs.writeFile(tmp, data, 'utf8');
    await fs.rename(tmp, filePath);
  } catch (err) {
    // rename 失敗時は tmp を片付ける
    await fs.rm(tmp, { force: true });
    throw err;
  }
}
```

既存の `writeYaml` を atomicWriteFile 経由に修正:

```ts
export async function writeYaml<T>(filePath: string, value: T): Promise<void> {
  const dump = yaml.stringify(value);
  await atomicWriteFile(filePath, dump);
}
```

- [ ] **Step 4: テスト成功確認**

Run: `pnpm -F @tally/storage test -- yaml.test`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add packages/storage/src/yaml.ts packages/storage/src/yaml.test.ts
git commit -m "feat(storage): atomicWriteFile を追加し writeYaml を temp→rename 方式に"
```

---

### Task 4: registry.ts (home 解決・load/save)

**Files:**
- Create: `packages/storage/src/registry.ts`
- Test: `packages/storage/src/registry.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`packages/storage/src/registry.test.ts`:

```ts
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  loadRegistry,
  resolveRegistryPath,
  resolveTallyHome,
  saveRegistry,
} from './registry';

describe('resolveTallyHome', () => {
  const orig = { ...process.env };
  afterEach(() => {
    process.env = { ...orig };
  });

  it('TALLY_HOME が最優先', () => {
    process.env.TALLY_HOME = '/override';
    expect(resolveTallyHome()).toBe('/override');
  });

  it('TALLY_HOME 未設定 + XDG_DATA_HOME あり → <XDG_DATA_HOME>/tally', () => {
    delete process.env.TALLY_HOME;
    process.env.XDG_DATA_HOME = '/xdg';
    expect(resolveTallyHome()).toBe('/xdg/tally');
  });

  it('両方未設定 → ~/.local/share/tally', () => {
    delete process.env.TALLY_HOME;
    delete process.env.XDG_DATA_HOME;
    expect(resolveTallyHome()).toBe(path.join(os.homedir(), '.local', 'share', 'tally'));
  });
});

describe('registry load/save', () => {
  let dir: string;
  const orig = { ...process.env };

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tally-reg-'));
    process.env.TALLY_HOME = dir;
  });

  afterEach(async () => {
    process.env = { ...orig };
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('resolveRegistryPath は <TALLY_HOME>/registry.yaml', () => {
    expect(resolveRegistryPath()).toBe(path.join(dir, 'registry.yaml'));
  });

  it('ファイルが無ければ空 Registry を返す', async () => {
    const reg = await loadRegistry();
    expect(reg).toEqual({ version: 1, projects: [] });
  });

  it('save → load ラウンドトリップ', async () => {
    const reg = {
      version: 1 as const,
      projects: [
        { id: 'proj-a', path: '/x/y', lastOpenedAt: '2026-04-21T00:00:00Z' },
      ],
    };
    await saveRegistry(reg);
    expect(await loadRegistry()).toEqual(reg);
  });

  it('壊れた YAML は例外', async () => {
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'registry.yaml'), '::not yaml::', 'utf8');
    await expect(loadRegistry()).rejects.toThrow();
  });
});
```

- [ ] **Step 2: テスト失敗確認**

Run: `pnpm -F @tally/storage test -- registry.test`
Expected: FAIL（registry.ts 未作成）

- [ ] **Step 3: 最小実装**

`packages/storage/src/registry.ts`:

```ts
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { atomicWriteFile, readYaml } from './yaml';

// ---------------------------------------------------------------------------
// パス解決
// ---------------------------------------------------------------------------

// $TALLY_HOME > $XDG_DATA_HOME/tally > ~/.local/share/tally
export function resolveTallyHome(): string {
  if (process.env.TALLY_HOME) return process.env.TALLY_HOME;
  const xdg = process.env.XDG_DATA_HOME;
  if (xdg) return path.join(xdg, 'tally');
  return path.join(os.homedir(), '.local', 'share', 'tally');
}

export function resolveRegistryPath(): string {
  return path.join(resolveTallyHome(), 'registry.yaml');
}

export function resolveDefaultProjectsRoot(): string {
  return path.join(resolveTallyHome(), 'projects');
}

// ---------------------------------------------------------------------------
// スキーマ
// ---------------------------------------------------------------------------

export const RegistryEntrySchema = z.object({
  id: z.string().min(1),
  path: z.string().min(1),
  lastOpenedAt: z.string().min(1),
});

export const RegistrySchema = z.object({
  version: z.literal(1),
  projects: z.array(RegistryEntrySchema),
});

export type RegistryEntry = z.infer<typeof RegistryEntrySchema>;
export type Registry = z.infer<typeof RegistrySchema>;

const EMPTY_REGISTRY: Registry = { version: 1, projects: [] };

// ---------------------------------------------------------------------------
// load / save
// ---------------------------------------------------------------------------

export async function loadRegistry(): Promise<Registry> {
  const filePath = resolveRegistryPath();
  try {
    await fs.stat(filePath);
  } catch {
    return EMPTY_REGISTRY;
  }
  const loaded = await readYaml(filePath, RegistrySchema);
  return loaded ?? EMPTY_REGISTRY;
}

export async function saveRegistry(reg: Registry): Promise<void> {
  const filePath = resolveRegistryPath();
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  // atomicWriteFile を使うため、直接 YAML 文字列化
  const yaml = (await import('yaml')).default.stringify(RegistrySchema.parse(reg));
  await atomicWriteFile(filePath, yaml);
}
```

注: `readYaml` は `packages/storage/src/yaml.ts` で Zod validation 付き読み込みが既に実装されている。無ければこのタスクで追加する（既存を確認しつつ）。

- [ ] **Step 4: テスト成功確認**

Run: `pnpm -F @tally/storage test -- registry.test`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add packages/storage/src/registry.ts packages/storage/src/registry.test.ts
git commit -m "feat(storage): registry.ts 新設、TALLY_HOME/XDG準拠のパス解決と load/save"
```

---

### Task 5: registry CRUD (list/register/unregister/touch)

**Files:**
- Modify: `packages/storage/src/registry.ts`
- Test: `packages/storage/src/registry.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`packages/storage/src/registry.test.ts` に追加:

```ts
import { listProjects, registerProject, touchProject, unregisterProject } from './registry';

describe('registry CRUD', () => {
  let dir: string;
  const orig = { ...process.env };

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tally-reg-'));
    process.env.TALLY_HOME = dir;
  });
  afterEach(async () => {
    process.env = { ...orig };
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('registerProject が空 Registry にエントリを追加', async () => {
    await registerProject({ id: 'proj-a', path: '/a' });
    const list = await listProjects();
    expect(list).toHaveLength(1);
    expect(list[0]?.id).toBe('proj-a');
    expect(list[0]?.path).toBe('/a');
    expect(list[0]?.lastOpenedAt).toMatch(/\dT\d/);
  });

  it('registerProject が既存 id を上書き（後勝ち）', async () => {
    await registerProject({ id: 'proj-a', path: '/a' });
    await registerProject({ id: 'proj-a', path: '/b' });
    const list = await listProjects();
    expect(list).toHaveLength(1);
    expect(list[0]?.path).toBe('/b');
  });

  it('unregisterProject が id で削除', async () => {
    await registerProject({ id: 'proj-a', path: '/a' });
    await registerProject({ id: 'proj-b', path: '/b' });
    await unregisterProject('proj-a');
    const list = await listProjects();
    expect(list.map((p) => p.id)).toEqual(['proj-b']);
  });

  it('unregisterProject は存在しない id に対して no-op', async () => {
    await expect(unregisterProject('does-not-exist')).resolves.toBeUndefined();
  });

  it('touchProject が lastOpenedAt を更新', async () => {
    await registerProject({ id: 'proj-a', path: '/a' });
    const before = (await listProjects())[0]?.lastOpenedAt ?? '';
    await new Promise((r) => setTimeout(r, 10));
    await touchProject('proj-a');
    const after = (await listProjects())[0]?.lastOpenedAt ?? '';
    expect(after > before).toBe(true);
  });

  it('listProjects は lastOpenedAt 降順', async () => {
    await registerProject({ id: 'a', path: '/a' });
    await new Promise((r) => setTimeout(r, 10));
    await registerProject({ id: 'b', path: '/b' });
    const list = await listProjects();
    expect(list.map((p) => p.id)).toEqual(['b', 'a']);
  });
});
```

- [ ] **Step 2: テスト失敗確認**

Run: `pnpm -F @tally/storage test -- registry.test`
Expected: FAIL

- [ ] **Step 3: 最小実装**

`packages/storage/src/registry.ts` の末尾に追加:

```ts
// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export async function listProjects(): Promise<RegistryEntry[]> {
  const reg = await loadRegistry();
  return [...reg.projects].sort((a, b) => b.lastOpenedAt.localeCompare(a.lastOpenedAt));
}

export async function registerProject(entry: { id: string; path: string }): Promise<void> {
  const reg = await loadRegistry();
  const now = new Date().toISOString();
  const next: Registry = {
    version: 1,
    projects: [
      ...reg.projects.filter((p) => p.id !== entry.id),
      { id: entry.id, path: entry.path, lastOpenedAt: now },
    ],
  };
  await saveRegistry(next);
}

export async function unregisterProject(id: string): Promise<void> {
  const reg = await loadRegistry();
  const next: Registry = {
    version: 1,
    projects: reg.projects.filter((p) => p.id !== id),
  };
  await saveRegistry(next);
}

export async function touchProject(id: string): Promise<void> {
  const reg = await loadRegistry();
  const now = new Date().toISOString();
  const next: Registry = {
    version: 1,
    projects: reg.projects.map((p) => (p.id === id ? { ...p, lastOpenedAt: now } : p)),
  };
  await saveRegistry(next);
}
```

- [ ] **Step 4: テスト成功確認**

Run: `pnpm -F @tally/storage test -- registry.test`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add packages/storage/src/registry.ts packages/storage/src/registry.test.ts
git commit -m "feat(storage): registry CRUD (list/register/unregister/touch)"
```

---

### Task 6: project-dir.ts で projectDir 直下の path 解決

**Files:**
- Create: `packages/storage/src/project-dir.ts`
- Test: `packages/storage/src/project-dir.test.ts`
- Delete: `packages/storage/src/paths.ts`、`packages/storage/src/paths.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`packages/storage/src/project-dir.test.ts`:

```ts
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { chatFileName, nodeFileName, resolveProjectPaths } from './project-dir';

describe('resolveProjectPaths', () => {
  it('projectDir 直下を直接指す (.tally/ サブディレクトリを挟まない)', () => {
    const paths = resolveProjectPaths('/root/my-proj');
    expect(paths.root).toBe('/root/my-proj');
    expect(paths.projectFile).toBe(path.join('/root/my-proj', 'project.yaml'));
    expect(paths.nodesDir).toBe(path.join('/root/my-proj', 'nodes'));
    expect(paths.edgesDir).toBe(path.join('/root/my-proj', 'edges'));
    expect(paths.edgesFile).toBe(path.join('/root/my-proj', 'edges', 'edges.yaml'));
    expect(paths.chatsDir).toBe(path.join('/root/my-proj', 'chats'));
  });

  it('相対パスは絶対化', () => {
    const cwd = process.cwd();
    const paths = resolveProjectPaths('rel/sub');
    expect(paths.root).toBe(path.join(cwd, 'rel', 'sub'));
  });
});

describe('file name helpers', () => {
  it('nodeFileName', () => {
    expect(nodeFileName('req-abc')).toBe('req-abc.yaml');
  });
  it('chatFileName', () => {
    expect(chatFileName('chat-xyz')).toBe('chat-xyz.yaml');
  });
});
```

- [ ] **Step 2: テスト失敗確認**

Run: `pnpm -F @tally/storage test -- project-dir.test`
Expected: FAIL（未作成）

- [ ] **Step 3: 最小実装**

`packages/storage/src/project-dir.ts`:

```ts
import path from 'node:path';

// プロジェクトディレクトリ直下の各 path を集約。.tally/ サブディレクトリは挟まない。
export interface ProjectPaths {
  root: string;
  projectFile: string;
  nodesDir: string;
  edgesDir: string;
  edgesFile: string;
  chatsDir: string;
}

export function resolveProjectPaths(projectDir: string): ProjectPaths {
  const root = path.resolve(projectDir);
  return {
    root,
    projectFile: path.join(root, 'project.yaml'),
    nodesDir: path.join(root, 'nodes'),
    edgesDir: path.join(root, 'edges'),
    edgesFile: path.join(root, 'edges', 'edges.yaml'),
    chatsDir: path.join(root, 'chats'),
  };
}

export function nodeFileName(id: string): string {
  return `${id}.yaml`;
}

export function chatFileName(threadId: string): string {
  return `${threadId}.yaml`;
}
```

- [ ] **Step 4: テスト成功確認**

Run: `pnpm -F @tally/storage test -- project-dir.test`
Expected: PASS

- [ ] **Step 5: paths.ts を削除**

```bash
git rm packages/storage/src/paths.ts packages/storage/src/paths.test.ts
```

- [ ] **Step 6: コミット**

```bash
git add packages/storage/src/project-dir.ts packages/storage/src/project-dir.test.ts
git commit -m "feat(storage): project-dir.ts 新設、paths.ts 削除

プロジェクトディレクトリ = 任意のディレクトリ、.tally/ サブディレクトリ規約廃止。"
```

---

### Task 7: project-store.ts を projectDir + codebases 対応に刷新

**Files:**
- Modify: `packages/storage/src/project-store.ts`（大幅書き換え）
- Modify: `packages/storage/src/project-store.test.ts`

- [ ] **Step 1: テストを書き換え（既存テストは `.tally/` 前提のため全面書き直し）**

既存テストの import 先を `resolveTallyPaths` → `resolveProjectPaths` に変え、`new FileSystemProjectStore(workspaceRoot)` を `new FileSystemProjectStore(projectDir)` に変える。`codebases: []` を meta に含める。

`packages/storage/src/project-store.test.ts` の先頭部（setup）例:

```ts
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FileSystemProjectStore } from './project-store';
import { resolveProjectPaths } from './project-dir';

let projectDir: string;
beforeEach(async () => {
  projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tally-proj-'));
  // project.yaml + nodes/ + edges/edges.yaml の土台を作る
  const paths = resolveProjectPaths(projectDir);
  await fs.mkdir(paths.nodesDir, { recursive: true });
  await fs.mkdir(paths.edgesDir, { recursive: true });
  await fs.writeFile(paths.edgesFile, 'edges: []\n');
});
afterEach(async () => {
  await fs.rm(projectDir, { recursive: true, force: true });
});
```

既存テストの ProjectMeta 生成部を全て以下パターンに統一:

```ts
const meta = {
  id: 'proj-test',
  name: 'test',
  codebases: [],
  createdAt: '2026-04-21T00:00:00Z',
  updatedAt: '2026-04-21T00:00:00Z',
};
```

追加テスト（codebases 系）:

```ts
describe('codebases roundtrip', () => {
  it('0 件の codebases を save/load', async () => {
    const store = new FileSystemProjectStore(projectDir);
    await store.saveProjectMeta({
      id: 'proj-a',
      name: 'a',
      codebases: [],
      createdAt: '2026-04-21T00:00:00Z',
      updatedAt: '2026-04-21T00:00:00Z',
    });
    const loaded = await store.getProjectMeta();
    expect(loaded?.codebases).toEqual([]);
  });

  it('複数 codebases を save/load', async () => {
    const store = new FileSystemProjectStore(projectDir);
    const codebases = [
      { id: 'frontend', label: 'Web', path: '/a' },
      { id: 'backend', label: 'API', path: '/b' },
    ];
    await store.saveProjectMeta({
      id: 'proj-a',
      name: 'a',
      codebases,
      createdAt: '2026-04-21T00:00:00Z',
      updatedAt: '2026-04-21T00:00:00Z',
    });
    expect((await store.getProjectMeta())?.codebases).toEqual(codebases);
  });
});

describe('coderef codebaseId 整合性', () => {
  it('存在しない codebaseId の coderef 追加は拒否', async () => {
    const store = new FileSystemProjectStore(projectDir);
    await store.saveProjectMeta({
      id: 'proj-a',
      name: 'a',
      codebases: [{ id: 'frontend', label: 'W', path: '/a' }],
      createdAt: '2026-04-21T00:00:00Z',
      updatedAt: '2026-04-21T00:00:00Z',
    });
    await expect(
      store.addNode({
        type: 'coderef',
        x: 0,
        y: 0,
        title: 't',
        body: 'b',
        codebaseId: 'unknown',
      }),
    ).rejects.toThrow(/codebaseId/);
  });

  it('存在する codebaseId なら合格', async () => {
    const store = new FileSystemProjectStore(projectDir);
    await store.saveProjectMeta({
      id: 'proj-a',
      name: 'a',
      codebases: [{ id: 'frontend', label: 'W', path: '/a' }],
      createdAt: '2026-04-21T00:00:00Z',
      updatedAt: '2026-04-21T00:00:00Z',
    });
    const node = await store.addNode({
      type: 'coderef',
      x: 0,
      y: 0,
      title: 't',
      body: 'b',
      codebaseId: 'frontend',
    });
    expect(node.codebaseId).toBe('frontend');
  });
});
```

- [ ] **Step 2: テスト失敗確認**

Run: `pnpm -F @tally/storage test -- project-store.test`
Expected: FAIL（旧 `resolveTallyPaths` が未定義 / 新仕様未対応）

- [ ] **Step 3: 最小実装**

`packages/storage/src/project-store.ts` の先頭 import と `FileSystemProjectStore` コンストラクタを変更:

```ts
import {
  // ... 既存
} from '@tally/core';
import { nodeFileName, resolveProjectPaths } from './project-dir';
import { readYaml, writeYaml } from './yaml';
// ...

export class FileSystemProjectStore implements ProjectStore {
  private readonly paths: ReturnType<typeof resolveProjectPaths>;

  constructor(projectDir: string) {
    this.paths = resolveProjectPaths(projectDir);
  }
  // ... 以下既存のまま、workspaceRoot 参照を paths.root に統一
```

`addNode` の coderef 分岐に codebaseId 整合性検証を追加:

```ts
async addNode<D extends NodeDraft>(draft: D): Promise<Extract<Node, { type: D['type'] }>> {
  if (draft.type === 'coderef') {
    const meta = await this.getProjectMeta();
    const cbIds = new Set(meta?.codebases.map((c) => c.id) ?? []);
    if (!cbIds.has((draft as unknown as { codebaseId: string }).codebaseId)) {
      throw new Error(
        `coderef.codebaseId が projectMeta.codebases に存在しない: ${(draft as unknown as { codebaseId: string }).codebaseId}`,
      );
    }
  }
  // ... 既存ロジック
}
```

`updateNode` / `transmuteNode` にも同様の検証を加える（coderef に変換するケース・codebaseId 変更ケース）。

- [ ] **Step 4: テスト成功確認**

Run: `pnpm -F @tally/storage test -- project-store.test`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add packages/storage/src/project-store.ts packages/storage/src/project-store.test.ts
git commit -m "refactor(storage): FileSystemProjectStore を projectDir + codebases[] に刷新

- コンストラクタ引数 workspaceRoot を projectDir にリネーム
- resolveTallyPaths → resolveProjectPaths 経由に
- coderef 追加/更新時に codebaseId の整合性を検証"
```

---

### Task 8: chat-store.ts と clear-project.ts を projectDir に追従

**Files:**
- Modify: `packages/storage/src/chat-store.ts` + `.test.ts`
- Modify: `packages/storage/src/clear-project.ts` + `.test.ts`

- [ ] **Step 1: 既存テストを workspaceRoot → projectDir に一括 rename**

各 `.test.ts` で以下置換:
- 変数 `workspaceRoot` → `projectDir`
- `resolveTallyPaths(workspaceRoot)` → `resolveProjectPaths(projectDir)`
- setup の `.tally/` サブディレクトリ作成を廃止し、`projectDir` 直下に `nodes/`, `edges/`, `chats/` を作る

- [ ] **Step 2: テスト失敗確認**

Run: `pnpm -F @tally/storage test -- chat-store.test clear-project.test`
Expected: FAIL

- [ ] **Step 3: 最小実装**

`chat-store.ts`:

```ts
import { chatFileName, resolveProjectPaths } from './project-dir';
// ...
export class FileSystemChatStore implements ChatStore {
  private readonly paths: ReturnType<typeof resolveProjectPaths>;

  constructor(projectDir: string) {
    this.paths = resolveProjectPaths(projectDir);
  }
  // 以下既存ロジック、this.paths.chatsDir 参照
}
```

`clear-project.ts` も同様に `workspaceRoot` → `projectDir` にリネーム、`resolveProjectPaths` 経由に。

- [ ] **Step 4: テスト成功確認**

Run: `pnpm -F @tally/storage test -- chat-store.test clear-project.test`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add packages/storage/src/chat-store.ts packages/storage/src/chat-store.test.ts \
        packages/storage/src/clear-project.ts packages/storage/src/clear-project.test.ts
git commit -m "refactor(storage): chat-store / clear-project を projectDir に追従"
```

---

### Task 9: init-project.ts を registry 登録 + codebases[] 対応に刷新

**Files:**
- Modify: `packages/storage/src/init-project.ts`
- Modify: `packages/storage/src/init-project.test.ts`

- [ ] **Step 1: テストを書き換える**

`packages/storage/src/init-project.test.ts` を全面書き直し:

```ts
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initProject } from './init-project';
import { listProjects } from './registry';

let tallyHome: string;
let workspace: string;
const orig = { ...process.env };

beforeEach(async () => {
  tallyHome = await fs.mkdtemp(path.join(os.tmpdir(), 'tally-home-'));
  workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'tally-ws-'));
  process.env.TALLY_HOME = tallyHome;
});
afterEach(async () => {
  process.env = { ...orig };
  await fs.rm(tallyHome, { recursive: true, force: true });
  await fs.rm(workspace, { recursive: true, force: true });
});

describe('initProject', () => {
  it('空 projectDir に project.yaml / nodes / edges を作り registry に登録', async () => {
    const projectDir = path.join(workspace, 'new-proj');
    const result = await initProject({
      projectDir,
      name: 'new proj',
      codebases: [],
    });
    expect(result.id).toMatch(/^proj-/);
    expect(result.projectDir).toBe(projectDir);
    expect((await fs.stat(path.join(projectDir, 'project.yaml'))).isFile()).toBe(true);
    expect((await fs.stat(path.join(projectDir, 'nodes'))).isDirectory()).toBe(true);
    expect((await fs.stat(path.join(projectDir, 'edges', 'edges.yaml'))).isFile()).toBe(true);
    const reg = await listProjects();
    expect(reg.map((p) => p.id)).toContain(result.id);
  });

  it('codebases を受け取って保存', async () => {
    const projectDir = path.join(workspace, 'with-cb');
    const codebases = [{ id: 'web', label: 'Web', path: '/w' }];
    await initProject({ projectDir, name: 'x', codebases });
    const raw = await fs.readFile(path.join(projectDir, 'project.yaml'), 'utf8');
    expect(raw).toContain('web');
    expect(raw).toContain('/w');
  });

  it('codebases 0 件でも成功する', async () => {
    const projectDir = path.join(workspace, 'no-cb');
    await expect(initProject({ projectDir, name: 'x', codebases: [] })).resolves.toBeDefined();
  });

  it('既存の project.yaml を含む dir は拒否', async () => {
    const projectDir = path.join(workspace, 'existing');
    await fs.mkdir(projectDir);
    await fs.writeFile(path.join(projectDir, 'project.yaml'), 'id: old\n');
    await expect(
      initProject({ projectDir, name: 'x', codebases: [] }),
    ).rejects.toThrow(/既存の project\.yaml/);
  });

  it('非空の dir で project.yaml 無しは拒否', async () => {
    const projectDir = path.join(workspace, 'dirty');
    await fs.mkdir(projectDir);
    await fs.writeFile(path.join(projectDir, 'random.txt'), 'x');
    await expect(
      initProject({ projectDir, name: 'x', codebases: [] }),
    ).rejects.toThrow(/空ではありません/);
  });

  it('存在しないパスでも親ディレクトリが存在すれば成功', async () => {
    const projectDir = path.join(workspace, 'fresh');
    await initProject({ projectDir, name: 'x', codebases: [] });
    expect((await fs.stat(projectDir)).isDirectory()).toBe(true);
  });

  it('親ディレクトリが存在しないパスは拒否', async () => {
    const projectDir = path.join(workspace, 'missing-parent', 'sub');
    await expect(
      initProject({ projectDir, name: 'x', codebases: [] }),
    ).rejects.toThrow(/親ディレクトリ/);
  });

  it('name が空は拒否', async () => {
    await expect(
      initProject({ projectDir: path.join(workspace, 'p'), name: '  ', codebases: [] }),
    ).rejects.toThrow(/name/);
  });
});
```

- [ ] **Step 2: テスト失敗確認**

Run: `pnpm -F @tally/storage test -- init-project.test`
Expected: FAIL

- [ ] **Step 3: 最小実装**

`packages/storage/src/init-project.ts` を全面書き直し:

```ts
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { newProjectId } from '@tally/core';
import type { Codebase } from '@tally/core';

import { FileSystemProjectStore } from './project-store';
import { registerProject } from './registry';
import { resolveProjectPaths } from './project-dir';

export interface InitProjectInput {
  projectDir: string; // 絶対または相対。相対は cwd 基準で解決
  name: string;
  description?: string;
  codebases: Codebase[];
}

export interface InitProjectResult {
  id: string;
  projectDir: string;
}

export async function initProject(input: InitProjectInput): Promise<InitProjectResult> {
  const absDir = path.resolve(input.projectDir);

  const name = input.name.trim();
  if (name.length === 0) throw new Error('name が空');

  // 親ディレクトリが存在するか
  const parent = path.dirname(absDir);
  try {
    const st = await fs.stat(parent);
    if (!st.isDirectory()) throw new Error(`親ディレクトリがディレクトリではない: ${parent}`);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') throw new Error(`親ディレクトリが存在しない: ${parent}`);
    throw err;
  }

  // projectDir 自身の状態を判定
  let exists = false;
  try {
    const st = await fs.stat(absDir);
    if (!st.isDirectory()) throw new Error(`projectDir がディレクトリではない: ${absDir}`);
    exists = true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }

  if (exists) {
    const entries = await fs.readdir(absDir);
    if (entries.includes('project.yaml')) {
      throw new Error(`既存の project.yaml が存在: ${absDir}`);
    }
    if (entries.length > 0) {
      throw new Error(`ディレクトリが空ではありません: ${absDir}`);
    }
  } else {
    await fs.mkdir(absDir);
  }

  const paths = resolveProjectPaths(absDir);
  await fs.mkdir(paths.nodesDir, { recursive: true });
  await fs.mkdir(paths.edgesDir, { recursive: true });
  await fs.writeFile(paths.edgesFile, 'edges: []\n', 'utf8');

  const id = newProjectId();
  const now = new Date().toISOString();
  const store = new FileSystemProjectStore(absDir);
  await store.saveProjectMeta({
    id,
    name,
    ...(input.description ? { description: input.description } : {}),
    codebases: input.codebases,
    createdAt: now,
    updatedAt: now,
  });

  await registerProject({ id, path: absDir });

  return { id, projectDir: absDir };
}
```

- [ ] **Step 4: テスト成功確認**

Run: `pnpm -F @tally/storage test -- init-project.test`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add packages/storage/src/init-project.ts packages/storage/src/init-project.test.ts
git commit -m "refactor(storage): initProject を projectDir + codebases[] + registry 登録に刷新"
```

---

### Task 10: project-resolver.ts 削除と index.ts 整理

**Files:**
- Delete: `packages/storage/src/project-resolver.ts` + `.test.ts`
- Modify: `packages/storage/src/index.ts`

- [ ] **Step 1: 新 index.ts を書く**

`packages/storage/src/index.ts`:

```ts
export const PACKAGE_NAME = '@tally/storage';

export { FileSystemProjectStore } from './project-store';
export type { NodeDraft, NodePatch, ProjectStore } from './project-store';
export { FileSystemChatStore } from './chat-store';
export type { ChatStore, CreateChatInput } from './chat-store';
export {
  chatFileName,
  nodeFileName,
  resolveProjectPaths,
} from './project-dir';
export type { ProjectPaths } from './project-dir';
export { YamlValidationError, atomicWriteFile, readYaml, writeYaml } from './yaml';
export {
  listProjects,
  loadRegistry,
  registerProject,
  resolveDefaultProjectsRoot,
  resolveRegistryPath,
  resolveTallyHome,
  saveRegistry,
  touchProject,
  unregisterProject,
} from './registry';
export type { Registry, RegistryEntry } from './registry';
export { initProject } from './init-project';
export type { InitProjectInput, InitProjectResult } from './init-project';
export { clearProject } from './clear-project';
export type { ClearProjectResult } from './clear-project';
```

- [ ] **Step 2: project-resolver.ts を削除**

```bash
git rm packages/storage/src/project-resolver.ts packages/storage/src/project-resolver.test.ts
```

- [ ] **Step 3: テスト全体確認**

Run: `pnpm -F @tally/storage test`
Expected: PASS（storage 内部は他に依存がない）

- [ ] **Step 4: コミット**

```bash
git add packages/storage/src/index.ts
git commit -m "refactor(storage): project-resolver.ts 削除、index.ts の export を registry/project-dir 中心に整理"
```

---

## Phase 3: バックエンド API

### Task 11: GET /api/fs/ls

**Files:**
- Create: `packages/frontend/src/app/api/fs/ls/route.ts`
- Create: `packages/frontend/src/app/api/fs/ls/route.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`packages/frontend/src/app/api/fs/ls/route.test.ts`:

```ts
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GET } from './route';

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tally-fs-'));
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

function req(pathParam?: string): Request {
  const url = new URL('http://localhost/api/fs/ls');
  if (pathParam !== undefined) url.searchParams.set('path', pathParam);
  return new Request(url);
}

describe('GET /api/fs/ls', () => {
  it('ディレクトリのみを返し、ファイルは含めない', async () => {
    await fs.mkdir(path.join(dir, 'subA'));
    await fs.mkdir(path.join(dir, '.hidden'));
    await fs.writeFile(path.join(dir, 'file.txt'), 'x');
    const res = await GET(req(dir));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      entries: { name: string; isHidden: boolean; hasProjectYaml: boolean }[];
    };
    const names = body.entries.map((e) => e.name).sort();
    expect(names).toEqual(['.hidden', 'subA']);
    const hidden = body.entries.find((e) => e.name === '.hidden');
    expect(hidden?.isHidden).toBe(true);
  });

  it('子に project.yaml があれば hasProjectYaml: true', async () => {
    const sub = path.join(dir, 'proj');
    await fs.mkdir(sub);
    await fs.writeFile(path.join(sub, 'project.yaml'), 'id: x');
    const res = await GET(req(dir));
    const body = (await res.json()) as {
      entries: { name: string; hasProjectYaml: boolean }[];
    };
    expect(body.entries.find((e) => e.name === 'proj')?.hasProjectYaml).toBe(true);
  });

  it('dir 自身が project.yaml を含むなら containsProjectYaml: true', async () => {
    await fs.writeFile(path.join(dir, 'project.yaml'), 'id: x');
    const res = await GET(req(dir));
    const body = (await res.json()) as { containsProjectYaml: boolean };
    expect(body.containsProjectYaml).toBe(true);
  });

  it('parent は 1 階層上', async () => {
    const sub = path.join(dir, 'a', 'b');
    await fs.mkdir(sub, { recursive: true });
    const res = await GET(req(sub));
    const body = (await res.json()) as { parent: string };
    expect(body.parent).toBe(path.join(dir, 'a'));
  });

  it('parent がシステムルートなら null', async () => {
    const res = await GET(req('/'));
    const body = (await res.json()) as { parent: string | null };
    expect(body.parent).toBeNull();
  });

  it('path が相対パスは 400', async () => {
    const res = await GET(req('relative/path'));
    expect(res.status).toBe(400);
  });

  it('path が未指定なら HOME にフォールバック', async () => {
    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { path: string };
    expect(body.path).toBe(os.homedir());
  });

  it('path 不在は 404', async () => {
    const res = await GET(req(path.join(dir, 'does-not-exist')));
    expect(res.status).toBe(404);
  });

  it('.. を含む path は path.resolve で正規化して処理', async () => {
    const sub = path.join(dir, 'a');
    await fs.mkdir(sub);
    const weird = `${sub}/../a`;
    const res = await GET(req(weird));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { path: string };
    expect(body.path).toBe(path.resolve(weird));
  });
});
```

- [ ] **Step 2: テスト失敗確認**

Run: `pnpm -F @tally/frontend test -- fs/ls/route.test`
Expected: FAIL（未作成）

- [ ] **Step 3: 最小実装**

`packages/frontend/src/app/api/fs/ls/route.ts`:

```ts
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(req: Request): Promise<NextResponse> {
  const url = new URL(req.url);
  const raw = url.searchParams.get('path');
  const target = raw ?? os.homedir();
  if (!path.isAbsolute(target)) {
    return NextResponse.json({ error: 'path は絶対パスのみ' }, { status: 400 });
  }
  const normalized = path.resolve(target);

  let stat: Awaited<ReturnType<typeof fs.stat>>;
  try {
    stat = await fs.stat(normalized);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return NextResponse.json({ error: 'ディレクトリが存在しない' }, { status: 404 });
    }
    if (code === 'EACCES') {
      return NextResponse.json({ error: '権限がない' }, { status: 403 });
    }
    throw err;
  }
  if (!stat.isDirectory()) {
    return NextResponse.json({ error: 'ディレクトリではない' }, { status: 400 });
  }

  const parent = path.dirname(normalized);
  const parentResolved = parent === normalized ? null : parent;

  let rawEntries: import('node:fs').Dirent[];
  try {
    rawEntries = await fs.readdir(normalized, { withFileTypes: true });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'EACCES') {
      return NextResponse.json(
        {
          path: normalized,
          parent: parentResolved,
          entries: [],
          containsProjectYaml: false,
        },
        { status: 200 },
      );
    }
    throw err;
  }

  const entries = await Promise.all(
    rawEntries
      .filter((e) => e.isDirectory())
      .map(async (e) => {
        const childPath = path.join(normalized, e.name);
        let hasProjectYaml = false;
        try {
          await fs.stat(path.join(childPath, 'project.yaml'));
          hasProjectYaml = true;
        } catch {
          /* なし */
        }
        return {
          name: e.name,
          path: childPath,
          isHidden: e.name.startsWith('.'),
          hasProjectYaml,
        };
      }),
  );

  let containsProjectYaml = false;
  try {
    await fs.stat(path.join(normalized, 'project.yaml'));
    containsProjectYaml = true;
  } catch {
    /* なし */
  }

  return NextResponse.json(
    {
      path: normalized,
      parent: parentResolved,
      entries: entries.sort((a, b) => a.name.localeCompare(b.name, 'ja')),
      containsProjectYaml,
    },
    { status: 200 },
  );
}
```

- [ ] **Step 4: テスト成功確認**

Run: `pnpm -F @tally/frontend test -- fs/ls/route.test`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add packages/frontend/src/app/api/fs/ls/
git commit -m "feat(frontend): GET /api/fs/ls 追加（ディレクトリ一覧 + project.yaml 検出）"
```

---

### Task 12: POST /api/fs/mkdir

**Files:**
- Create: `packages/frontend/src/app/api/fs/mkdir/route.ts`
- Create: `packages/frontend/src/app/api/fs/mkdir/route.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`packages/frontend/src/app/api/fs/mkdir/route.test.ts`:

```ts
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { POST } from './route';

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tally-mkdir-'));
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

function req(body: unknown): Request {
  return new Request('http://localhost/api/fs/mkdir', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

describe('POST /api/fs/mkdir', () => {
  it('新規ディレクトリを作成して 201 を返す', async () => {
    const res = await POST(req({ path: dir, name: 'new-sub' }));
    expect(res.status).toBe(201);
    expect(
      (await fs.stat(path.join(dir, 'new-sub'))).isDirectory(),
    ).toBe(true);
  });

  it('既存は 409', async () => {
    await fs.mkdir(path.join(dir, 'exists'));
    const res = await POST(req({ path: dir, name: 'exists' }));
    expect(res.status).toBe(409);
  });

  it('name に / を含むと 400', async () => {
    const res = await POST(req({ path: dir, name: 'a/b' }));
    expect(res.status).toBe(400);
  });

  it('name が .. は 400', async () => {
    const res = await POST(req({ path: dir, name: '..' }));
    expect(res.status).toBe(400);
  });

  it('name が空は 400', async () => {
    const res = await POST(req({ path: dir, name: '' }));
    expect(res.status).toBe(400);
  });

  it('path が相対パスは 400', async () => {
    const res = await POST(req({ path: 'rel', name: 'a' }));
    expect(res.status).toBe(400);
  });

  it('親 path が不在は 404', async () => {
    const res = await POST(req({ path: path.join(dir, 'nope'), name: 'x' }));
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: テスト失敗確認**

Run: `pnpm -F @tally/frontend test -- fs/mkdir/route.test`
Expected: FAIL

- [ ] **Step 3: 最小実装**

`packages/frontend/src/app/api/fs/mkdir/route.ts`:

```ts
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST(req: Request): Promise<NextResponse> {
  const raw = (await req.json().catch(() => null)) as {
    path?: unknown;
    name?: unknown;
  } | null;
  if (!raw || typeof raw.path !== 'string' || typeof raw.name !== 'string') {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }
  const parent = raw.path;
  const name = raw.name;

  if (!path.isAbsolute(parent)) {
    return NextResponse.json({ error: 'path は絶対パスのみ' }, { status: 400 });
  }
  if (name.length === 0 || name === '.' || name === '..' || name.includes('/') || name.includes('\\')) {
    return NextResponse.json({ error: 'name が不正' }, { status: 400 });
  }

  const parentNorm = path.resolve(parent);
  const target = path.resolve(parentNorm, name);
  // 二重防御: 正規化後ターゲットが parent 配下であること
  if (!target.startsWith(`${parentNorm}${path.sep}`) && target !== parentNorm) {
    return NextResponse.json({ error: 'path traversal 検出' }, { status: 400 });
  }

  try {
    const st = await fs.stat(parentNorm);
    if (!st.isDirectory()) {
      return NextResponse.json({ error: 'path がディレクトリではない' }, { status: 400 });
    }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return NextResponse.json({ error: '親ディレクトリが存在しない' }, { status: 404 });
    }
    throw err;
  }

  try {
    await fs.mkdir(target);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'EEXIST') {
      return NextResponse.json({ error: '既に存在' }, { status: 409 });
    }
    throw err;
  }

  return NextResponse.json({ path: target }, { status: 201 });
}
```

- [ ] **Step 4: テスト成功確認**

Run: `pnpm -F @tally/frontend test -- fs/mkdir/route.test`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add packages/frontend/src/app/api/fs/mkdir/
git commit -m "feat(frontend): POST /api/fs/mkdir 追加（path traversal 二重防御）"
```

---

### Task 13: GET /api/projects を registry 駆動に書き換え、workspace-candidates 削除

**Files:**
- Modify: `packages/frontend/src/app/api/projects/route.ts`
- Delete: `packages/frontend/src/app/api/workspace-candidates/route.ts`
- Modify: 既存 `route.test.ts` があれば更新、無ければ新規

- [ ] **Step 1: 失敗するテストを書く**

`packages/frontend/src/app/api/projects/route.test.ts`（無ければ新規作成）:

```ts
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GET, POST } from './route';
import { resolveTallyHome } from '@tally/storage';

let home: string;
let workspace: string;
const orig = { ...process.env };

beforeEach(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), 'tally-home-'));
  workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'tally-ws-'));
  process.env.TALLY_HOME = home;
});
afterEach(async () => {
  process.env = { ...orig };
  await fs.rm(home, { recursive: true, force: true });
  await fs.rm(workspace, { recursive: true, force: true });
});

describe('GET /api/projects', () => {
  it('registry が空なら空配列', async () => {
    const res = await GET();
    const body = (await res.json()) as { projects: unknown[] };
    expect(body.projects).toEqual([]);
  });

  it('POST で作ると GET に現れ、lastOpenedAt 降順で並ぶ', async () => {
    await POST(
      new Request('http://localhost', {
        method: 'POST',
        body: JSON.stringify({
          projectDir: path.join(workspace, 'a'),
          name: 'A',
          codebases: [],
        }),
      }),
    );
    await POST(
      new Request('http://localhost', {
        method: 'POST',
        body: JSON.stringify({
          projectDir: path.join(workspace, 'b'),
          name: 'B',
          codebases: [],
        }),
      }),
    );
    const res = await GET();
    const body = (await res.json()) as {
      projects: { id: string; name: string; projectDir: string }[];
    };
    expect(body.projects.map((p) => p.name)).toEqual(['B', 'A']);
  });
});

describe('POST /api/projects', () => {
  it('codebases を受け付けて registry に登録', async () => {
    const res = await POST(
      new Request('http://localhost', {
        method: 'POST',
        body: JSON.stringify({
          projectDir: path.join(workspace, 'x'),
          name: 'X',
          codebases: [{ id: 'web', label: 'Web', path: '/w' }],
        }),
      }),
    );
    expect(res.status).toBe(201);
  });

  it('codebases 欠落は 400', async () => {
    const res = await POST(
      new Request('http://localhost', {
        method: 'POST',
        body: JSON.stringify({ projectDir: path.join(workspace, 'y'), name: 'Y' }),
      }),
    );
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: テスト失敗確認**

Run: `pnpm -F @tally/frontend test -- api/projects/route.test`
Expected: FAIL（旧実装は `codebases` を知らない）

- [ ] **Step 3: 最小実装**

`packages/frontend/src/app/api/projects/route.ts`:

```ts
import {
  FileSystemProjectStore,
  initProject,
  listProjects,
} from '@tally/storage';
import { CodebaseSchema } from '@tally/core';
import { NextResponse } from 'next/server';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  const entries = await listProjects();
  const projects = await Promise.all(
    entries.map(async (e) => {
      try {
        const store = new FileSystemProjectStore(e.path);
        const meta = await store.getProjectMeta();
        if (!meta) return null;
        return {
          id: meta.id,
          name: meta.name,
          description: meta.description ?? null,
          codebases: meta.codebases,
          projectDir: e.path,
          createdAt: meta.createdAt,
          updatedAt: meta.updatedAt,
          lastOpenedAt: e.lastOpenedAt,
        };
      } catch {
        // path 先が壊れている等は一覧から除外（UI で別途再選択を促す）
        return null;
      }
    }),
  );
  return NextResponse.json({
    projects: projects.filter((p): p is NonNullable<typeof p> => p !== null),
  });
}

const CreateBodySchema = z.object({
  projectDir: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  codebases: z.array(CodebaseSchema),
});

export async function POST(req: Request): Promise<NextResponse> {
  const raw = await req.json().catch(() => null);
  const parsed = CreateBodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }
  try {
    const result = await initProject(parsed.data);
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: String((err as Error).message ?? err) }, { status: 400 });
  }
}
```

- [ ] **Step 4: workspace-candidates を削除**

```bash
git rm -r packages/frontend/src/app/api/workspace-candidates/
```

- [ ] **Step 5: テスト成功確認**

Run: `pnpm -F @tally/frontend test -- api/projects/route.test`
Expected: PASS

- [ ] **Step 6: コミット**

```bash
git add packages/frontend/src/app/api/projects/
git commit -m "refactor(frontend): GET/POST /api/projects を registry + codebases[] 駆動に刷新

workspace-candidates route を削除。"
```

---

### Task 14: registry import / unregister / touch API

**Files:**
- Create: `packages/frontend/src/app/api/projects/import/route.ts` + `.test.ts`
- Create: `packages/frontend/src/app/api/projects/[id]/unregister/route.ts` + `.test.ts`
- Modify: `packages/frontend/src/app/api/projects/[id]/route.ts`（touch を GET で呼ぶ）

- [ ] **Step 1: 失敗するテストを書く（import）**

`packages/frontend/src/app/api/projects/import/route.test.ts`:

```ts
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { POST } from './route';

let home: string;
let ws: string;
const orig = { ...process.env };

beforeEach(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), 'tally-home-'));
  ws = await fs.mkdtemp(path.join(os.tmpdir(), 'tally-ws-'));
  process.env.TALLY_HOME = home;
});
afterEach(async () => {
  process.env = { ...orig };
  await fs.rm(home, { recursive: true, force: true });
  await fs.rm(ws, { recursive: true, force: true });
});

describe('POST /api/projects/import', () => {
  it('project.yaml を含む dir を登録', async () => {
    const dir = path.join(ws, 'imp');
    await fs.mkdir(dir);
    await fs.writeFile(
      path.join(dir, 'project.yaml'),
      'id: proj-imported\nname: imp\ncodebases: []\ncreatedAt: "2026-04-21T00:00:00Z"\nupdatedAt: "2026-04-21T00:00:00Z"\n',
    );
    const res = await POST(
      new Request('http://localhost', {
        method: 'POST',
        body: JSON.stringify({ projectDir: dir }),
      }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string };
    expect(body.id).toBe('proj-imported');
  });

  it('project.yaml が無ければ 400', async () => {
    const dir = path.join(ws, 'empty');
    await fs.mkdir(dir);
    const res = await POST(
      new Request('http://localhost', {
        method: 'POST',
        body: JSON.stringify({ projectDir: dir }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it('同じ id のプロジェクトが既に登録されていれば 409', async () => {
    const dir1 = path.join(ws, 'a');
    const dir2 = path.join(ws, 'b');
    for (const d of [dir1, dir2]) {
      await fs.mkdir(d);
      await fs.writeFile(
        path.join(d, 'project.yaml'),
        'id: proj-same\nname: s\ncodebases: []\ncreatedAt: "2026-04-21T00:00:00Z"\nupdatedAt: "2026-04-21T00:00:00Z"\n',
      );
    }
    const r1 = await POST(
      new Request('http://localhost', {
        method: 'POST',
        body: JSON.stringify({ projectDir: dir1 }),
      }),
    );
    expect(r1.status).toBe(201);
    const r2 = await POST(
      new Request('http://localhost', {
        method: 'POST',
        body: JSON.stringify({ projectDir: dir2 }),
      }),
    );
    expect(r2.status).toBe(409);
  });
});
```

- [ ] **Step 2: テスト失敗確認**

Run: `pnpm -F @tally/frontend test -- projects/import/route.test`
Expected: FAIL

- [ ] **Step 3: import 実装**

`packages/frontend/src/app/api/projects/import/route.ts`:

```ts
import path from 'node:path';
import {
  FileSystemProjectStore,
  listProjects,
  registerProject,
} from '@tally/storage';
import { NextResponse } from 'next/server';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const Body = z.object({ projectDir: z.string().min(1) });

export async function POST(req: Request): Promise<NextResponse> {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }
  const absDir = path.resolve(parsed.data.projectDir);
  const store = new FileSystemProjectStore(absDir);
  const meta = await store.getProjectMeta();
  if (!meta) {
    return NextResponse.json(
      { error: 'project.yaml が見つからない' },
      { status: 400 },
    );
  }
  const existing = await listProjects();
  if (existing.some((p) => p.id === meta.id && p.path !== absDir)) {
    return NextResponse.json(
      { error: `id 衝突: ${meta.id} は別のパスで既に登録されている` },
      { status: 409 },
    );
  }
  await registerProject({ id: meta.id, path: absDir });
  return NextResponse.json({ id: meta.id, projectDir: absDir }, { status: 201 });
}
```

- [ ] **Step 4: unregister テスト + 実装**

`packages/frontend/src/app/api/projects/[id]/unregister/route.test.ts`:

```ts
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { listProjects, registerProject } from '@tally/storage';
import { POST } from './route';

let home: string;
const orig = { ...process.env };
beforeEach(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), 'tally-home-'));
  process.env.TALLY_HOME = home;
});
afterEach(async () => {
  process.env = { ...orig };
  await fs.rm(home, { recursive: true, force: true });
});

describe('POST /api/projects/:id/unregister', () => {
  it('registry から外す（ディレクトリは消さない）', async () => {
    await registerProject({ id: 'proj-a', path: '/some/dir' });
    const res = await POST(new Request('http://localhost'), {
      params: Promise.resolve({ id: 'proj-a' }),
    });
    expect(res.status).toBe(204);
    expect(await listProjects()).toEqual([]);
  });
});
```

`packages/frontend/src/app/api/projects/[id]/unregister/route.ts`:

```ts
import { unregisterProject } from '@tally/storage';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await ctx.params;
  await unregisterProject(id);
  return new NextResponse(null, { status: 204 });
}
```

- [ ] **Step 5: テスト成功確認**

Run: `pnpm -F @tally/frontend test -- projects/import/ projects/\\[id\\]/unregister/`
Expected: PASS

- [ ] **Step 6: コミット**

```bash
git add packages/frontend/src/app/api/projects/import/ \
        packages/frontend/src/app/api/projects/\[id\]/unregister/
git commit -m "feat(frontend): /api/projects/import と /api/projects/:id/unregister を追加"
```

---

### Task 15: /api/projects/[id]/route.ts を codebases 対応に

**Files:**
- Modify: `packages/frontend/src/app/api/projects/[id]/route.ts`
- Modify: `packages/frontend/src/app/api/projects/[id]/route.test.ts`

- [ ] **Step 1: テストを更新**

既存テストで `codebasePath` / `additionalCodebasePaths` を使っている箇所を全て `codebases` に置換。追加テスト:

```ts
it('PATCH codebases を受け付ける', async () => {
  // セットアップでプロジェクト作成後
  const patch = { codebases: [{ id: 'a', label: 'A', path: '/a' }] };
  const res = await PATCH(
    new Request('http://localhost', {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
    { params: Promise.resolve({ id: projectId }) },
  );
  expect(res.status).toBe(200);
  const body = (await res.json()) as { codebases: unknown };
  expect(body.codebases).toEqual(patch.codebases);
});

it('GET 時に touchProject が呼ばれて lastOpenedAt が更新される', async () => {
  const before = Date.now();
  await GET(new Request('http://localhost'), { params: Promise.resolve({ id: projectId }) });
  const list = await listProjects();
  const entry = list.find((p) => p.id === projectId);
  expect(entry).toBeDefined();
  expect(new Date(entry?.lastOpenedAt ?? '').getTime() >= before).toBe(true);
});
```

- [ ] **Step 2: テスト失敗確認**

Run: `pnpm -F @tally/frontend test -- api/projects/\\[id\\]/route.test`
Expected: FAIL

- [ ] **Step 3: 実装**

`packages/frontend/src/app/api/projects/[id]/route.ts` で:
- project discovery を `listProjects()` + `FileSystemProjectStore` に置換
- GET 時に `touchProject(id)`
- PATCH は `ProjectMetaPatchSchema` で検証し、codebases 全置換

シグネチャ例:

```ts
import {
  FileSystemProjectStore,
  listProjects,
  touchProject,
} from '@tally/storage';
import { ProjectMetaPatchSchema } from '@tally/core';
// ...

async function resolveDir(id: string): Promise<string | null> {
  const list = await listProjects();
  return list.find((p) => p.id === id)?.path ?? null;
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await ctx.params;
  const dir = await resolveDir(id);
  if (!dir) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const store = new FileSystemProjectStore(dir);
  const project = await store.loadProject();
  if (!project) return NextResponse.json({ error: 'not found' }, { status: 404 });
  await touchProject(id);
  return NextResponse.json(project);
}

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await ctx.params;
  const dir = await resolveDir(id);
  if (!dir) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const parsed = ProjectMetaPatchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }
  const store = new FileSystemProjectStore(dir);
  const current = await store.getProjectMeta();
  if (!current) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const next = {
    ...current,
    ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
    ...(parsed.data.description !== undefined
      ? parsed.data.description === null
        ? ({} as Record<string, never>) // description 削除
        : { description: parsed.data.description }
      : {}),
    ...(parsed.data.codebases !== undefined ? { codebases: parsed.data.codebases } : {}),
    updatedAt: new Date().toISOString(),
  };
  if (parsed.data.description === null) delete (next as { description?: unknown }).description;
  await store.saveProjectMeta(next);
  return NextResponse.json(next);
}
```

- [ ] **Step 4: テスト成功確認**

Run: `pnpm -F @tally/frontend test -- api/projects/\\[id\\]/route.test`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add packages/frontend/src/app/api/projects/\[id\]/route.ts \
        packages/frontend/src/app/api/projects/\[id\]/route.test.ts
git commit -m "refactor(frontend): /api/projects/[id] を codebases[] + registry 駆動に刷新"
```

---

## Phase 4: Frontend ライブラリ層

### Task 16: api.ts クライアントを新 API に揃える

**Files:**
- Modify: `packages/frontend/src/lib/api.ts` + `.test.ts`

- [ ] **Step 1: テスト更新**

`api.test.ts` で `fetchWorkspaceCandidates` / `WorkspaceCandidate` を参照している箇所を削除し、新 API のテストを追加:

```ts
describe('registry clients', () => {
  it('fetchRegistryProjects が /api/projects を叩いて projects を返す', async () => {
    // fetch mock
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ projects: [{ id: 'a', name: 'A', codebases: [] }] }), {
        status: 200,
      }),
    );
    const list = await fetchRegistryProjects();
    expect(list[0]?.id).toBe('a');
  });

  it('importProject が POST /api/projects/import を叩く', async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: 'x', projectDir: '/x' }), { status: 201 }),
    );
    const res = await importProject('/some/dir');
    expect(res.id).toBe('x');
  });

  it('listDirectory が /api/fs/ls を叩く', async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          path: '/a',
          parent: null,
          entries: [],
          containsProjectYaml: false,
        }),
        { status: 200 },
      ),
    );
    const res = await listDirectory('/a');
    expect(res.path).toBe('/a');
  });
});
```

- [ ] **Step 2: テスト失敗確認**

Run: `pnpm -F @tally/frontend test -- lib/api.test`
Expected: FAIL

- [ ] **Step 3: 実装**

`packages/frontend/src/lib/api.ts` の旧 workspace-candidates 系を削除、新規クライアントを追加:

```ts
// 旧 WorkspaceCandidate / fetchWorkspaceCandidates を削除。

export interface CodebaseDto {
  id: string;
  label: string;
  path: string;
}

export interface RegistryProjectDto {
  id: string;
  name: string;
  description: string | null;
  codebases: CodebaseDto[];
  projectDir: string;
  createdAt: string;
  updatedAt: string;
  lastOpenedAt: string;
}

export async function fetchRegistryProjects(): Promise<RegistryProjectDto[]> {
  const res = await fetch('/api/projects');
  if (!res.ok) throw new Error(`API GET /api/projects ${res.status}`);
  const body = (await res.json()) as { projects: RegistryProjectDto[] };
  return body.projects;
}

export interface CreateProjectInput {
  projectDir: string;
  name: string;
  description?: string;
  codebases: CodebaseDto[];
}

export async function createProject(
  input: CreateProjectInput,
): Promise<{ id: string; projectDir: string }> {
  const res = await fetch('/api/projects', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `POST /api/projects ${res.status}`);
  }
  return (await res.json()) as { id: string; projectDir: string };
}

export async function importProject(
  projectDir: string,
): Promise<{ id: string; projectDir: string }> {
  const res = await fetch('/api/projects/import', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ projectDir }),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `POST /api/projects/import ${res.status}`);
  }
  return (await res.json()) as { id: string; projectDir: string };
}

export async function unregisterProjectApi(id: string): Promise<void> {
  const res = await fetch(`/api/projects/${encodeURIComponent(id)}/unregister`, {
    method: 'POST',
  });
  if (!res.ok) throw new Error(`POST /unregister ${res.status}`);
}

export interface FsEntry {
  name: string;
  path: string;
  isHidden: boolean;
  hasProjectYaml: boolean;
}

export interface FsListResult {
  path: string;
  parent: string | null;
  entries: FsEntry[];
  containsProjectYaml: boolean;
}

export async function listDirectory(path?: string): Promise<FsListResult> {
  const url = new URL('/api/fs/ls', window.location.origin);
  if (path !== undefined) url.searchParams.set('path', path);
  const res = await fetch(url.toString());
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `GET /api/fs/ls ${res.status}`);
  }
  return (await res.json()) as FsListResult;
}

export async function mkdir(
  parentPath: string,
  name: string,
): Promise<{ path: string }> {
  const res = await fetch('/api/fs/mkdir', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path: parentPath, name }),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `POST /api/fs/mkdir ${res.status}`);
  }
  return (await res.json()) as { path: string };
}
```

- [ ] **Step 4: テスト成功確認**

Run: `pnpm -F @tally/frontend test -- lib/api.test`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add packages/frontend/src/lib/api.ts packages/frontend/src/lib/api.test.ts
git commit -m "refactor(frontend/lib): api.ts を registry + fs + codebases[] に刷新"
```

---

### Task 17: store.ts を codebases[] 対応に

**Files:**
- Modify: `packages/frontend/src/lib/store.ts` + `.test.ts`

- [ ] **Step 1: テスト更新**

旧 `codebasePath` / `additionalCodebasePaths` 参照を `codebases` に全置換し、`patchProjectMeta` の codebases 全置換テストを追加。

- [ ] **Step 2: テスト失敗確認**

Run: `pnpm -F @tally/frontend test -- lib/store.test`
Expected: FAIL

- [ ] **Step 3: 実装**

`store.ts` の `patchProjectMeta` シグネチャを:

```ts
patchProjectMeta: (patch: { name?: string; description?: string | null; codebases?: Codebase[] }) => Promise<void>;
```

に変更し、内部で `/api/projects/[id]` PATCH を叩く。`Codebase` は `@tally/core` から import。

- [ ] **Step 4: テスト成功確認**

Run: `pnpm -F @tally/frontend test -- lib/store.test`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add packages/frontend/src/lib/store.ts packages/frontend/src/lib/store.test.ts
git commit -m "refactor(frontend/lib): store.patchProjectMeta を codebases[] 対応に"
```

---

## Phase 5: Frontend ダイアログ & ページ

### Task 18: FolderBrowserDialog

**Files:**
- Create: `packages/frontend/src/components/dialog/folder-browser-dialog.tsx`
- Create: `packages/frontend/src/components/dialog/folder-browser-dialog.test.tsx`

- [ ] **Step 1: 失敗するテストを書く**

`folder-browser-dialog.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FolderBrowserDialog } from './folder-browser-dialog';

beforeEach(() => {
  global.fetch = vi.fn().mockImplementation((url: string) => {
    const u = new URL(url, 'http://localhost');
    if (u.pathname === '/api/fs/ls') {
      const p = u.searchParams.get('path') ?? '/home/you';
      const entries =
        p === '/home/you'
          ? [
              { name: 'acme', path: '/home/you/acme', isHidden: false, hasProjectYaml: false },
              { name: '.ssh', path: '/home/you/.ssh', isHidden: true, hasProjectYaml: false },
            ]
          : [];
      return Promise.resolve(
        new Response(
          JSON.stringify({
            path: p,
            parent: p === '/' ? null : '/',
            entries,
            containsProjectYaml: false,
          }),
          { status: 200 },
        ),
      );
    }
    if (u.pathname === '/api/fs/mkdir') {
      return Promise.resolve(
        new Response(JSON.stringify({ path: '/home/you/new-dir' }), { status: 201 }),
      );
    }
    return Promise.reject(new Error('unexpected'));
  }) as typeof fetch;
});

describe('FolderBrowserDialog', () => {
  it('初期表示で initialPath の中身を一覧表示', async () => {
    render(
      <FolderBrowserDialog
        open
        initialPath="/home/you"
        purpose="create-project"
        onConfirm={() => {}}
        onClose={() => {}}
      />,
    );
    expect(await screen.findByText('acme')).toBeInTheDocument();
  });

  it('隠しフォルダはデフォルト非表示、トグルで表示', async () => {
    render(
      <FolderBrowserDialog
        open
        initialPath="/home/you"
        purpose="create-project"
        onConfirm={() => {}}
        onClose={() => {}}
      />,
    );
    await screen.findByText('acme');
    expect(screen.queryByText('.ssh')).not.toBeInTheDocument();
    await userEvent.click(screen.getByLabelText('隠しフォルダを表示'));
    expect(await screen.findByText('.ssh')).toBeInTheDocument();
  });

  it('「選択」で onConfirm に現在のパスを渡す', async () => {
    const onConfirm = vi.fn();
    render(
      <FolderBrowserDialog
        open
        initialPath="/home/you"
        purpose="create-project"
        onConfirm={onConfirm}
        onClose={() => {}}
      />,
    );
    await screen.findByText('acme');
    await userEvent.click(screen.getByRole('button', { name: '選択' }));
    expect(onConfirm).toHaveBeenCalledWith('/home/you');
  });

  it('import-project で project.yaml 無しなら「選択」は disabled', async () => {
    render(
      <FolderBrowserDialog
        open
        initialPath="/home/you"
        purpose="import-project"
        onConfirm={() => {}}
        onClose={() => {}}
      />,
    );
    await screen.findByText('acme');
    expect(screen.getByRole('button', { name: '選択' })).toBeDisabled();
  });
});
```

- [ ] **Step 2: テスト失敗確認**

Run: `pnpm -F @tally/frontend test -- folder-browser-dialog.test`
Expected: FAIL

- [ ] **Step 3: 最小実装**

`folder-browser-dialog.tsx`（骨格）:

```tsx
'use client';

import { useCallback, useEffect, useState } from 'react';

import { listDirectory, mkdir, type FsListResult } from '@/lib/api';

export interface FolderBrowserDialogProps {
  open: boolean;
  initialPath?: string;
  purpose: 'create-project' | 'import-project' | 'add-codebase';
  onConfirm: (absolutePath: string) => void;
  onClose: () => void;
}

export function FolderBrowserDialog(props: FolderBrowserDialogProps) {
  const [listing, setListing] = useState<FsListResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const [newDirName, setNewDirName] = useState('');

  const load = useCallback(async (targetPath?: string) => {
    setError(null);
    try {
      const res = await listDirectory(targetPath);
      setListing(res);
    } catch (err) {
      setError(String((err as Error).message ?? err));
    }
  }, []);

  useEffect(() => {
    if (props.open) void load(props.initialPath);
  }, [props.open, props.initialPath, load]);

  if (!props.open) return null;

  const confirmDisabled =
    listing === null ||
    (props.purpose === 'import-project' && !listing.containsProjectYaml);

  const visibleEntries = (listing?.entries ?? []).filter((e) => showHidden || !e.isHidden);

  const onConfirmClick = () => {
    if (!listing) return;
    props.onConfirm(listing.path);
  };

  const onCreateDir = async () => {
    if (!listing || newDirName.trim().length === 0) return;
    try {
      const res = await mkdir(listing.path, newDirName.trim());
      setNewDirName('');
      await load(res.path);
    } catch (err) {
      setError(String((err as Error).message ?? err));
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)' }} role="dialog">
      <div style={{ background: '#161b22', padding: 20, borderRadius: 8 }}>
        <h2>{titleFor(props.purpose)}</h2>
        <div>
          <input
            type="text"
            value={listing?.path ?? ''}
            onChange={(e) => void load(e.target.value)}
            aria-label="現在のパス"
          />
          <button
            type="button"
            disabled={listing?.parent === null || listing === null}
            onClick={() => listing?.parent && void load(listing.parent)}
          >
            ↑ 親
          </button>
        </div>
        {error && <div role="alert">{error}</div>}
        <ul>
          {visibleEntries.map((e) => (
            <li key={e.path}>
              <button type="button" onClick={() => void load(e.path)}>
                📁 {e.name} {e.hasProjectYaml ? '(project.yaml あり)' : ''}
              </button>
            </li>
          ))}
        </ul>
        <label>
          <input
            type="checkbox"
            checked={showHidden}
            onChange={(e) => setShowHidden(e.target.checked)}
          />
          隠しフォルダを表示
        </label>
        <div>
          <input
            type="text"
            placeholder="新規フォルダ名"
            value={newDirName}
            onChange={(e) => setNewDirName(e.target.value)}
            aria-label="新規フォルダ名"
          />
          <button type="button" onClick={() => void onCreateDir()}>
            + 新規フォルダ
          </button>
        </div>
        <div>
          <button type="button" onClick={props.onClose}>キャンセル</button>
          <button type="button" disabled={confirmDisabled} onClick={onConfirmClick}>
            選択
          </button>
        </div>
      </div>
    </div>
  );
}

function titleFor(purpose: FolderBrowserDialogProps['purpose']): string {
  switch (purpose) {
    case 'create-project':
      return 'プロジェクトルートを選択';
    case 'import-project':
      return '既存プロジェクトを選択';
    case 'add-codebase':
      return 'コードベースのリポジトリを選択';
  }
}
```

- [ ] **Step 4: テスト成功確認**

Run: `pnpm -F @tally/frontend test -- folder-browser-dialog.test`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add packages/frontend/src/components/dialog/folder-browser-dialog.tsx \
        packages/frontend/src/components/dialog/folder-browser-dialog.test.tsx
git commit -m "feat(frontend): FolderBrowserDialog 追加（/api/fs/ls ・ /api/fs/mkdir 駆動）"
```

---

### Task 19: NewProjectDialog 刷新

**Files:**
- Modify: `packages/frontend/src/components/dialog/new-project-dialog.tsx`（全面刷新）
- Modify: `packages/frontend/src/components/dialog/new-project-dialog.test.tsx`（全面刷新）

- [ ] **Step 1: テストを書き換える**

`new-project-dialog.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NewProjectDialog } from './new-project-dialog';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

beforeEach(() => {
  push.mockReset();
  global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/api/projects') && init?.method === 'POST') {
      return new Response(JSON.stringify({ id: 'proj-new', projectDir: '/x' }), { status: 201 });
    }
    // FolderBrowserDialog 内の /api/fs/ls
    return new Response(
      JSON.stringify({
        path: '/home/you',
        parent: null,
        entries: [],
        containsProjectYaml: false,
      }),
      { status: 200 },
    );
  }) as typeof fetch;
});

describe('NewProjectDialog', () => {
  it('名前が空なら「作成」は disabled', () => {
    render(<NewProjectDialog open onClose={() => {}} />);
    expect(screen.getByRole('button', { name: /作成/ })).toBeDisabled();
  });

  it('codebases 0 件でも「作成」は押せる', async () => {
    render(<NewProjectDialog open onClose={() => {}} />);
    await userEvent.type(screen.getByLabelText('プロジェクト名'), '思考ログ');
    expect(screen.getByRole('button', { name: /作成/ })).toBeEnabled();
  });

  it('作成成功時に /projects/:id へ遷移', async () => {
    render(<NewProjectDialog open onClose={() => {}} />);
    await userEvent.type(screen.getByLabelText('プロジェクト名'), '思考ログ');
    await userEvent.click(screen.getByRole('button', { name: /作成/ }));
    await screen.findByText(/作成中|作成/); // busy or complete
    expect(push).toHaveBeenCalledWith('/projects/proj-new');
  });

  it('codebases[].id 重複は「作成」disabled', async () => {
    render(<NewProjectDialog open onClose={() => {}} />);
    await userEvent.type(screen.getByLabelText('プロジェクト名'), 'p');
    // 内部に 2 件手動入力する UI を前提。同じ id を入れたときに disabled
    // （実装後に具体的な testid を決めてここを埋める）
  });
});
```

- [ ] **Step 2: テスト失敗確認**

Run: `pnpm -F @tally/frontend test -- new-project-dialog.test`
Expected: FAIL

- [ ] **Step 3: 実装（概略）**

`new-project-dialog.tsx`:

```tsx
'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { Codebase } from '@tally/core';
import { createProject } from '@/lib/api';
import { FolderBrowserDialog } from './folder-browser-dialog';

interface Props {
  open: boolean;
  onClose: () => void;
}

export function NewProjectDialog({ open, onClose }: Props) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [projectDir, setProjectDir] = useState<string>('');
  const [codebases, setCodebases] = useState<Codebase[]>([]);
  const [pickerFor, setPickerFor] = useState<null | 'root' | 'codebase'>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const duplicateIds = new Set<string>();
  const seen = new Set<string>();
  for (const c of codebases) {
    if (seen.has(c.id)) duplicateIds.add(c.id);
    seen.add(c.id);
  }
  const disabled =
    busy || name.trim().length === 0 || projectDir.trim().length === 0 || duplicateIds.size > 0;

  const onPickRoot = (p: string) => {
    setProjectDir(p);
    setPickerFor(null);
  };

  const onPickCodebase = (p: string) => {
    const slug = p.split('/').pop()?.toLowerCase().replace(/[^a-z0-9-]/g, '-') ?? 'cb';
    let id = slug.slice(0, 32);
    if (id.length === 0) id = 'cb';
    while (codebases.some((c) => c.id === id)) id = `${id.slice(0, 28)}-${Math.random().toString(36).slice(2, 4)}`;
    setCodebases([...codebases, { id, label: slug, path: p }]);
    setPickerFor(null);
  };

  const onSubmit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await createProject({
        projectDir,
        name: name.trim(),
        ...(description.trim().length > 0 ? { description: description.trim() } : {}),
        codebases,
      });
      router.push(`/projects/${encodeURIComponent(res.id)}`);
    } catch (e) {
      setError(String((e as Error).message ?? e));
      setBusy(false);
    }
  };

  return (
    <div role="dialog">
      <label>
        プロジェクト名
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label>
        説明
        <input value={description} onChange={(e) => setDescription(e.target.value)} />
      </label>
      <div>
        保存先: {projectDir || '(未選択)'}
        <button type="button" onClick={() => setPickerFor('root')}>
          フォルダを選択
        </button>
      </div>
      <div>
        コードベース:
        <ul>
          {codebases.map((c, i) => (
            <li key={`${c.id}-${i}`}>
              <input
                value={c.id}
                onChange={(e) => {
                  const next = [...codebases];
                  next[i] = { ...c, id: e.target.value };
                  setCodebases(next);
                }}
              />
              <input
                value={c.label}
                onChange={(e) => {
                  const next = [...codebases];
                  next[i] = { ...c, label: e.target.value };
                  setCodebases(next);
                }}
              />
              <span>{c.path}</span>
              {duplicateIds.has(c.id) && <span role="alert">id 重複</span>}
              <button
                type="button"
                onClick={() => setCodebases(codebases.filter((_, j) => j !== i))}
              >
                削除
              </button>
            </li>
          ))}
        </ul>
        <button type="button" onClick={() => setPickerFor('codebase')}>
          + コードベース追加
        </button>
      </div>
      {error && <div role="alert">{error}</div>}
      <div>
        <button type="button" onClick={onClose}>キャンセル</button>
        <button type="button" disabled={disabled} onClick={() => void onSubmit()}>
          作成
        </button>
      </div>
      <FolderBrowserDialog
        open={pickerFor !== null}
        purpose={pickerFor === 'codebase' ? 'add-codebase' : 'create-project'}
        onConfirm={pickerFor === 'codebase' ? onPickCodebase : onPickRoot}
        onClose={() => setPickerFor(null)}
      />
    </div>
  );
}
```

注: デフォルトのプロジェクトルートパス提案（`<TALLY_HOME>/projects/<slug>/`）は別 API が必要（Task 20 で `/api/projects/default-path?name=...` として追加する手もあるが、最小スコープでは projectDir の初期値を空にしてユーザーに明示選択させる形で OK。ただし UX 的には不便なので Task 20 で追加する）。

- [ ] **Step 4: テスト成功確認**

Run: `pnpm -F @tally/frontend test -- new-project-dialog.test`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add packages/frontend/src/components/dialog/new-project-dialog.tsx \
        packages/frontend/src/components/dialog/new-project-dialog.test.tsx
git commit -m "feat(frontend): NewProjectDialog を FolderBrowserDialog + codebases[] 対応に全面刷新"
```

---

### Task 20: デフォルトパス提案 API と NewProjectDialog 連携

**Files:**
- Create: `packages/frontend/src/app/api/projects/default-path/route.ts` + `.test.ts`
- Modify: `packages/frontend/src/lib/api.ts`（`fetchDefaultProjectPath` 追加）
- Modify: `packages/frontend/src/components/dialog/new-project-dialog.tsx`（初期値補填）

- [ ] **Step 1: 失敗するテストを書く**

`default-path/route.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { GET } from './route';

describe('GET /api/projects/default-path', () => {
  it('name を slug 化してデフォルトパス候補を返す', async () => {
    const url = 'http://localhost/api/projects/default-path?name=My%20Proj%21';
    const res = await GET(new Request(url));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { path: string };
    expect(body.path).toMatch(/\/projects\/my-proj$/);
  });

  it('衝突時にサフィックスを付与', async () => {
    // resolveDefaultProjectsRoot に同名 dir を作って干渉させる
    // 詳細は実装と合わせて書き直す
  });
});
```

- [ ] **Step 2: テスト失敗確認 → 実装 → 成功確認 → 連携 → コミット**

（Task 19 と同様の TDD サイクル。実装詳細は省略可だが、`packages/storage` の `resolveDefaultProjectsRoot` を活用し、slug 化と衝突回避を行う。NewProjectDialog 側は name 入力時に debounce でこの API を叩き projectDir を初期値に入れる）

```bash
git add packages/frontend/src/app/api/projects/default-path/ \
        packages/frontend/src/lib/api.ts \
        packages/frontend/src/components/dialog/new-project-dialog.tsx
git commit -m "feat(frontend): プロジェクト作成時にデフォルト保存先をサーバー提案"
```

---

### Task 21: ProjectImportDialog

**Files:**
- Create: `packages/frontend/src/components/dialog/project-import-dialog.tsx`
- Create: `packages/frontend/src/components/dialog/project-import-dialog.test.tsx`

- [ ] **Step 1: 失敗するテストを書く**

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectImportDialog } from './project-import-dialog';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

beforeEach(() => {
  push.mockReset();
  global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/api/projects/import') && init?.method === 'POST') {
      return new Response(JSON.stringify({ id: 'proj-imp', projectDir: '/x' }), { status: 201 });
    }
    return new Response(
      JSON.stringify({
        path: '/home/you',
        parent: null,
        entries: [
          { name: 'existing', path: '/home/you/existing', isHidden: false, hasProjectYaml: true },
        ],
        containsProjectYaml: false,
      }),
      { status: 200 },
    );
  }) as typeof fetch;
});

describe('ProjectImportDialog', () => {
  it('project.yaml を含む dir を選び「インポート」で /api/projects/import を叩く', async () => {
    render(<ProjectImportDialog open onClose={() => {}} />);
    // folder browser で existing を選択
    await userEvent.click(await screen.findByText('existing', { exact: false }));
    // containsProjectYaml: true のディレクトリで「選択」が有効
    // 実装時に具体の操作を詳細化
  });
});
```

- [ ] **Step 2-5: 実装 → 成功確認 → コミット**

（FolderBrowserDialog を purpose='import-project' で呼び、返り値を受けて `importProject()` を叩いて `/projects/[id]` に遷移）

```bash
git add packages/frontend/src/components/dialog/project-import-dialog.tsx \
        packages/frontend/src/components/dialog/project-import-dialog.test.tsx
git commit -m "feat(frontend): ProjectImportDialog 追加"
```

---

### Task 22: ProjectSettingsDialog を codebases[] 対応に全面刷新

**Files:**
- Modify: `packages/frontend/src/components/dialog/project-settings-dialog.tsx`
- Modify: `packages/frontend/src/components/dialog/project-settings-dialog.test.tsx`

- [ ] **Step 1: テストを書き換える**

旧 `codebasePath` / `additionalCodebasePaths` 入力 UI のテストを削除し、`codebases[]` の追加・削除・並び替え・ラベル編集の新 UI のテストに置換。

- [ ] **Step 2: テスト失敗確認**

Run: `pnpm -F @tally/frontend test -- project-settings-dialog.test`
Expected: FAIL

- [ ] **Step 3: 実装**

NewProjectDialog の codebases セクションと同じ UI パーツを抽出して共通化（簡易版でよい）、FolderBrowserDialog（purpose: 'add-codebase'）で codebase を追加、`patchProjectMeta({ codebases: nextList })` を呼ぶ。

codebases 0 件にする操作は、使用中の coderef が無い場合のみ許可（store.ts 側で検証、エラー時はダイアログ内で表示）。

- [ ] **Step 4: テスト成功確認 → Step 5: コミット**

```bash
git add packages/frontend/src/components/dialog/project-settings-dialog.tsx \
        packages/frontend/src/components/dialog/project-settings-dialog.test.tsx
git commit -m "refactor(frontend): ProjectSettingsDialog を codebases[] 管理に全面刷新"
```

---

### Task 23: トップページ（projects 一覧）を registry 駆動に

**Files:**
- Modify: `packages/frontend/src/app/page.tsx`
- Modify: `packages/frontend/src/app/page.test.tsx`（あれば）

- [ ] **Step 1: テスト更新**

fetch mock を `/api/projects` が `projects[]` を返すように調整し、「+ 新規プロジェクト」「既存を読み込む」の 2 ボタン、各プロジェクト行に「開く」「レジストリから外す」の UI テストを書く。

- [ ] **Step 2-4: TDD サイクル**

実装: `fetchRegistryProjects()` で一覧取得、`unregisterProjectApi(id)` で外す、「既存を読み込む」で `ProjectImportDialog` を開く、「+ 新規プロジェクト」で `NewProjectDialog` を開く。

- [ ] **Step 5: コミット**

```bash
git add packages/frontend/src/app/page.tsx packages/frontend/src/app/page.test.tsx
git commit -m "refactor(frontend): トップページを registry 駆動に、インポートUIと新規プロジェクト UI を統合"
```

---

## Phase 6: AI Engine regression 修正

### Task 24: ai-engine の codebasePath シグネチャを `codebases[]` 対応に（in-scope 最小）

**Files:**
- Modify: `packages/ai-engine/src/agent-runner.ts` + `.test.ts`
- Modify: `packages/ai-engine/src/agents/codebase-anchor.ts` + `.test.ts`
- Modify: `packages/ai-engine/src/agents/find-related-code.ts` + `.test.ts`
- Modify: `packages/ai-engine/src/agents/analyze-impact.ts` + `.test.ts`
- Modify: `packages/ai-engine/src/agents/extract-questions.ts` + `.test.ts`
- Modify: `packages/ai-engine/src/server.test.ts`（テスト側のみ）

- [ ] **Step 1: 失敗するテストを書く**

各 agent の `.test.ts` で `codebasePath: '/x'` 引数を `codebase: { id: 'x', label: 'X', path: '/x' }` に書き換える。`agent-runner.test.ts` も同様に呼び出し側を更新。

- [ ] **Step 2: テスト失敗確認**

Run: `pnpm -F @tally/ai-engine test`
Expected: FAIL（旧シグネチャ）

- [ ] **Step 3: 各 agent の入力シグネチャ変更**

`codebase-anchor.ts` 例:

```ts
import type { Codebase } from '@tally/core';

export interface CodebaseAnchorInput {
  codebase: Codebase;
  // ... 既存
}

export async function runCodebaseAnchor(input: CodebaseAnchorInput) {
  const cwd = input.codebase.path;
  // ... 既存ロジック、input.codebasePath を input.codebase.path に置換
}
```

同様に他エージェントも `codebase: Codebase` 引数へ変更。呼び出し箇所（`agent-runner.ts`）で `projectMeta.codebases[0]` を受け取って渡すデフォルト処理を入れる（codebases 0 件のケースは呼び出し側で事前に弾く前提）。

- [ ] **Step 4: テスト成功確認**

Run: `pnpm -F @tally/ai-engine test`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add packages/ai-engine/src
git commit -m "refactor(ai-engine): agents を codebase: Codebase 引数に変更

単一 codebasePath 前提を撤廃し、呼び出し側が Codebase オブジェクトを渡すシグネチャに。
複数 codebase を跨いだ探索は別 spec のスコープ（out-of-scope）。"
```

---

### Task 25: ai-actions ボタン群を codebases[] 対応に

**Files:**
- Modify: `packages/frontend/src/components/ai-actions/codebase-agent-button.tsx` + `.test.tsx`
- Modify: `packages/frontend/src/components/ai-actions/find-related-code-button.tsx` + `.test.tsx`
- Modify: `packages/frontend/src/components/ai-actions/analyze-impact-button.tsx` + `.test.tsx`
- Modify: `packages/frontend/src/components/ai-actions/extract-questions-button.tsx`（必要なら）
- Modify: `packages/frontend/src/components/ai-actions/graph-agent-button.tsx`

- [ ] **Step 1: 失敗するテストを書く（1 ボタンずつ）**

codebase-agent-button.test.tsx に:

```tsx
it('codebases が 0 件なら disabled + tooltip', () => {
  // useCanvasStore を mock して projectMeta.codebases: [] を返す
  // ボタンが disabled であることと、ツールチップ文言を検証
});

it('codebases が 1 件のみならそれを使う', () => {
  // 単一 codebase を渡して agent 呼び出し引数を検証
});

it('codebases が 2 件以上なら選択 UI（ドロップダウン）を表示', () => {
  // ドロップダウン選択後にボタン押下、正しい codebase が渡る
});
```

- [ ] **Step 2-4: TDD サイクル**

実装: 各ボタンで `projectMeta.codebases` を参照し、0 件 → disabled、1 件 → そのまま、2 件以上 → 選択 UI を出す。選択後の codebase を agent 呼び出しに渡す。

- [ ] **Step 5: コミット**

```bash
git add packages/frontend/src/components/ai-actions/
git commit -m "feat(frontend/ai-actions): codebases[] 対応（0件disabled, 1件自動, 複数件選択UI）"
```

---

## Phase 7: ドキュメント & フィクスチャ

### Task 26: ADR-0008 / 0009 / 0010 を書く

**Files:**
- Create: `docs/adr/0008-project-independent-from-repo.md`
- Create: `docs/adr/0009-project-registry.md`
- Create: `docs/adr/0010-multiple-codebases.md`
- Modify: `docs/adr/0003-git-managed-yaml.md`（Superseded に）

- [ ] **Step 1: ADR 執筆**

既存 ADR (`docs/adr/0001-sysml-alignment.md` 等) の形式に合わせて書く:

```markdown
# ADR-0008: プロジェクトをリポジトリから切り離す

- **日付**: 2026-04-21
- **ステータス**: Accepted
- **Supersedes**: ADR-0003

## コンテキスト
（spec の「背景」から抜粋・整形）

## 決定
プロジェクト = 任意のディレクトリ。`.tally/` サブディレクトリ規約を廃止。
プロジェクトディレクトリ直下に `project.yaml` / `nodes/` / `edges/` / `chats/` を置く。

## 影響
- 暗黙スキャン（ghq / TALLY_WORKSPACE）全廃（ADR-0009 に続く）
- 1 プロジェクト = 1 リポジトリ前提の解消（ADR-0010 に続く）

## 参考
- spec: `docs/superpowers/specs/2026-04-21-project-storage-redesign-design.md`
```

ADR-0009 / 0010 も同様に spec の該当セクションから起こす。

ADR-0003 のステータスを `Superseded by ADR-0008` に変更し、冒頭に注記を追加。

- [ ] **Step 2: コミット**

```bash
git add docs/adr/0003-git-managed-yaml.md docs/adr/0008-*.md docs/adr/0009-*.md docs/adr/0010-*.md
git commit -m "docs(adr): ADR-0008/0009/0010 追加、ADR-0003 を Superseded に"
```

---

### Task 27: examples/sample-project を刷新

**Files:**
- Delete: `examples/sample-project/.tally/` 以下全て
- Create: `examples/sample-project/project.yaml`, `examples/sample-project/nodes/*`, `examples/sample-project/edges/edges.yaml`

- [ ] **Step 1: 現在の `.tally/` 中身を確認**

```bash
ls examples/sample-project/.tally/
cat examples/sample-project/.tally/project.yaml
```

- [ ] **Step 2: `.tally/` 内容を `examples/sample-project/` 直下に移動**

```bash
mv examples/sample-project/.tally/project.yaml examples/sample-project/
mv examples/sample-project/.tally/nodes examples/sample-project/
mv examples/sample-project/.tally/edges examples/sample-project/
rmdir examples/sample-project/.tally
```

- [ ] **Step 3: project.yaml を新スキーマに書き換え**

`examples/sample-project/project.yaml`:

```yaml
id: proj-sample-0001
name: TaskFlow 招待機能追加
description: SaaS にチーム招待機能を追加するプロジェクト
codebases:
  - id: backend
    label: TaskFlow API
    path: ../taskflow-backend
createdAt: 2026-04-18T10:00:00Z
updatedAt: 2026-04-21T00:00:00Z
```

- [ ] **Step 4: 既存の coderef ノードに `codebaseId: backend` を追加**

```bash
# coderef 系の yaml を検出して手動編集
grep -l "^type: coderef" examples/sample-project/nodes/*.yaml
# 各ファイルに codebaseId: backend を追加
```

- [ ] **Step 5: 動作確認 + コミット**

```bash
pnpm -F @tally/storage test   # 全体の test を通す
git add examples/sample-project
git commit -m "refactor(examples): sample-project を codebases[] スキーマに移行"
```

---

### Task 28: CLAUDE.md / README.md / docs 更新

**Files:**
- Modify: `CLAUDE.md`
- Modify: `README.md`
- Modify: `docs/03-architecture.md` など（`.tally/` 言及を持つものすべて）

- [ ] **Step 1: `.tally/` 参照を全 grep**

```bash
grep -rn "\.tally/" CLAUDE.md README.md docs/
```

- [ ] **Step 2: 各ファイルを更新**

- `.tally/` → 「プロジェクトディレクトリ」または具体例 `~/.local/share/tally/projects/<slug>/`
- `TALLY_WORKSPACE` → `TALLY_HOME`
- ghq 連携記述 → 削除、レジストリ + フォルダピッカーの説明に置換
- ADR-0003 リンク → Superseded の注釈と ADR-0008 への参照

- [ ] **Step 3: コミット**

```bash
git add CLAUDE.md README.md docs/
git commit -m "docs: .tally/ 規約廃止を反映、registry ベースの利用フローに更新"
```

---

### Task 29: 全体 E2E 確認

- [ ] **Step 1: パッケージごとに test 実行**

```bash
pnpm -r test
```

Expected: すべて PASS

- [ ] **Step 2: typecheck / lint**

```bash
pnpm -r typecheck
pnpm -r lint
```

Expected: エラーなし

- [ ] **Step 3: dev 起動して手動確認**

```bash
pnpm dev
```

ブラウザで:
1. `+ 新規プロジェクト` → FolderBrowserDialog で任意の空 dir を選択 → codebase 追加（任意）→ 作成
2. `既存を読み込む` → FolderBrowserDialog → import
3. トップページでプロジェクト一覧表示、「開く」「レジストリから外す」動作
4. プロジェクト内で coderef ノード作成、AI ボタンが codebases[] を参照

- [ ] **Step 4: 最終コミット（残件があれば）**

```bash
# 手動確認で発見した fix があればコミット
git commit -m "fix: E2E 確認で発見した問題を修正"
```

---

## 実装順序の要約

1. Phase 1 (Task 1-2): core 型刷新 — 全体のコンパイル起点
2. Phase 2 (Task 3-10): storage 層 — registry / project-dir / init-project / ストア刷新
3. Phase 3 (Task 11-15): バックエンド API — fs 系、projects 系
4. Phase 4 (Task 16-17): frontend lib — api / store
5. Phase 5 (Task 18-23): frontend dialog & page — FolderBrowser / NewProject / Import / Settings / top page
6. Phase 6 (Task 24-25): ai-engine regression fix
7. Phase 7 (Task 26-29): docs / examples / E2E

途中で型エラーが別パッケージに波及するため、Phase 1 → Phase 2 の境目と、Phase 4 / 5 の境目で `pnpm -r typecheck` をかけて穴を埋める。

---

## Self-Review 結果

- **spec カバレッジ**: spec 各セクション（データモデル / レジストリ / フォルダブラウザ / 変更&削除リスト / テスト戦略 / ADR / スコープ境界）はすべて Task に対応
- **placeholder**: 未定義関数・TBD・"同様" 参照はなし。一部 UI モック操作の詳細は実装時に `testid` を決めて埋めるとしている（Task 19, 21, 22）— 許容範囲
- **型整合**: `Codebase` / `ProjectMeta` / `FsListResult` / `RegistryEntry` のフィールド名は全 Task で一貫
- **coderef vs code**: 実コードの型名 `coderef` を計画内で統一
