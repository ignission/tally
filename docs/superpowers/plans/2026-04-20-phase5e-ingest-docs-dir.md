# Phase 5e: ingest-document にディレクトリ入力 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 既存 `ingest-document` エージェントに「ディレクトリ入力」モードを追加し、ユーザーが `docs` ディレクトリを指定するだけで AI が配下の Markdown を走査して requirement + usecase proposal + satisfy エッジを生成するようにする。

**Architecture:** `ingest-document` の inputSchema を `{source: 'paste'|'docs-dir', ...}` の discriminated union に拡張。docs-dir モードで allowedTools に `Read` / `Glob` を追加、validateInput で `dirPath` が workspaceRoot 配下かを検証し cwd を返す。agent-runner / create_node は変更不要 (Phase 5d で input / cwd / anchor 無しのルートが完成している)。Frontend は IngestDocumentDialog にタブ切替えを追加、store の `startIngestDocument` シグネチャを `(text: string)` から `(input: IngestDocumentInput)` へ変更。

**Tech Stack:** TypeScript, Claude Agent SDK, Next.js 15, Zustand, Zod, Vitest, Testing Library.

---

## 前提

- spec: `docs/superpowers/specs/2026-04-20-phase5e-ingest-docs-dir-design.md`
- 直前 Phase: `docs/superpowers/plans/2026-04-20-phase5d-ingest-document.md`
- ADR-0007 (エージェントツール制約)
- HEAD (開始時): `586b47c docs: Phase 5e ingest-docs-dir 設計書を追加`

## ファイル構造

### core
- 変更なし

### ai-engine
- **変更** `packages/ai-engine/src/agents/ingest-document.ts` — inputSchema / validateInput / buildPrompt / allowedTools
- **変更** `packages/ai-engine/src/agents/ingest-document.test.ts`

### frontend
- **変更** `packages/frontend/src/components/dialog/ingest-document-dialog.tsx` — タブ + dirPath input
- **変更** `packages/frontend/src/components/dialog/ingest-document-dialog.test.tsx`
- **変更** `packages/frontend/src/lib/store.ts` — `startIngestDocument(input)` シグネチャ変更
- **変更** `packages/frontend/src/lib/store.test.ts`

### docs
- **変更** `docs/04-roadmap.md`
- **新規** `docs/phase-5e-manual-e2e.md`
- **新規** `docs/phase-5e-progress.md`

---

## Task 1: ai-engine の ingest-document を discriminated input + docs-dir 対応

**Files:**
- Modify: `packages/ai-engine/src/agents/ingest-document.ts`
- Modify: `packages/ai-engine/src/agents/ingest-document.test.ts`

- [ ] **Step 1: 既存テストを新シグネチャに合わせて書き換える (RED)**

`packages/ai-engine/src/agents/ingest-document.test.ts` を**全面置き換え**:

```typescript
import { promises as fs } from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { ProjectStore } from '@tally/storage';
import { describe, expect, it, vi } from 'vitest';

import { buildIngestDocumentPrompt, ingestDocumentAgent } from './ingest-document';

const pasteInput = { source: 'paste', text: '招待機能を追加する。メンバーがメールで招待を送る。' } as const;
const docsDirInput = { source: 'docs-dir', dirPath: 'docs' } as const;

describe('buildIngestDocumentPrompt (paste モード)', () => {
  it('役割と出力規約を含む system prompt を返す', () => {
    const { systemPrompt } = buildIngestDocumentPrompt({ input: pasteInput });
    expect(systemPrompt).toContain('要求書取り込みアシスタント');
    expect(systemPrompt).toContain('requirement');
    expect(systemPrompt).toContain('usecase');
    expect(systemPrompt).toContain('satisfy');
    expect(systemPrompt).toContain('adoptAs="requirement"');
    expect(systemPrompt).toContain('adoptAs="usecase"');
  });

  it('user prompt に元テキストが埋め込まれる', () => {
    const { userPrompt } = buildIngestDocumentPrompt({ input: pasteInput });
    expect(userPrompt).toContain('招待機能を追加する');
  });

  it('paste モードは Glob/Read への言及を含まない', () => {
    const { systemPrompt } = buildIngestDocumentPrompt({ input: pasteInput });
    expect(systemPrompt).not.toMatch(/Glob/);
    expect(systemPrompt).not.toMatch(/Read/);
  });
});

describe('buildIngestDocumentPrompt (docs-dir モード)', () => {
  it('Glob / Read 使用手順 + dirPath を含む system prompt', () => {
    const { systemPrompt } = buildIngestDocumentPrompt({ input: docsDirInput });
    expect(systemPrompt).toContain('Glob');
    expect(systemPrompt).toContain('Read');
    expect(systemPrompt).toContain('Markdown');
    expect(systemPrompt).toContain('satisfy');
  });

  it('user prompt に dirPath が入る', () => {
    const { userPrompt } = buildIngestDocumentPrompt({ input: docsDirInput });
    expect(userPrompt).toContain('docs');
  });
});

describe('ingestDocumentAgent', () => {
  it('allowedTools が MCP 4 個 + Read / Glob', () => {
    expect(ingestDocumentAgent.name).toBe('ingest-document');
    expect(ingestDocumentAgent.allowedTools).toEqual([
      'mcp__tally__create_node',
      'mcp__tally__create_edge',
      'mcp__tally__find_related',
      'mcp__tally__list_by_type',
      'Read',
      'Glob',
    ]);
  });

  it('inputSchema discriminated union: paste / docs-dir のみ受理', () => {
    expect(ingestDocumentAgent.inputSchema.safeParse(pasteInput).success).toBe(true);
    expect(ingestDocumentAgent.inputSchema.safeParse(docsDirInput).success).toBe(true);
    // 他 source は拒否
    expect(
      ingestDocumentAgent.inputSchema.safeParse({ source: 'file', text: 'x' }).success,
    ).toBe(false);
    // paste で text 空は拒否
    expect(
      ingestDocumentAgent.inputSchema.safeParse({ source: 'paste', text: '' }).success,
    ).toBe(false);
    // docs-dir で dirPath 空は拒否
    expect(
      ingestDocumentAgent.inputSchema.safeParse({ source: 'docs-dir', dirPath: '' }).success,
    ).toBe(false);
    // 50_001 文字の text は拒否
    expect(
      ingestDocumentAgent.inputSchema.safeParse({ source: 'paste', text: 'x'.repeat(50_001) })
        .success,
    ).toBe(false);
  });

  it('validateInput paste: 無条件で ok / cwd は無し', async () => {
    const r = await ingestDocumentAgent.validateInput(
      { store: {} as never, workspaceRoot: '/ws' },
      pasteInput,
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.anchor).toBeUndefined();
      expect(r.cwd).toBeUndefined();
    }
  });

  it('validateInput docs-dir: ディレクトリが存在し workspaceRoot 配下なら ok + cwd', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'tally-docs-dir-'));
    await fs.mkdir(path.join(root, 'docs'), { recursive: true });
    const r = await ingestDocumentAgent.validateInput(
      { store: {} as never, workspaceRoot: root },
      docsDirInput,
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.cwd).toBe(root);
    rmSync(root, { recursive: true, force: true });
  });

  it('validateInput docs-dir: 存在しないディレクトリは not_found', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'tally-docs-dir-'));
    const r = await ingestDocumentAgent.validateInput(
      { store: {} as never, workspaceRoot: root },
      { source: 'docs-dir', dirPath: 'missing' } as const,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('not_found');
    rmSync(root, { recursive: true, force: true });
  });

  it('validateInput docs-dir: workspaceRoot 外 (..) は bad_request', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'tally-docs-dir-'));
    const r = await ingestDocumentAgent.validateInput(
      { store: {} as never, workspaceRoot: root },
      { source: 'docs-dir', dirPath: '../escape' } as const,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('bad_request');
    rmSync(root, { recursive: true, force: true });
  });

  it('validateInput docs-dir: ファイルを指定したら bad_request', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'tally-docs-dir-'));
    await fs.writeFile(path.join(root, 'f.md'), 'x');
    const r = await ingestDocumentAgent.validateInput(
      { store: {} as never, workspaceRoot: root },
      { source: 'docs-dir', dirPath: 'f.md' } as const,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('bad_request');
    rmSync(root, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: RED 確認**

```bash
cd ~/dev/github.com/ignission/tally
NODE_ENV=development pnpm --filter @tally/ai-engine test -- ingest-document
```

Expected: 複数 FAIL (buildIngestDocumentPrompt のシグネチャ変更 / allowedTools の Read/Glob 追加 / validateInput の docs-dir 対応が全て無い)。

- [ ] **Step 3: ingest-document.ts を discriminated union に書き換える**

`packages/ai-engine/src/agents/ingest-document.ts` を以下に**全面置き換え**:

```typescript
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { z } from 'zod';

import type { AgentDefinition } from './registry';

export type IngestDocumentInput =
  | { source: 'paste'; text: string }
  | { source: 'docs-dir'; dirPath: string };

export interface IngestDocumentPromptInput {
  input: IngestDocumentInput;
}

// ingest-document のプロンプト。paste モードは Phase 5d と同じ。docs-dir モードは
// AI が指定ディレクトリ配下の *.md を Glob + Read で走査し req/UC を抽出する。
export function buildIngestDocumentPrompt(args: IngestDocumentPromptInput): {
  systemPrompt: string;
  userPrompt: string;
} {
  if (args.input.source === 'paste') {
    return buildPastePrompt(args.input.text);
  }
  return buildDocsDirPrompt(args.input.dirPath);
}

