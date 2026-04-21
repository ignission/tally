# Phase 5d: ingest-document 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 貼り付けた要求書テキストから `requirement` / `usecase` proposal + `satisfy` エッジを AI に生成させる `ingest-document` エージェントと、ヘッダーボタン → ダイアログの UI を投入する。

**Architecture:** anchor 無しエージェントの基盤を core (`AgentValidateOk.anchor` optional + `AgentPromptInput.input` を追加) で作り、agent-runner を anchor なしで動くように分岐。create_node は既存実装のまま (question 以外は anchorId を使わない)。frontend は既存 `runAgentWS(agent, nodeId)` を壊さず、新ヘルパ `runAgentWithInput(agent, input, displayLabel)` を並設。UI は ProjectHeaderActions に 1 ボタン + IngestDocumentDialog (textarea のみ)。

**Tech Stack:** TypeScript, Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`), Next.js 15, Zustand, Zod, Vitest, Testing Library.

---

## 前提: 関連 spec と参照

- spec: `docs/superpowers/specs/2026-04-20-phase5d-ingest-document-design.md`
- 直系前例: `docs/superpowers/plans/2026-04-20-phase5c-extract-questions.md` (agent 追加パターン), `packages/frontend/src/components/dialog/project-settings-dialog.tsx` (ダイアログ UI)
- ADR: `docs/adr/0005-proposal-adoption.md`, `docs/adr/0007-agent-tool-restriction.md`

## ファイル構造

### core
- **変更** `packages/core/src/types.ts` — `AGENT_NAMES` に `'ingest-document'`

### ai-engine
- **変更** `packages/ai-engine/src/agents/registry.ts` — `AgentValidateOk.anchor` / `AgentPromptInput.anchor` を optional + `AgentPromptInput.input?: unknown` 追加 + `ingest-document` 登録
- **変更** `packages/ai-engine/src/agents/registry.test.ts` — 登録確認
- **新規** `packages/ai-engine/src/agents/ingest-document.ts` — プロンプト + 定義
- **新規** `packages/ai-engine/src/agents/ingest-document.test.ts`
- **変更** `packages/ai-engine/src/agent-runner.ts` — anchor 無しで `buildTallyMcpServer` を呼ぶ + `buildPrompt({ anchor, cwd, input })`
- **変更** `packages/ai-engine/src/agent-runner.test.ts` — ingest-document happy-path

### frontend
- **変更** `packages/frontend/src/lib/store.ts` — `runAgentWithInput` 並設 + `startIngestDocument`
- **変更** `packages/frontend/src/lib/store.test.ts`
- **新規** `packages/frontend/src/components/dialog/ingest-document-dialog.tsx`
- **新規** `packages/frontend/src/components/dialog/ingest-document-dialog.test.tsx`
- **変更** `packages/frontend/src/components/header/project-header-actions.tsx` — 「要求書から取り込む」ボタン

### docs
- **変更** `docs/04-roadmap.md` — Phase 5d 完了マーク + Phase 5 完了条件
- **新規** `docs/phase-5d-manual-e2e.md`
- **新規** `docs/phase-5d-progress.md`

---

## Task 1: core の AGENT_NAMES 拡張

**Files:**
- Modify: `packages/core/src/types.ts`

- [ ] **Step 1: AGENT_NAMES に追加**

`packages/core/src/types.ts`:

```typescript
export const AGENT_NAMES = [
  'decompose-to-stories',
  'find-related-code',
  'analyze-impact',
  'extract-questions',
  'ingest-document',
] as const;
```

- [ ] **Step 2: core test 全緑確認**

```bash
cd ~/dev/github.com/ignission/tally
NODE_ENV=development pnpm --filter @tally/core test
```

Expected: 全緑 (38)。

本タスク完了後は `packages/ai-engine` build が `AGENT_REGISTRY satisfies Record<AgentName, AgentDefinition>` で TS エラーになる。Task 3 の registry 登録で解消。test は通る。

- [ ] **Step 3: コミット**

```bash
git add packages/core/src/types.ts
git commit -m "feat(core): AGENT_NAMES に ingest-document を追加"
```

---

## Task 2: registry の型拡張 + ingest-document エージェント (未登録)

**Files:**
- Modify: `packages/ai-engine/src/agents/registry.ts` (型のみ、登録は Task 3)
- Create: `packages/ai-engine/src/agents/ingest-document.ts`
- Create: `packages/ai-engine/src/agents/ingest-document.test.ts`

- [ ] **Step 1: registry.ts の型を optional / input 対応に拡張**

`packages/ai-engine/src/agents/registry.ts` の interface 部分を以下に書き換え (具体的には anchor を `?` にし、AgentPromptInput に `input?` を追加):

```typescript
export interface AgentValidateOk {
  ok: true;
  anchor?: Node;  // anchor 無しエージェント (ingest-document) は undefined を返す
  cwd?: string;
}
// AgentValidateError は既存のまま
export type AgentValidateResult = AgentValidateOk | AgentValidateError;