function buildPastePrompt(text: string): { systemPrompt: string; userPrompt: string } {
  const systemPrompt = [
    'あなたは Tally の要求書取り込みアシスタントです。',
    'ユーザーから提供された要求書テキストを読み、',
    'プロジェクト初期の骨格となる requirement と usecase を proposal として生成します。',
    '',
    '手順:',
    '1. 要求書テキストを最初から最後まで読み、全体像を把握する。',
    '2. 「何を達成したいか」(ビジネス目標・顧客要望) を 3〜8 個の requirement proposal として抽出する。',
    '3. 各要求を達成するためのユーザー操作・システム相互作用を 3〜15 個の usecase proposal として抽出する。',
    '4. requirement → usecase の関係を satisfy エッジで張る (1 つの UC は 1〜2 個の requirement を満たす想定)。',
    '5. 最後に「何を読み、何を抽出したか」を 3〜5 行で日本語要約する。',
    '',
    '出力規約:',
    '- create_node(adoptAs="requirement", title="[AI] <短い要求>", body="<要求の意図、背景>")',
    '  座標は指定不要 (サーバ側で自動配置)',
    '- create_node(adoptAs="usecase", title="[AI] <UC 名>", body="<UC のトリガ / 主な流れ / 終了条件>")',
    '- create_edge(type="satisfy", from=<requirement id>, to=<usecase id>)',
    '  (SysML 2.0 の satisfy: 上位要求を下位 UC が満たす。矢印は要求 → UC)',
    '',
    '個数目安:',
    '- requirement: 3〜8 件',
    '- usecase: 3〜15 件',
    '- 要求書の密度が低ければ少なめで可。無理に増やさない。',
    '',
    'ツール使用方針: mcp__tally__* のみ使用する (テキストは既に本メッセージに含まれているためファイル読み込みは不要)。',
  ].join('\n');

  const userPrompt = [
    '以下は要求書のテキストです。読み込んで requirement と usecase proposal を生成してください。',
    '',
    '---',
    text,
    '---',
  ].join('\n');

  return { systemPrompt, userPrompt };
}

function buildDocsDirPrompt(dirPath: string): { systemPrompt: string; userPrompt: string } {
  const systemPrompt = [
    'あなたは Tally の要求書取り込みアシスタント (ディレクトリ版) です。',
    '指定されたディレクトリ配下の Markdown ファイル群を読み、',
    'プロジェクトの骨格となる requirement と usecase を proposal として生成します。',
    '',
    '手順:',
    `1. Glob("${dirPath}/**/*.md") で Markdown を列挙する (10〜50 ファイル想定)。`,
    '2. 各ファイルを Read で読み、システム全体が実現している / 実現しようとしている機能を把握する。',
    '3. 「何を達成したいか」(ビジネス目標・顧客要望) を 5〜15 個の requirement proposal として抽出する。',
    '4. 各要求を達成する機能を 10〜30 個の usecase proposal として抽出する。',
    '5. requirement → usecase の関係を satisfy エッジで張る (1 つの UC は 1〜2 個の requirement を満たす想定)。',
    '6. 最後に「読んだファイル数」「抽出した req/UC 数」「大まかな領域分類」を 4〜6 行で日本語要約する。',
    '',
    '出力規約:',
    '- create_node(adoptAs="requirement", title="[AI] <短い要求>", body="<要求の意図、背景>")',
    '- create_node(adoptAs="usecase", title="[AI] <UC 名>", body="<UC のトリガ / 主な流れ / 終了条件>")',
    '- create_edge(type="satisfy", from=<requirement id>, to=<usecase id>)',
    '',
    '個数目安:',
    '- requirement: 5〜15 件 (上限)',
    '- usecase: 10〜30 件 (上限)',
    '- 情報が薄ければ少なくて構わない。',
    '',
    'ツール使用方針: Glob / Read / mcp__tally__* のみ使用。Bash / Edit / Write は使わない。',
    '- Markdown 以外のファイル (image / binary) は読まない。',
    `- ${dirPath} の外には Glob しない (指定ディレクトリに閉じる)。`,
  ].join('\n');

  const userPrompt = [
    '以下のディレクトリを走査し、requirement と usecase proposal を生成してください。',
    '',
    `対象ディレクトリ: ${dirPath} (workspaceRoot からの相対)`,
  ].join('\n');

  return { systemPrompt, userPrompt };
}

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

export const ingestDocumentAgent: AgentDefinition<IngestDocumentInput> = {
  name: 'ingest-document',
  inputSchema: IngestDocumentInputSchema,
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
  },
  buildPrompt: ({ input }) => {
    const typed = input as IngestDocumentInput;
    return buildIngestDocumentPrompt({ input: typed });
  },
  allowedTools: [
    'mcp__tally__create_node',
    'mcp__tally__create_edge',
    'mcp__tally__find_related',
    'mcp__tally__list_by_type',
    'Read',
    'Glob',
  ],
};
```

- [ ] **Step 4: GREEN 確認**

```bash
NODE_ENV=development pnpm --filter @tally/ai-engine test -- ingest-document
```

Expected: PASS (14〜16 tests)。

```bash
NODE_ENV=development pnpm --filter @tally/ai-engine test
NODE_ENV=development pnpm --filter @tally/ai-engine build
```

Expected: 全緑 (101 + 新規 7〜9 = 108〜110)。build PASS。

- [ ] **Step 5: コミット**

```bash
git add packages/ai-engine/src/agents/ingest-document.ts packages/ai-engine/src/agents/ingest-document.test.ts
git commit -m "feat(ai-engine): ingest-document に docs-dir 入力モードを追加"
```

---

## Task 2: frontend store の startIngestDocument シグネチャ変更

**Files:**
- Modify: `packages/frontend/src/lib/store.ts`
- Modify: `packages/frontend/src/lib/store.test.ts`

- [ ] **Step 1: 既存の startIngestDocument テストを新シグネチャに合わせる (RED)**

`packages/frontend/src/lib/store.test.ts` 内の `describe('startIngestDocument', ...)` ブロックを丸ごと以下に差し替える (イベント配列はそのまま、呼び出し引数のみ変更):

```typescript
  describe('startIngestDocument', () => {
    it('paste 入力で AgentEvent 列を反映する', async () => {
      const events = [
        { type: 'start', agent: 'ingest-document', input: { source: 'paste', text: '要求書' } },
        {
          type: 'node_created',
          node: {
            id: 'req-ai-1',
            type: 'proposal',
            adoptAs: 'requirement',
            x: 0,
            y: 0,
            title: '[AI] 招待',
            body: '',
            sourceAgentId: 'ingest-document',
          },
        },
        {
          type: 'node_created',
          node: {
            id: 'uc-ai-1',
            type: 'proposal',
            adoptAs: 'usecase',
            x: 280,
            y: 0,
            title: '[AI] 招待を送る',
            body: '',
            sourceAgentId: 'ingest-document',
          },
        },
        {
          type: 'edge_created',
          edge: { id: 'e-id-1', from: 'req-ai-1', to: 'uc-ai-1', type: 'satisfy' },
        },
        { type: 'result', subtype: 'success', result: 'ok' },
      ];
      vi.resetModules();
      vi.doMock('./ws', () => ({
        startAgent: (opts: { agent: string }) => ({
          events: (async function* () {
            for (const e of events) yield e;
          })(),
          close: () => {},
        }),
      }));
      const { useCanvasStore: store } = await import('./store');
      store.getState().hydrate({
        id: 'proj-1',
        name: 't',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        nodes: [],
        edges: [],
      });
      const result = await store
        .getState()
        .startIngestDocument({ source: 'paste', text: '要求書の本文' });
      expect(result.ok).toBe(true);
      const state = store.getState();
      expect(state.nodes['req-ai-1']).toBeDefined();
      expect(state.nodes['uc-ai-1']).toBeDefined();
      expect(state.edges['e-id-1']?.type).toBe('satisfy');
      expect(state.runningAgent).toBeNull();
    });

    it('docs-dir 入力で runningAgent.inputNodeId にパスを入れる', async () => {
      const events = [
        { type: 'start', agent: 'ingest-document', input: { source: 'docs-dir', dirPath: 'docs' } },
        { type: 'result', subtype: 'success', result: 'ok' },
      ];
      let captured: { agent: string; projectId: string; input: unknown } | null = null;
      vi.resetModules();
      vi.doMock('./ws', () => ({
        startAgent: (opts: { agent: string; projectId: string; input: unknown }) => {
          captured = { agent: opts.agent, projectId: opts.projectId, input: opts.input };
          return {
            events: (async function* () {
              for (const e of events) yield e;
            })(),
            close: () => {},
          };
        },
      }));
      const { useCanvasStore: store } = await import('./store');
      store.getState().hydrate({
        id: 'proj-2',
        name: 't',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        nodes: [],
        edges: [],
      });
      const result = await store
        .getState()
        .startIngestDocument({ source: 'docs-dir', dirPath: 'docs' });
      expect(result.ok).toBe(true);
      expect(captured).not.toBeNull();
      expect(captured?.input).toEqual({ source: 'docs-dir', dirPath: 'docs' });
    });
  });
```

- [ ] **Step 2: RED 確認**

```bash
NODE_ENV=development pnpm --filter @tally/frontend test -- store
```

Expected: FAIL (シグネチャ不一致)。

- [ ] **Step 3: store.ts の型とハンドラを変更**

`packages/frontend/src/lib/store.ts`:

1. 既存 `startIngestDocument` の型シグネチャを変更:

```typescript
export type IngestDocumentInput =
  | { source: 'paste'; text: string }
  | { source: 'docs-dir'; dirPath: string };

// CanvasState の定義内:
  startIngestDocument: (
    input: IngestDocumentInput,
  ) => Promise<{ ok: boolean; errorMessage?: string }>;
```

2. 実装も書き換え:

```typescript
    startIngestDocument: (input) => {
      const label =
        input.source === 'paste'
          ? input.text.length > 40
            ? `${input.text.slice(0, 40)}…`
            : input.text
          : `docs-dir:${input.dirPath}`;
      return runAgentWithInput('ingest-document', input, label);
    },
```

`IngestDocumentInput` 型は store.ts から export して dialog 側で import する。

- [ ] **Step 4: GREEN 確認**

```bash
NODE_ENV=development pnpm --filter @tally/frontend test -- store
```

Expected: PASS。

- [ ] **Step 5: コミット**

```bash
git add packages/frontend/src/lib/store.ts packages/frontend/src/lib/store.test.ts
git commit -m "feat(frontend): store.startIngestDocument を IngestDocumentInput 受けに変更"
```

---

## Task 3: IngestDocumentDialog にタブ切替え追加

**Files:**
- Modify: `packages/frontend/src/components/dialog/ingest-document-dialog.tsx`
- Modify: `packages/frontend/src/components/dialog/ingest-document-dialog.test.tsx`

- [ ] **Step 1: 既存テストを書き換え + docs-dir タブのテストを追加 (RED)**

`packages/frontend/src/components/dialog/ingest-document-dialog.test.tsx` を以下に**全面置き換え**:

```typescript
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useCanvasStore } from '@/lib/store';