export interface AgentPromptInput {
  anchor?: Node;
  cwd?: string;
  input?: unknown;  // agent 固有入力 (ingest-document の text など)
}
```

既存 4 エージェントの validateInput / buildPrompt シグネチャは影響を受けない (anchor を返し続ける)。buildPrompt が anchor を参照している箇所は `args.anchor!` としてnon-null assertion するか、型ガードする。現状の各 buildPrompt 内で anchor 前提の実装は維持可能 (`buildPrompt: ({ anchor }) => {...}` で destructure → 必須扱いで OK、anchor は undefined になりうるが、そのエージェントに対しては validateInput が必ず anchor を返すので実質保証される)。

**型チェック対応**: buildPrompt 内で anchor を使う既存コードがあれば `if (!anchor) throw new Error('anchor required')` のようなガードを追加するか、`!` non-null assertion。本タスクでは**既存コードを触らない** (型が optional になっただけで実コードは変わらない想定)。

- [ ] **Step 2: ai-engine test と build を確認**

```bash
NODE_ENV=development pnpm --filter @tally/ai-engine test
```

Expected: 既存 93 本全緑。

```bash
NODE_ENV=development pnpm --filter @tally/ai-engine build
```

Expected: **エラーあり** (`AGENT_REGISTRY` に `ingest-document` 未登録のため)。これは Task 3 完了で解消される想定 = 現段階では build 失敗は許容。

- [ ] **Step 3: ingest-document.test.ts を新規作成 (failing)**

`packages/ai-engine/src/agents/ingest-document.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';

import { buildIngestDocumentPrompt, ingestDocumentAgent } from './ingest-document';

describe('buildIngestDocumentPrompt', () => {
  const text = '招待機能を追加する。メンバーがメールで招待を送る。';

  it('役割と出力規約を含む system prompt を返す', () => {
    const { systemPrompt } = buildIngestDocumentPrompt({ text });
    expect(systemPrompt).toContain('要求書取り込みアシスタント');
    expect(systemPrompt).toContain('requirement');
    expect(systemPrompt).toContain('usecase');
    expect(systemPrompt).toContain('satisfy');
    expect(systemPrompt).toContain('adoptAs="requirement"');
    expect(systemPrompt).toContain('adoptAs="usecase"');
  });

  it('user prompt に元テキストが埋め込まれる', () => {
    const { userPrompt } = buildIngestDocumentPrompt({ text });
    expect(userPrompt).toContain('招待機能を追加する');
  });

  it('コード探索系の用語を含まない (Glob/Grep/Read は無し)', () => {
    const { systemPrompt } = buildIngestDocumentPrompt({ text });
    expect(systemPrompt).not.toMatch(/Glob/);
    expect(systemPrompt).not.toMatch(/Grep/);
  });
});