import { IngestDocumentDialog } from './ingest-document-dialog';

describe('IngestDocumentDialog', () => {
  beforeEach(() => {
    useCanvasStore.getState().reset();
  });

  it('open=false なら何も描画しない', () => {
    const { container } = render(<IngestDocumentDialog open={false} onClose={() => {}} />);
    expect(container.textContent).toBe('');
  });

  it('open=true で 貼り付け / ディレクトリ タブ + 共通ボタンを表示', () => {
    render(<IngestDocumentDialog open={true} onClose={() => {}} />);
    expect(screen.getByRole('tab', { name: /貼り付け/ })).toBeDefined();
    expect(screen.getByRole('tab', { name: /ディレクトリ/ })).toBeDefined();
    expect(screen.getByRole('button', { name: /取り込む/ })).toBeDefined();
    expect(screen.getByRole('button', { name: /キャンセル/ })).toBeDefined();
  });

  it('貼り付けタブは初期選択、textarea が見える', () => {
    render(<IngestDocumentDialog open={true} onClose={() => {}} />);
    expect(screen.getByRole('textbox')).toBeDefined();
    // 貼り付け空なら disabled
    const btn = screen.getByRole('button', { name: /取り込む/ }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('貼り付けタブでテキスト入力 → startIngestDocument に paste input', () => {
    const spy = vi.fn().mockResolvedValue({ ok: true });
    useCanvasStore.setState({ startIngestDocument: spy } as never);
    render(<IngestDocumentDialog open={true} onClose={() => {}} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '本文' } });
    fireEvent.click(screen.getByRole('button', { name: /取り込む/ }));
    expect(spy).toHaveBeenCalledWith({ source: 'paste', text: '本文' });
  });

  it('ディレクトリタブに切替 → dirPath 入力欄 (デフォルト docs) + 取り込むで docs-dir input', () => {
    const spy = vi.fn().mockResolvedValue({ ok: true });
    useCanvasStore.setState({ startIngestDocument: spy } as never);
    render(<IngestDocumentDialog open={true} onClose={() => {}} />);
    fireEvent.click(screen.getByRole('tab', { name: /ディレクトリ/ }));
    const dirInput = screen.getByLabelText(/ディレクトリ/) as HTMLInputElement;
    expect(dirInput.value).toBe('docs');
    fireEvent.click(screen.getByRole('button', { name: /取り込む/ }));
    expect(spy).toHaveBeenCalledWith({ source: 'docs-dir', dirPath: 'docs' });
  });

  it('ディレクトリタブで dirPath 空なら disabled', () => {
    render(<IngestDocumentDialog open={true} onClose={() => {}} />);
    fireEvent.click(screen.getByRole('tab', { name: /ディレクトリ/ }));
    const dirInput = screen.getByLabelText(/ディレクトリ/) as HTMLInputElement;
    fireEvent.change(dirInput, { target: { value: '' } });
    const btn = screen.getByRole('button', { name: /取り込む/ }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('他エージェント実行中は全ボタン disabled', () => {
    useCanvasStore.setState({
      runningAgent: { agent: 'analyze-impact', inputNodeId: 'uc-1', events: [] },
    } as never);
    render(<IngestDocumentDialog open={true} onClose={() => {}} />);
    const ingest = screen.getByRole('button', { name: /取り込む/ }) as HTMLButtonElement;
    const cancel = screen.getByRole('button', { name: /キャンセル/ }) as HTMLButtonElement;
    expect(ingest.disabled).toBe(true);
    expect(cancel.disabled).toBe(true);
  });

  it('失敗時はテキスト保持 + エラー表示 + ダイアログ維持', async () => {
    const onClose = vi.fn();
    const start = vi
      .fn()
      .mockResolvedValue({ ok: false, errorMessage: 'not_authenticated' });
    useCanvasStore.setState({ startIngestDocument: start } as never);
    render(<IngestDocumentDialog open={true} onClose={onClose} />);
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: '要求書' } });
    fireEvent.click(screen.getByRole('button', { name: /取り込む/ }));
    await waitFor(() => {
      expect(screen.getByText(/not_authenticated/)).toBeDefined();
    });
    expect(textarea.value).toBe('要求書');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('キャンセルで onClose + start 呼ばれない', () => {
    const onClose = vi.fn();
    const start = vi.fn();
    useCanvasStore.setState({ startIngestDocument: start } as never);
    render(<IngestDocumentDialog open={true} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /キャンセル/ }));
    expect(onClose).toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: RED 確認**

```bash
NODE_ENV=development pnpm --filter @tally/frontend test -- ingest-document-dialog
```

Expected: FAIL (タブが存在しない)。

- [ ] **Step 3: IngestDocumentDialog を書き換える**

`packages/frontend/src/components/dialog/ingest-document-dialog.tsx`:

```typescript
'use client';

import { useState } from 'react';

import { type IngestDocumentInput, useCanvasStore } from '@/lib/store';

interface IngestDocumentDialogProps {
  open: boolean;
  onClose: () => void;
}

type Mode = 'paste' | 'docs-dir';

// 要求書を貼り付け or ディレクトリ指定で ingest-document を起動するダイアログ。
// 他エージェント実行中は全ボタン disabled (WS 二重起動防止)。
// 取り込み失敗時はテキスト/パスを保持し、ダイアログ維持 + エラー表示。
export function IngestDocumentDialog({ open, onClose }: IngestDocumentDialogProps) {
  const [mode, setMode] = useState<Mode>('paste');
  const [text, setText] = useState('');
  const [dirPath, setDirPath] = useState('docs');
  const [error, setError] = useState<string | null>(null);
  const startIngestDocument = useCanvasStore((s) => s.startIngestDocument);
  const runningAgent = useCanvasStore((s) => s.runningAgent);
  const anyBusy = runningAgent !== null;
  const mine = runningAgent?.agent === 'ingest-document';

  if (!open) return null;

  const disabledByEmpty =
    mode === 'paste' ? text.trim().length === 0 : dirPath.trim().length === 0;

  const onIngest = async () => {
    setError(null);
    const input: IngestDocumentInput =
      mode === 'paste' ? { source: 'paste', text } : { source: 'docs-dir', dirPath };
    const result = await startIngestDocument(input);
    if (result.ok) {
      if (mode === 'paste') setText('');
      onClose();
    } else {
      setError(result.errorMessage ?? '取り込みに失敗しました');
    }
  };

  const primaryLabel = mine ? '取り込み中…' : '取り込む';
  const primaryTooltip = anyBusy && !mine ? '別のエージェントが実行中です' : undefined;

  return (
    <div style={BACKDROP_STYLE}>
      <div style={DIALOG_STYLE}>
        <h2 style={TITLE_STYLE}>要求書から取り込む</h2>
        <p style={DESC_STYLE}>
          要求書を貼り付け、または workspaceRoot 配下のドキュメントディレクトリを指定してください。AI
          が requirement と usecase の proposal を生成します。
        </p>
        <div style={TABS_STYLE} role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'paste'}
            onClick={() => setMode('paste')}
            style={tabStyle(mode === 'paste')}
          >
            貼り付け
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'docs-dir'}
            onClick={() => setMode('docs-dir')}
            style={tabStyle(mode === 'docs-dir')}
          >
            ディレクトリ
          </button>
        </div>
        {mode === 'paste' ? (
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="要求書のテキストをここに貼り付け"
            rows={16}
            disabled={anyBusy}
            style={TEXTAREA_STYLE}
          />
        ) : (
          <label style={DIR_LABEL_STYLE}>
            ディレクトリパス (workspaceRoot 相対)
            <input
              type="text"
              value={dirPath}
              onChange={(e) => setDirPath(e.target.value)}
              placeholder="docs"
              disabled={anyBusy}
              style={DIR_INPUT_STYLE}
            />
          </label>
        )}
        {error && <div style={ERROR_STYLE}>エラー: {error}</div>}
        <div style={BUTTONS_STYLE}>
          <button type="button" onClick={onClose} disabled={anyBusy} style={CANCEL_BUTTON_STYLE}>
            キャンセル
          </button>
          <button
            type="button"
            onClick={() => {
              onIngest().catch((e) => setError(String(e)));
            }}
            disabled={anyBusy || disabledByEmpty}
            title={primaryTooltip}
            style={PRIMARY_BUTTON_STYLE}
          >
            {primaryLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

const BACKDROP_STYLE = {
  position: 'fixed' as const,
  inset: 0,
  background: 'rgba(0, 0, 0, 0.5)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 1000,
};

const DIALOG_STYLE = {
  background: '#161b22',
  border: '1px solid #30363d',
  borderRadius: 8,
  padding: 20,
  width: 600,
  maxWidth: '90vw',
  display: 'flex',
  flexDirection: 'column' as const,
  gap: 12,
};

const TITLE_STYLE = {
  margin: 0,
  fontSize: 16,
  color: '#e6edf3',
};

const DESC_STYLE = {
  margin: 0,
  fontSize: 12,
  color: '#8b949e',
  lineHeight: 1.5,
};

const TABS_STYLE = {
  display: 'flex',
  gap: 4,
  borderBottom: '1px solid #30363d',
};

function tabStyle(active: boolean) {
  return {
    background: active ? '#21262d' : 'transparent',
    color: active ? '#e6edf3' : '#8b949e',
    border: '1px solid',
    borderColor: active ? '#30363d' : 'transparent',
    borderBottom: 'none',
    borderRadius: '6px 6px 0 0',
    padding: '6px 12px',
    fontSize: 12,
    cursor: 'pointer',
  };
}

const TEXTAREA_STYLE = {
  background: '#0d1117',
  border: '1px solid #30363d',
  color: '#e6edf3',
  borderRadius: 6,
  padding: 8,
  fontSize: 12,
  fontFamily: 'ui-monospace, SFMono-Regular, monospace',
  resize: 'vertical' as const,
};

const DIR_LABEL_STYLE = {
  display: 'flex',
  flexDirection: 'column' as const,
  gap: 4,
  fontSize: 12,
  color: '#8b949e',
};

const DIR_INPUT_STYLE = {
  background: '#0d1117',
  border: '1px solid #30363d',
  color: '#e6edf3',
  borderRadius: 6,
  padding: '6px 8px',
  fontSize: 12,
  fontFamily: 'ui-monospace, SFMono-Regular, monospace',
};

const BUTTONS_STYLE = {
  display: 'flex',
  justifyContent: 'flex-end',
  gap: 8,
};

const ERROR_STYLE = {
  color: '#f85149',
  fontSize: 12,
  padding: '6px 8px',
  border: '1px solid #6e2130',
  borderRadius: 6,
  background: '#2b1419',
  whiteSpace: 'pre-wrap' as const,
  wordBreak: 'break-word' as const,
};

const CANCEL_BUTTON_STYLE = {
  background: '#21262d',
  color: '#e6edf3',
  border: '1px solid #30363d',
  borderRadius: 6,
  padding: '6px 12px',
  fontSize: 12,
  cursor: 'pointer',
};

const PRIMARY_BUTTON_STYLE = {
  background: '#238636',
  color: '#fff',
  border: '1px solid #2ea043',
  borderRadius: 6,
  padding: '6px 12px',
  fontSize: 12,
  cursor: 'pointer',
};
```

- [ ] **Step 4: GREEN 確認**

```bash
NODE_ENV=development pnpm --filter @tally/frontend test -- ingest-document-dialog
```

Expected: PASS (9 tests)。

```bash
NODE_ENV=development pnpm --filter @tally/frontend test
NODE_ENV=development pnpm -r typecheck
```

Expected: frontend 全緑 (91 → +2〜3)、typecheck 緑。

- [ ] **Step 5: コミット**

```bash
git add packages/frontend/src/components/dialog/ingest-document-dialog.tsx packages/frontend/src/components/dialog/ingest-document-dialog.test.tsx
git commit -m "feat(frontend): IngestDocumentDialog に貼り付け/ディレクトリのタブ切替を追加"
```

---

## Task 4: docs 更新 + 手動 E2E + 最終全緑

**Files:**
- Modify: `docs/04-roadmap.md`
- Create: `docs/phase-5e-manual-e2e.md`
- Create: `docs/phase-5e-progress.md`

- [ ] **Step 1: 04-roadmap.md 更新**

`docs/04-roadmap.md` の Phase 5d の直下に:

```markdown
### Phase 5e (完了)

- [x] `ingest-document` にディレクトリ入力を追加 (docs-dir モード): workspaceRoot 配下の Markdown 群を AI が Glob + Read で読み requirement + usecase を生成

手動 E2E 手順は `docs/phase-5e-manual-e2e.md` 参照。
```

- [ ] **Step 2: phase-5e-manual-e2e.md 新規**

```markdown
# Phase 5e 手動 E2E 手順: ingest-document (docs-dir モード)

Phase 5e で追加した docs-dir 入力の実通信確認。`.tally/` と `docs/` を持つ実リポジトリで試す。

## 前提

- `claude login` 済み
- `NODE_ENV=development pnpm -r test` 全緑
- 検証対象リポジトリ: `~/dev/github.com/your-org/your-repo` など、`.tally/` + `docs/` 配下に Markdown がある構成
- `.env` で `TALLY_WORKSPACE` が対象リポジトリの親ディレクトリ (例: `~/dev/github.com/your-org`)
- `pnpm --filter @tally/ai-engine dev` + `pnpm --filter @tally/frontend dev` 起動済み

## シナリオ 1: 貼り付けモード (Phase 5d 互換)

1. 対象プロジェクトを開く (空キャンバス or 既存)
2. ヘッダー「要求書から取り込む」→ ダイアログ
3. デフォルトで「貼り付け」タブが開いている
4. 短い要求書を貼り付けて「取り込む」→ Phase 5d と同じ挙動

## シナリオ 2: ディレクトリモード (5e 新機能)

1. ダイアログを開く → タブ「ディレクトリ」に切替え
2. dirPath デフォルト `docs` のまま「取り込む」 (対象リポジトリの docs/ を対象)
3. 進捗パネルに Glob → 複数 Read (docs/**/*.md を順に) → tool_use (create_node × N, create_edge × M) が流れる
4. ダイアログ自動クローズ、キャンバスに紫の破線 proposal 群が生える
   - requirement: 5〜15 個
   - usecase: 10〜30 個
   - satisfy エッジで互いに繋がる
5. 複数の proposal を採用 → 正規ノード化
6. 採用した UC で「関連コードを探す」→ backend/frontend の実装コードへ紐付け
7. 全体として「対象リポジトリの機能マップ」がキャンバスに展開される

## シナリオ 3: バリデーション

1. タブ「ディレクトリ」で dirPath 空 → 「取り込む」disabled
2. dirPath に `../escape` → 実行すると error: `dirPath が workspaceRoot 配下ではない`
3. dirPath に `missing-dir` → error: `dirPath が存在しない`
4. dirPath にファイルパス (例: `README.md`) → error: `dirPath がディレクトリではない`
5. 他エージェント実行中は全ボタン disabled + tooltip「別のエージェントが実行中です」

## 失敗時のトラブルシュート

- Glob が空: AI が Glob パターンを誤解している可能性。進捗パネルの tool_use.input を確認
- proposal が全然生えない: Markdown が極端に少ない or docs/ の構造が想定外
- 「not_authenticated」: `claude login` 再実行
- 「dirPath が workspaceRoot 配下ではない」: `TALLY_WORKSPACE` の設定を確認
```

- [ ] **Step 3: phase-5e-progress.md 新規**

```markdown
# Phase 5e 実装進捗

**本ドキュメントは Claude Code のメモリ代替**。

関連: [`specs/2026-04-20-phase5e-ingest-docs-dir-design.md`](superpowers/specs/2026-04-20-phase5e-ingest-docs-dir-design.md) / [`plans/2026-04-20-phase5e-ingest-docs-dir.md`](superpowers/plans/2026-04-20-phase5e-ingest-docs-dir.md)

## 全体状況

| Phase | 状態 |
|---|---|
| 0-5d | 完了 |
| **5e** | **完了 (ingest-document docs-dir モード追加)** |
| 5f+ | 未着手 |

## タスク進捗

| # | タスク | 状態 | commit |
|---|---|---|---|
| 1 | ai-engine: ingest-document に discriminated input + docs-dir 対応 | ✅ | (実装時記入) |
| 2 | frontend: store.startIngestDocument を IngestDocumentInput 受けに | ✅ | (実装時記入) |
| 3 | frontend: IngestDocumentDialog にタブ切替追加 | ✅ | (実装時記入) |
| 4 | docs: 04-roadmap + phase-5e-manual-e2e + 本ファイル + 最終全緑 | ✅ | (実装時記入) |

## テスト本数

- Phase 5d 完了時: 276 (core 38 / storage 46 / ai-engine 101 / frontend 91)
- Phase 5e 完了時: **目安 286〜290** (+10〜14)

## follow-up (Phase 5f+)

- `summarize-codebase` エージェント (コード直読みで req/UC 逆生成)
- as-is / to-be 区別の schema 化
- 再 ingest 時の重複ガード (docs 差分検出)
- doc → node の trace エッジ (出典 metadata 保持)
- 階層表示 / キャンバス認知負荷対策
- 任意ファイル拡張子 (`.adoc` / `.rst`) への対応
- 大規模 docs の分割 ingest (100+ files)

## 実装ルール (Phase 5d と同じ)

1. TDD: failing test → RED → 実装 → GREEN → commit
2. Conventional Commits 日本語件名、scope は `ai-engine|frontend|docs`
3. **Co-Authored-By / Generated with Claude Code フッタ絶対に付けない**
4. `NODE_ENV=development` で test / build / typecheck
5. ADR-0007 準拠: allowedTools は「使う MCP + built-in を全列挙」、agent-runner が自動で SDK に渡す

## 設計の非自明ポイント

- **discriminated union 入力**: `source` 判別子で分岐。zod が AI / UI 両側で安全に扱える
- **workspaceRoot 配下制約**: `path.relative(workspaceRoot, resolved).startsWith('..')` で検証、絶対パスも拒否
- **cwd は workspaceRoot**: docs-dir モードでは AI が Glob/Read するため cwd 必須。validateInput で返す
- **paste モードは cwd 無し**: 貼り付けならファイル読まないので cwd 不要、互換性維持
- **allowedTools に Read/Glob を常時追加**: paste モードでも付与されるが、プロンプトが file 参照しないので AI は呼ばない想定。ADR-0007 準拠
```

- [ ] **Step 4: 全パッケージ最終確認**

```bash
NODE_ENV=development pnpm -r test 2>&1 | grep -E 'Tests.*passed'
NODE_ENV=development pnpm -r typecheck
```

Expected: 全緑 (合計 ≈ 286〜290 本)。

- [ ] **Step 5: phase-5e-progress.md の commit 欄を実 SHA で更新 + コミット**

```bash
# commit SHA を埋めてから
git add docs/04-roadmap.md docs/phase-5e-manual-e2e.md docs/phase-5e-progress.md
git commit -m "docs: Phase 5e 完了マーク + 手動 E2E 手順書追加"
```

---

## 完了条件

- Task 1〜4 全て完了 commit
- `pnpm -r test` / `pnpm -r typecheck` 全緑
- 実リポジトリで docs-dir モードを手動 E2E 実行して req/UC が生成される

## Self-Review

**Spec coverage:**
- spec § 1.1 (discriminatedUnion): Task 1 ✓
- spec § 1.2 (validateInput): Task 1 ✓
- spec § 1.3 (buildPrompt 分岐): Task 1 ✓
- spec § 1.4 (allowedTools): Task 1 ✓
- spec § 2.1 (Dialog タブ): Task 3 ✓
- spec § 2.2 (store シグネチャ): Task 2 ✓
- spec § 3.1 (テスト): Task 1-3 でカバー
- spec § 3.2 (E2E): Task 4 ✓

**Placeholder scan:** なし。

**Type consistency:** `IngestDocumentInput` 型は ai-engine と frontend 両方で同じ shape (store 側から re-export)。