describe('ingestDocumentAgent', () => {
  it('名前と allowedTools が仕様通り', () => {
    expect(ingestDocumentAgent.name).toBe('ingest-document');
    expect(ingestDocumentAgent.allowedTools).toEqual([
      'mcp__tally__create_node',
      'mcp__tally__create_edge',
      'mcp__tally__find_related',
      'mcp__tally__list_by_type',
    ]);
    for (const t of ingestDocumentAgent.allowedTools) {
      expect(t.startsWith('mcp__')).toBe(true);
    }
  });

  it('inputSchema は text: string を要求する (1..50000)', () => {
    expect(ingestDocumentAgent.inputSchema.safeParse({ text: 'a' }).success).toBe(true);
    expect(ingestDocumentAgent.inputSchema.safeParse({ text: '' }).success).toBe(false);
    expect(ingestDocumentAgent.inputSchema.safeParse({}).success).toBe(false);
    expect(ingestDocumentAgent.inputSchema.safeParse({ text: 'x'.repeat(50_001) }).success).toBe(
      false,
    );
  });

  it('validateInput は anchor を返さず ok: true', async () => {
    const r = await ingestDocumentAgent.validateInput(
      { store: {} as never, workspaceRoot: '/ws' },
      { text: 'hi' },
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.anchor).toBeUndefined();
  });
});
```

- [ ] **Step 4: テストを実行して失敗確認**

```bash
NODE_ENV=development pnpm --filter @tally/ai-engine test -- ingest-document
```

Expected: FAIL (module not found)。

- [ ] **Step 5: ingest-document.ts を新規作成**

`packages/ai-engine/src/agents/ingest-document.ts`:

```typescript
import { z } from 'zod';

import type { AgentDefinition } from './registry';

export interface IngestDocumentPromptInput {
  text: string;
}

// ingest-document のプロンプト。要求書テキストから requirement + usecase proposal +
// satisfy エッジを生成する。anchor は不要 (空キャンバスの出発点として使う)。
export function buildIngestDocumentPrompt(input: IngestDocumentPromptInput): {
  systemPrompt: string;
  userPrompt: string;
} {
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
    'ツール使用方針: mcp__tally__* のみ使用 (コード探索系は付与されていない)。',
  ].join('\n');

  const userPrompt = [
    '以下は要求書のテキストです。読み込んで requirement と usecase proposal を生成してください。',
    '',
    '---',
    input.text,
    '---',
  ].join('\n');

  return { systemPrompt, userPrompt };
}

const IngestDocumentInputSchema = z.object({
  text: z.string().min(1).max(50_000),
});
type IngestDocumentInput = z.infer<typeof IngestDocumentInputSchema>;

export const ingestDocumentAgent: AgentDefinition<IngestDocumentInput> = {
  name: 'ingest-document',
  inputSchema: IngestDocumentInputSchema,
  async validateInput() {
    return { ok: true };
  },
  buildPrompt: ({ input }) => {
    const typed = input as IngestDocumentInput;
    return buildIngestDocumentPrompt({ text: typed.text });
  },
  allowedTools: [
    'mcp__tally__create_node',
    'mcp__tally__create_edge',
    'mcp__tally__find_related',
    'mcp__tally__list_by_type',
  ],
};
```

- [ ] **Step 6: テスト再実行で GREEN**

```bash
NODE_ENV=development pnpm --filter @tally/ai-engine test -- ingest-document
```

Expected: PASS (追加 7 本)。

- [ ] **Step 7: コミット**

```bash
git add packages/ai-engine/src/agents/registry.ts packages/ai-engine/src/agents/ingest-document.ts packages/ai-engine/src/agents/ingest-document.test.ts
git commit -m "feat(ai-engine): ingest-document エージェント (プロンプト + 定義) + anchor optional 基盤"
```

---

## Task 3: registry 登録 + agent-runner の anchor 無し分岐 + input 伝搬

**Files:**
- Modify: `packages/ai-engine/src/agents/registry.ts` (登録追加)
- Modify: `packages/ai-engine/src/agents/registry.test.ts`
- Modify: `packages/ai-engine/src/agent-runner.ts`
- Modify: `packages/ai-engine/src/agent-runner.test.ts`

- [ ] **Step 1: registry.ts に ingest-document 登録**

```typescript
import { ingestDocumentAgent } from './ingest-document';
// ...
export const AGENT_REGISTRY = {
  'decompose-to-stories': decomposeToStoriesAgent,
  'find-related-code': findRelatedCodeAgent,
  'analyze-impact': analyzeImpactAgent,
  'extract-questions': extractQuestionsAgent,
  'ingest-document': ingestDocumentAgent,
} satisfies Record<AgentName, AgentDefinition>;
```

- [ ] **Step 2: registry.test.ts に確認追加**

既存パターンに従って:

```typescript
  it('ingest-document が登録されている', () => {
    expect(AGENT_REGISTRY['ingest-document'].name).toBe('ingest-document');
    expect(AGENT_REGISTRY['ingest-document'].allowedTools).toContain('mcp__tally__create_node');
  });
```

- [ ] **Step 3: agent-runner.ts を anchor 無しに対応**

`packages/ai-engine/src/agent-runner.ts`:

1. anchor 取得後の buildTallyMcpServer 呼び出しを以下に差し替え:

```typescript
  const anchor = vr.anchor;
  const cwd = vr.cwd;

  const sideEvents: AgentEvent[] = [];
  const mcp = buildTallyMcpServer({
    store,
    emit: (e) => sideEvents.push(e),
    anchor: anchor ? { x: anchor.x, y: anchor.y } : { x: 0, y: 0 },
    anchorId: anchor?.id ?? '',
    agentName: req.agent,
  });

  const prompt = def.buildPrompt({
    ...(anchor !== undefined ? { anchor } : {}),
    ...(cwd !== undefined ? { cwd } : {}),
    input: parsed.data,
  });
```

- [ ] **Step 4: ai-engine build と test を確認**

```bash
NODE_ENV=development pnpm --filter @tally/ai-engine build
NODE_ENV=development pnpm --filter @tally/ai-engine test -- registry
```

Expected: build PASS + registry tests PASS。

- [ ] **Step 5: agent-runner.test.ts に ingest-document happy-path 追加**

既存の extract-questions happy-path テストの直後に追加:

```typescript
  it('ingest-document: anchor 無しで起動し、tool_use を素通しする', async () => {
    const store = {
      getNode: vi.fn(),
      getProjectMeta: vi.fn(),
      addNode: vi.fn(),
      listNodes: vi.fn().mockResolvedValue([]),
      findRelatedNodes: vi.fn().mockResolvedValue([]),
      addEdge: vi.fn(),
    } as unknown as ProjectStore;

    const sdk: SdkLike = {
      query: () =>
        (async function* () {
          yield {
            type: 'assistant',
            message: {
              content: [
                {
                  type: 'tool_use',
                  id: 'tool-1',
                  name: 'mcp__tally__create_node',
                  input: {
                    adoptAs: 'requirement',
                    title: '招待機能',
                    body: 'メンバーが招待を送れる',
                  },
                },
              ],
            },
          } as unknown as SdkMessageLike;
        })(),
    };

    const events: AgentEvent[] = [];
    for await (const e of runAgent({
      sdk,
      store,
      workspaceRoot: '/ws',
      req: {
        type: 'start',
        agent: 'ingest-document',
        projectId: 'p',
        input: { text: '招待機能を追加する。' },
      },
    })) {
      events.push(e);
    }

    expect(events[0]).toEqual({
      type: 'start',
      agent: 'ingest-document',
      input: { text: '招待機能を追加する。' },
    });
    expect(events.some((e) => e.type === 'error')).toBe(false);
    const toolUseEvents = events.filter((e) => e.type === 'tool_use');
    expect(toolUseEvents.length).toBeGreaterThan(0);
    // anchor 無しなので store.getNode / getProjectMeta は呼ばれない
    expect(store.getNode).not.toHaveBeenCalled();
    expect(store.getProjectMeta).not.toHaveBeenCalled();
  });
```

- [ ] **Step 6: ai-engine test 全緑確認**

```bash
NODE_ENV=development pnpm --filter @tally/ai-engine test
```

Expected: 全緑 (93 + 1 registry + 1 agent-runner = 95)。

- [ ] **Step 7: コミット**

```bash
git add packages/ai-engine/src/agents/registry.ts packages/ai-engine/src/agents/registry.test.ts packages/ai-engine/src/agent-runner.ts packages/ai-engine/src/agent-runner.test.ts
git commit -m "feat(ai-engine): ingest-document を registry 登録 + agent-runner を anchor 無しに対応"
```

---

## Task 4: frontend store に runAgentWithInput + startIngestDocument

**Files:**
- Modify: `packages/frontend/src/lib/store.ts`
- Modify: `packages/frontend/src/lib/store.test.ts`

- [ ] **Step 1: store.test.ts に startIngestDocument の RED テスト追加**

`packages/frontend/src/lib/store.test.ts` の末尾 describe 内に追加 (startExtractQuestions の直後):

```typescript
  describe('startIngestDocument', () => {
    it('ingest-document の AgentEvent 列で requirement + usecase proposal + satisfy エッジを反映する', async () => {
      const events = [
        { type: 'start', agent: 'ingest-document', input: { text: '要求書' } },
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
      await store.getState().startIngestDocument('要求書の本文');
      const state = store.getState();
      expect(state.nodes['req-ai-1']).toBeDefined();
      expect(state.nodes['uc-ai-1']).toBeDefined();
      expect(state.edges['e-id-1']?.type).toBe('satisfy');
      expect(state.runningAgent).toBeNull();
    });
  });
```

- [ ] **Step 2: RED 確認**

```bash
NODE_ENV=development pnpm --filter @tally/frontend test -- store
```

Expected: FAIL (`startIngestDocument is not a function`)。

- [ ] **Step 3: store.ts に `runAgentWithInput` 並設 + `startIngestDocument` 追加**

`packages/frontend/src/lib/store.ts`:

1. `CanvasState` interface に追加:

```typescript
  startIngestDocument: (text: string) => Promise<void>;
```

2. `runAgentWS` の直下に以下を追加 (共通経路のバリアントとして):

```typescript
  // 任意 input を送るバリアント。nodeId ではない agent (ingest-document) で使う。
  // 既存 runAgentWS は壊さない。
  async function runAgentWithInput(
    agent: AgentName,
    input: unknown,
    displayInputLabel: string,
  ): Promise<void> {
    const pid = get().projectId;
    if (!pid) throw new Error('projectId is not set');
    set({ runningAgent: { agent, inputNodeId: displayInputLabel, events: [] } });
    try {
      const session = startAgent({ type: 'start', agent, projectId: pid, input });
      try {
        for await (const ev of session.events) {
          // 既存 runAgentWS と同じ AgentEvent 処理を流用する。
          const cur = get().runningAgent;
          if (cur) set({ runningAgent: { ...cur, events: [...cur.events, ev] } });
          if (ev.type === 'node_created') {
            set((s) => ({ nodes: { ...s.nodes, [ev.node.id]: ev.node } }));
          } else if (ev.type === 'edge_created') {
            set((s) => ({ edges: { ...s.edges, [ev.edge.id]: ev.edge } }));
          }
        }
      } finally {
        session.close();
      }
    } finally {
      set({ runningAgent: null });
    }
  }
```

> **注**: 上記はおおよその概形。既存 `runAgentWS` の実装をそのままコピーして `nodeId` 引数を `input` + `displayInputLabel` に差し替える。重複コードが出るが follow-up PR で統合する方針 (spec の notes 参照)。

3. 返す state オブジェクトに `startIngestDocument` 追加:

```typescript
    startIngestDocument: (text) => {
      const label = text.length > 40 ? `${text.slice(0, 40)}…` : text;
      return runAgentWithInput('ingest-document', { text }, label);
    },
```

- [ ] **Step 4: GREEN 確認**

```bash
NODE_ENV=development pnpm --filter @tally/frontend test -- store
```

Expected: PASS (store test +1)。

- [ ] **Step 5: コミット**

```bash
git add packages/frontend/src/lib/store.ts packages/frontend/src/lib/store.test.ts
git commit -m "feat(frontend): store に startIngestDocument (runAgentWithInput 並設) を追加"
```

---

## Task 5: IngestDocumentDialog

**Files:**
- Create: `packages/frontend/src/components/dialog/ingest-document-dialog.tsx`
- Create: `packages/frontend/src/components/dialog/ingest-document-dialog.test.tsx`

- [ ] **Step 1: ダイアログ test の RED テスト作成**

`packages/frontend/src/components/dialog/ingest-document-dialog.test.tsx`:

```typescript
import { fireEvent, render, screen } from '@testing-library/react';
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

  it('open=true で textarea と「取り込む」「キャンセル」ボタンを表示', () => {
    render(<IngestDocumentDialog open={true} onClose={() => {}} />);
    expect(screen.getByRole('textbox')).toBeDefined();
    expect(screen.getByRole('button', { name: /取り込む/ })).toBeDefined();
    expect(screen.getByRole('button', { name: /キャンセル/ })).toBeDefined();
  });

  it('textarea が空なら「取り込む」は disabled', () => {
    render(<IngestDocumentDialog open={true} onClose={() => {}} />);
    const btn = screen.getByRole('button', { name: /取り込む/ }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('テキストを入力して「取り込む」クリックで startIngestDocument を呼ぶ', () => {
    const spy = vi.fn().mockResolvedValue(undefined);
    useCanvasStore.setState({ startIngestDocument: spy } as never);
    render(<IngestDocumentDialog open={true} onClose={() => {}} />);
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: '招待機能の要求書' } });
    fireEvent.click(screen.getByRole('button', { name: /取り込む/ }));
    expect(spy).toHaveBeenCalledWith('招待機能の要求書');
  });

  it('キャンセルで onClose が呼ばれ startIngestDocument は呼ばれない', () => {
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

Expected: FAIL (module not found)。

- [ ] **Step 3: IngestDocumentDialog を新規作成**

`packages/frontend/src/components/dialog/ingest-document-dialog.tsx`:

```typescript
'use client';

import { useState } from 'react';

import { useCanvasStore } from '@/lib/store';

interface IngestDocumentDialogProps {
  open: boolean;
  onClose: () => void;
}

// 要求書テキストを貼り付けて ingest-document エージェントを起動するダイアログ。
// codebasePath と違い textarea のみの最小 UI。実行中はテキスト編集不可 + ボタン文言切替。
// 完了 (runningAgent=null) で自動 onClose。
export function IngestDocumentDialog({ open, onClose }: IngestDocumentDialogProps) {
  const [text, setText] = useState('');
  const startIngestDocument = useCanvasStore((s) => s.startIngestDocument);
  const runningAgent = useCanvasStore((s) => s.runningAgent);
  const busy = runningAgent?.agent === 'ingest-document';

  if (!open) return null;

  const onIngest = async () => {
    await startIngestDocument(text);
    setText('');
    onClose();
  };

  return (
    <div style={BACKDROP_STYLE}>
      <div style={DIALOG_STYLE}>
        <h2 style={TITLE_STYLE}>要求書から取り込む</h2>
        <p style={DESC_STYLE}>
          要求書 (メール / 仕様メモ / 会話のまとめ等) を貼り付けてください。AI が requirement と
          usecase の proposal を生成します。
        </p>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="要求書のテキストをここに貼り付け"
          rows={16}
          disabled={busy}
          style={TEXTAREA_STYLE}
        />
        <div style={BUTTONS_STYLE}>
          <button type="button" onClick={onClose} disabled={busy} style={CANCEL_BUTTON_STYLE}>
            キャンセル
          </button>
          <button
            type="button"
            onClick={() => {
              onIngest().catch(console.error);
            }}
            disabled={busy || text.trim().length === 0}
            style={PRIMARY_BUTTON_STYLE}
          >
            {busy ? '取り込み中…' : '取り込む'}
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

const BUTTONS_STYLE = {
  display: 'flex',
  justifyContent: 'flex-end',
  gap: 8,
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

Expected: PASS (追加 5 本)。

- [ ] **Step 5: コミット**

```bash
git add packages/frontend/src/components/dialog/ingest-document-dialog.tsx packages/frontend/src/components/dialog/ingest-document-dialog.test.tsx
git commit -m "feat(frontend): IngestDocumentDialog を追加"
```

---

## Task 6: ProjectHeaderActions にボタン配置

**Files:**
- Modify: `packages/frontend/src/components/header/project-header-actions.tsx`

- [ ] **Step 1: 現在の project-header-actions.tsx を読む**

```bash
cat packages/frontend/src/components/header/project-header-actions.tsx
```

既存構造を確認して、歯車ボタンの近くに「要求書から取り込む」ボタンを追加する場所を特定。

- [ ] **Step 2: ボタン + ダイアログ制御 state 追加**

既存のコンポーネントに以下を追加:

```typescript
import { useState } from 'react';
import { IngestDocumentDialog } from '@/components/dialog/ingest-document-dialog';
// ...

export function ProjectHeaderActions() {
  const [settingsOpen, setSettingsOpen] = useState(false);  // 既存
  const [ingestOpen, setIngestOpen] = useState(false);      // 追加

  return (
    <>
      <button type="button" onClick={() => setIngestOpen(true)} style={...}>
        要求書から取り込む
      </button>
      {/* 既存の歯車ボタン */}
      <IngestDocumentDialog open={ingestOpen} onClose={() => setIngestOpen(false)} />
      {/* 既存の ProjectSettingsDialog */}
    </>
  );
}
```

具体的なスタイル / 配置は既存コードの並びに合わせる。

- [ ] **Step 3: frontend 全緑確認**

```bash
NODE_ENV=development pnpm --filter @tally/frontend test
```

Expected: 全緑。

- [ ] **Step 4: typecheck 全緑確認**

```bash
NODE_ENV=development pnpm -r typecheck
```

Expected: 全緑。

- [ ] **Step 5: コミット**

```bash
git add packages/frontend/src/components/header/project-header-actions.tsx
git commit -m "feat(frontend): ヘッダーに「要求書から取り込む」ボタンを追加"
```

---

## Task 7: docs 更新 + phase-5d 進捗 / 手動 E2E + 全緑最終確認

**Files:**
- Modify: `docs/04-roadmap.md`
- Create: `docs/phase-5d-manual-e2e.md`
- Create: `docs/phase-5d-progress.md`

- [ ] **Step 1: 04-roadmap.md の Phase 5d を「完了」に**

`docs/04-roadmap.md` の Phase 5d 部分を:

```markdown
### Phase 5d (完了)

- [x] `ingest-document.ts`：要求書取り込み (貼り付けテキスト → requirement + usecase + satisfy)

手動 E2E 手順は `docs/phase-5d-manual-e2e.md` 参照。
```

Phase 5 全体の完了条件に「要求書貼り付けから requirement/usecase proposal が生える」を追記。

- [ ] **Step 2: phase-5d-manual-e2e.md を新規作成**

`docs/phase-5d-manual-e2e.md`:

````markdown
# Phase 5d 手動 E2E 手順: ingest-document

Phase 5d で追加した `ingest-document` エージェントを実通信で確認する手順。Phase 5c と同形式。

## 前提

- `claude login` 済み (ADR-0006) もしくは `ANTHROPIC_API_KEY` 設定済み
- `NODE_ENV=development pnpm -r test` 緑
- サンプルプロジェクト: ノード 0 件の空プロジェクトを用意 (`.tally/` ディレクトリだけ存在) するか、既存プロジェクトで新規キャンバスを開く

## シナリオ 1: 空キャンバス → 骨格生成

1. `pnpm --filter frontend dev` で開発サーバ起動
2. 空プロジェクトを開く (ノード 0 件のキャンバスが表示される)
3. ヘッダーの「要求書から取り込む」ボタンをクリック → IngestDocumentDialog が開く
4. textarea に短い要求書テキストを貼り付け (例):

```
タスク管理アプリに「チーム招待」機能を追加する。

- チームメンバーがメールアドレスで他人を招待できる
- 招待されたユーザーは招待リンクから登録できる
- 管理者は招待の一覧と取り消しができる
- 招待は 7 日で自動失効する
```

5. 「取り込む」ボタンをクリック
6. 進捗パネルに thinking / tool_use (`create_node` x 複数 / `create_edge` x 複数) が流れる
7. ダイアログが自動で閉じる
8. キャンバス上に紫色の破線 proposal ノードが複数生える
   - 3〜8 個の requirement proposal (例: 「チーム招待を可能にする」「招待の有効期限管理」)
   - 3〜15 個の usecase proposal (例: 「メールで招待を送る」「招待を取り消す」)
   - satisfy エッジ (破線) が requirement → usecase に張られている

## シナリオ 2: 個別採用

1. 任意の proposal ノードを選択 → ProposalDetail が開く
2. タイトルは `[AI] <短い名前>`、body に要約
3. 採用先 select が `requirement` または `usecase` になっている
4. 「採用する」→ 正規ノードに昇格 (青 or 緑の実線)
5. 複数 proposal を順に採用し、キャンバスが段階的に構造化される

## シナリオ 3: 採用後の後続エージェント連鎖

1. 採用した usecase ノードを選択
2. 詳細から「ストーリー分解」ボタン → decompose-to-stories が走り、userstory proposal が生える
3. 「関連コードを探す」や「影響を分析する」は codebasePath 設定後に利用可 (Phase 5a/5b の動作)
4. 「論点を抽出」は codebasePath 不要でそのまま動く (Phase 5c)

→ ingest-document → decompose / find-related / analyze / extract の連鎖でキャンバスが肉付けされる

## シナリオ 4: バリデーション

1. 空の textarea で「取り込む」は disabled
2. 50,001 文字以上貼り付けると server 側で `invalid input` エラー
3. 実行中は「キャンセル」も disabled

## 失敗時のトラブルシュート

- `not_authenticated`: `claude login` を再実行
- `未知の agent: ingest-document`: registry 登録が抜けている、Task 3 確認
- proposal が生えない: Anthropic のレート制限 or テキスト内容が希薄で 0 件返ってきた可能性 (進捗パネルの summary 行で AI の判断を確認)
````

- [ ] **Step 3: phase-5d-progress.md を新規作成**

`docs/phase-5d-progress.md` を Phase 5c と同形式で作成 (全 7 タスク進捗、HEAD 情報、テスト本数、follow-up、実装ルール、復元手順)。

- [ ] **Step 4: 全パッケージ test + typecheck 最終確認**

```bash
NODE_ENV=development pnpm -r test 2>&1 | grep -E 'Tests.*passed'
NODE_ENV=development pnpm -r typecheck
```

Expected: 全緑 (合計 ≈ 270 本前後)。

- [ ] **Step 5: コミット**

```bash
git add docs/04-roadmap.md docs/phase-5d-manual-e2e.md docs/phase-5d-progress.md
git commit -m "docs: Phase 5d 完了マーク + 手動 E2E 手順書追加"
```

---

## 完了条件 (plan 全体)

- Task 1〜7 全て完了 commit
- `NODE_ENV=development pnpm -r test` が全緑 (~ 270 本)
- `NODE_ENV=development pnpm -r typecheck` が緑
- 手動 E2E で貼り付け → proposal 生成が動く

## Self-Review

**Spec coverage:**
- spec § 2 (core): Task 1 ✓
- spec § 3.1-3.4 (ingest-document agent): Task 2 ✓
- spec § 3.5 (AgentDefinition) / 3.6 (registry) / 3.7 (agent-runner): Task 3 ✓
- spec § 4.1 (Dialog): Task 5 ✓
- spec § 4.2 (Header button): Task 6 ✓
- spec § 4.3 (store.startIngestDocument): Task 4 ✓
- spec § 5 (tests + E2E + roadmap + progress): 各 Task でカバー + Task 7 で仕上げ

**Placeholder scan:** なし。各 Step は実コマンド / 実コード付き。

**Type consistency:**
- `IngestDocumentInput` 型は Task 2 で定義、Task 3 / Task 4 で参照
- `runAgentWithInput` シグネチャは Task 4 で一貫
- `AgentValidateOk.anchor?` / `AgentPromptInput.input?` は Task 2 で追加、Task 3 で agent-runner 側が使う
