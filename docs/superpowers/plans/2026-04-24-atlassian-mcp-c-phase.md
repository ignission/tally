# Atlassian MCP 連携 — C フェーズ Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tally の Chat で Atlassian MCP (Jira) を multi-turn 対話で使える完成形 UX を作る。プロジェクト設定から mcpServers[] を登録 → Chat で「@JIRA EPIC-X を読んで論点を出して」→ AI が外部 MCP 経由で Jira 読み → question proposal 生成 → 採用、までが動く。

**Architecture:** `chat-runner.ts` と `agent-runner.ts` の `mcpServers: { tally }` ハードコードを `buildMcpServers` utility に抽出し、プロジェクト設定の `mcpServers[]` から外部 MCP (Atlassian HTTP MCP) を動的合成する。ChatBlockSchema に `source: 'internal' | 'external'` を追加し、外部 MCP の tool_use/tool_result を承認なしで永続化。buildChatPrompt を拡張して tool_use/tool_result を replay し、multi-turn で AI が前ターンの Jira 内容を覚える。create-node の重複ガードを strategy-pattern に抽出し、sourceUrl ベースの guard を追加 (chat で anchorId 空でも動く)。

**Tech Stack:** TypeScript, pnpm workspaces, Next.js 15 App Router, React Flow, Zustand, Claude Agent SDK (`@anthropic-ai/claude-agent-sdk@0.2.117`), Vitest, Biome. 既存 Tally のパッケージ構成 (`@tally/core`, `@tally/storage`, `@tally/ai-engine`, `@tally/frontend`) に従う。

**Related docs:**
- Design doc: `~/.gstack/projects/ignission-tally/knowbe01-main-design-20260423-164810.md`
- Test plan: `~/.gstack/projects/ignission-tally/knowbe01-main-eng-review-test-plan-20260423-212143.md`
- CLAUDE.md / `.claude/rules/testing.md` / `.claude/rules/packages-architecture.md`

---

## Prerequisite: Step 0 Spikes (C 着手前、30-35 分、手動)

これらは実装でなく調査。結果を design doc 末尾に脚注として追記してから Task 1 を開始する。

- [ ] **Spike 0a (30 分): Atlassian MCP 実装選定**
  - `sooperset/mcp-atlassian` (OSS、PAT 対応、HTTP transport) を第一候補として起動確認
  - 公式 Atlassian Remote MCP が利用可能なら比較検討、PAT 認証が使えることが必須 (Premise 9)
  - 選定結果と tool 一覧 (例: `atlassian_getJiraIssue`, `atlassian_searchJiraIssues` 等) を `~/.gstack/projects/ignission-tally/knowbe01-main-design-20260423-164810.md` 末尾に `## Atlassian MCP Implementation Footnote` として追記
  - tool 名 prefix (例: `mcp__atlassian__`) を記録 → Task 3 / Task 9 で使用

- [ ] **Spike 0b (5 分): allowedTools wildcard 動作検証**
  - 最小 spike スクリプト `/tmp/spike-allowed-tools.mjs` を書く:
    ```javascript
    // spike-allowed-tools.mjs
    import { query } from '@anthropic-ai/claude-agent-sdk';
    // 外部 MCP は spike 時点では mock、allowedTools: ['mcp__atlassian__*'] で
    // SDK が permission エラーを出さないか確認するのみ
    ```
  - または既存 `pnpm -F @tally/ai-engine exec tsx` で SDK の `allowedTools: ['mcp__atlassian__*']` が warning/error 出さずに受理されるか確認
  - wildcard 受理 → Task 9 で `['mcp__tally__*', 'mcp__atlassian__*']` パターンを採用
  - 拒否 → Task 9 は Spike 0a で取得した tool 名を `['mcp__tally__*', 'mcp__atlassian__atlassian_getJiraIssue', ...]` と静的列挙
  - 結果を design doc 末尾の Footnote に追記

---

## File Structure (C フェーズで触る範囲)

**新規作成:**
- `packages/ai-engine/src/mcp/build-mcp-servers.ts` — プロジェクト設定から SDK の mcpServers を組み立てる
- `packages/ai-engine/src/mcp/build-mcp-servers.test.ts` — 上記のテスト
- `packages/ai-engine/src/mcp/redact.ts` — Authorization header を含むログの redaction utility
- `packages/ai-engine/src/mcp/redact.test.ts`
- `packages/ai-engine/src/duplicate-guards/index.ts` — guard interface + strategy map
- `packages/ai-engine/src/duplicate-guards/coderef.ts` — 既存 coderef 重複ガードを分離
- `packages/ai-engine/src/duplicate-guards/question.ts` — 既存 question 重複ガードを分離
- `packages/ai-engine/src/duplicate-guards/source-url.ts` — T1 fix、sourceUrl ベースの新規 guard
- `packages/ai-engine/src/duplicate-guards/*.test.ts` — 各 guard のテスト

**修正:**
- `packages/core/src/schema.ts` — McpServerConfigSchema / ProjectSchema.mcpServers / ChatBlockSchema.tool_use.source / RequirementNodeSchema.sourceUrl
- `packages/core/src/types.ts` — 対応する型 export
- `packages/core/src/schema.test.ts` — 上記の round-trip / migration テスト
- `packages/ai-engine/src/chat-runner.ts` — buildMcpServers 呼び出し / extractAssistantBlocks 拡張 / buildChatPrompt 拡張 / tool_result truncate
- `packages/ai-engine/src/chat-runner.test.ts` — 対応テスト
- `packages/ai-engine/src/agent-runner.ts` — buildMcpServers 共有
- `packages/ai-engine/src/agent-runner.test.ts` — regression snapshot
- `packages/ai-engine/src/tools/create-node.ts` — duplicate-guards に委譲
- `packages/ai-engine/src/tools/create-node.test.ts`
- `packages/frontend/src/app/api/projects/[id]/route.ts` — mcpServers round-trip
- `packages/frontend/src/lib/api.ts` — mcpServers API
- `packages/frontend/src/components/dialog/project-settings-dialog.tsx` — mcpServers CRUD UI
- `packages/frontend/src/components/chat/tool-approval-card.tsx` — source 分岐
- `packages/frontend/src/components/chat/chat-tab.tsx` — external source の折り畳み表示

---

## Task 1: core schema 拡張 (McpServerConfigSchema)

**Files:**
- Modify: `packages/core/src/schema.ts`
- Modify: `packages/core/src/types.ts`
- Test: `packages/core/src/schema.test.ts`

**Spike 0a の結果を反映**: auth は Basic (Cloud) / Bearer (Server/DC) の 2 scheme。Basic の場合は email + token の両方が必要なので、envVar を `emailEnvVar` + `tokenEnvVar` に分離した discriminated union。

- [ ] **Step 1-1: failing test を書く — `McpServerConfigSchema` の round-trip**

`packages/core/src/schema.test.ts` に追記:

```typescript
import { McpServerConfigSchema } from './schema';

describe('McpServerConfigSchema', () => {
  it('Cloud (basic) auth の round-trip が通る', () => {
    const raw = {
      id: 'atlassian-cloud',
      name: 'Atlassian Cloud',
      kind: 'atlassian' as const,
      url: 'https://mcp.atlassian.example/v1/mcp',
      auth: {
        type: 'pat' as const,
        scheme: 'basic' as const,
        emailEnvVar: 'ATLASSIAN_EMAIL',
        tokenEnvVar: 'ATLASSIAN_API_TOKEN',
      },
      options: { maxChildIssues: 30, maxCommentsPerIssue: 5 },
    };
    const parsed = McpServerConfigSchema.parse(raw);
    expect(parsed).toEqual(raw);
  });

  it('Server/DC (bearer) auth の round-trip が通る', () => {
    const raw = {
      id: 'atlassian-onprem',
      name: 'Atlassian On-Prem',
      kind: 'atlassian' as const,
      url: 'https://jira.example.com/mcp',
      auth: {
        type: 'pat' as const,
        scheme: 'bearer' as const,
        tokenEnvVar: 'JIRA_PAT',
      },
      options: { maxChildIssues: 30, maxCommentsPerIssue: 5 },
    };
    const parsed = McpServerConfigSchema.parse(raw);
    expect(parsed).toEqual(raw);
  });

  it('basic で emailEnvVar 無しは fail', () => {
    expect(() =>
      McpServerConfigSchema.parse({
        id: 'a', name: 'A', kind: 'atlassian',
        url: 'https://x.test/mcp',
        auth: { type: 'pat', scheme: 'basic', tokenEnvVar: 'T' },
      }),
    ).toThrow();
  });

  it('options 未指定なら default が入る', () => {
    const parsed = McpServerConfigSchema.parse({
      id: 'a', name: 'A', kind: 'atlassian',
      url: 'https://x.test/mcp',
      auth: { type: 'pat', scheme: 'bearer', tokenEnvVar: 'X_PAT' },
    });
    expect(parsed.options.maxChildIssues).toBe(30);
    expect(parsed.options.maxCommentsPerIssue).toBe(5);
  });

  it('url が URL でないと fail', () => {
    expect(() =>
      McpServerConfigSchema.parse({
        id: 'a', name: 'A', kind: 'atlassian', url: 'not a url',
        auth: { type: 'pat', scheme: 'bearer', tokenEnvVar: 'X' },
      }),
    ).toThrow();
  });
});
```

- [ ] **Step 1-2: test を走らせて fail を確認**

Run: `pnpm -F @tally/core test -- schema.test`
Expected: FAIL with "McpServerConfigSchema is not exported"

- [ ] **Step 1-3: `McpServerConfigSchema` を `packages/core/src/schema.ts` に追加**

既存 `ProjectSchema` の直前に追加:

```typescript
// Atlassian Cloud は Basic (base64(email:token))、Server/DC は Bearer (pat) の 2 scheme。
// どちらも PAT ベースの認証 (OAuth は MVP 非対応、Premise 9)。
const McpAuthSchema = z.discriminatedUnion('scheme', [
  z.object({
    type: z.literal('pat'),
    scheme: z.literal('basic'),
    emailEnvVar: z.string().min(1), // 例 "ATLASSIAN_EMAIL"
    tokenEnvVar: z.string().min(1), // 例 "ATLASSIAN_API_TOKEN"
  }),
  z.object({
    type: z.literal('pat'),
    scheme: z.literal('bearer'),
    tokenEnvVar: z.string().min(1), // 例 "JIRA_PAT"
  }),
]);

export const McpServerConfigSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  kind: z.literal('atlassian'),
  url: z.string().url(),
  auth: McpAuthSchema,
  options: z
    .object({
      maxChildIssues: z.number().int().positive().default(30),
      maxCommentsPerIssue: z.number().int().nonnegative().default(5),
    })
    .default({}),
});

export type McpServerConfig = z.infer<typeof McpServerConfigSchema>;
```

`packages/core/src/types.ts` にも:

```typescript
export type { McpServerConfig } from './schema';
```

- [ ] **Step 1-4: test を走らせて pass を確認**

Run: `pnpm -F @tally/core test -- schema.test`
Expected: PASS (McpServerConfigSchema の 3 case)

- [ ] **Step 1-5: commit**

```bash
git add packages/core/src/schema.ts packages/core/src/schema.test.ts packages/core/src/types.ts
git commit -m "feat(core): McpServerConfigSchema を追加 (Atlassian MCP 連携の基盤)"
```

---

## Task 2: core schema 拡張 (ProjectSchema.mcpServers)

**Files:**
- Modify: `packages/core/src/schema.ts`
- Test: `packages/core/src/schema.test.ts`

- [ ] **Step 2-1: failing test — ProjectSchema に mcpServers[] が含まれる**

`packages/core/src/schema.test.ts` に追記:

```typescript
describe('ProjectSchema.mcpServers', () => {
  it('mcpServers 未指定なら default の空配列', () => {
    const p = ProjectSchema.parse({
      id: 'p', name: 'P', codebases: [],
      createdAt: '2026-04-24T00:00:00Z',
      updatedAt: '2026-04-24T00:00:00Z',
    });
    expect(p.mcpServers).toEqual([]);
  });

  it('mcpServers 指定で round-trip する', () => {
    const input = {
      id: 'p', name: 'P', codebases: [],
      createdAt: '2026-04-24T00:00:00Z',
      updatedAt: '2026-04-24T00:00:00Z',
      mcpServers: [
        {
          id: 'a', name: 'A', kind: 'atlassian' as const,
          url: 'https://x.test/mcp',
          auth: { type: 'pat' as const, envVar: 'X' },
        },
      ],
    };
    const p = ProjectSchema.parse(input);
    expect(p.mcpServers).toHaveLength(1);
    expect(p.mcpServers[0].options.maxChildIssues).toBe(30);
  });
});
```

- [ ] **Step 2-2: test fail を確認**

Run: `pnpm -F @tally/core test -- schema.test`
Expected: FAIL with "Property 'mcpServers' ..."

- [ ] **Step 2-3: ProjectSchema に mcpServers を追加**

`packages/core/src/schema.ts` の `ProjectSchema` 定義に:

```typescript
export const ProjectSchema = z.object({
  // 既存フィールド ...
  mcpServers: z.array(McpServerConfigSchema).default([]),
});
```

`ProjectMetaSchema` にも同じ `mcpServers` フィールドを追加 (project.yaml の meta と本体で整合)。既存の Project 型と ProjectMeta 型が何を含むかは既存コードに合わせる。

- [ ] **Step 2-4: test pass を確認 + storage の既存 round-trip テストも通る確認**

Run: `pnpm -F @tally/core test && pnpm -F @tally/storage test`
Expected: PASS 全件。既存 YAML (mcpServers 無し) が optional default で [] として読めること。

- [ ] **Step 2-5: commit**

```bash
git add packages/core/src/schema.ts packages/core/src/schema.test.ts
git commit -m "feat(core): ProjectSchema に mcpServers[] を追加 (default [])"
```

---

## Task 3: core schema 拡張 (ChatBlockSchema.source / RequirementNodeSchema.sourceUrl)

**Files:**
- Modify: `packages/core/src/schema.ts`
- Test: `packages/core/src/schema.test.ts`

- [ ] **Step 3-1: failing test — ChatBlock.tool_use に source が入り、古い YAML (source 無し) が 'internal' として読める**

```typescript
describe('ChatBlockSchema.tool_use.source', () => {
  it('source 未指定の古いデータが "internal" に defaults', () => {
    const b = ChatBlockSchema.parse({
      type: 'tool_use',
      toolUseId: 'tu-1',
      name: 'mcp__tally__create_node',
      input: { x: 1 },
      approval: 'approved',
    });
    expect(b.type).toBe('tool_use');
    if (b.type === 'tool_use') expect(b.source).toBe('internal');
  });

  it('source = "external" は承認不要扱い (approval optional)', () => {
    const b = ChatBlockSchema.parse({
      type: 'tool_use',
      toolUseId: 'tu-2',
      name: 'mcp__atlassian__getJiraIssue',
      input: { issueKey: 'EPIC-1' },
      source: 'external',
    });
    if (b.type === 'tool_use') {
      expect(b.source).toBe('external');
      expect(b.approval).toBeUndefined();
    }
  });

  it('source = "internal" で approval 無しは fail', () => {
    expect(() =>
      ChatBlockSchema.parse({
        type: 'tool_use', toolUseId: 'tu-3',
        name: 'mcp__tally__create_node', input: {},
        source: 'internal',
      }),
    ).toThrow();
  });
});

describe('RequirementNodeSchema.sourceUrl', () => {
  it('sourceUrl 未指定は optional (既存互換)', () => {
    const n = RequirementNodeSchema.parse({
      id: 'n', type: 'requirement', x: 0, y: 0,
      title: 'R', body: '',
    });
    expect(n.sourceUrl).toBeUndefined();
  });

  it('sourceUrl 指定で保持', () => {
    const n = RequirementNodeSchema.parse({
      id: 'n', type: 'requirement', x: 0, y: 0,
      title: 'R', body: '',
      sourceUrl: 'https://jira.test/browse/EPIC-1',
    });
    expect(n.sourceUrl).toBe('https://jira.test/browse/EPIC-1');
  });
});
```

- [ ] **Step 3-2: test fail を確認**

Run: `pnpm -F @tally/core test -- schema.test`

- [ ] **Step 3-3: schema.ts を修正**

ChatBlockSchema の tool_use 枝を書き換え:

```typescript
z.object({
  type: z.literal('tool_use'),
  toolUseId: z.string().min(1),
  name: z.string().min(1),
  input: z.unknown(),
  source: z.enum(['internal', 'external']).default('internal'),
  approval: z.enum(['pending', 'approved', 'rejected']).optional(),
}).refine(
  (b) => b.source === 'external' || b.approval !== undefined,
  { message: 'internal tool_use には approval が必要' },
),
```

RequirementNodeSchema に:

```typescript
// 既存 フィールドに追加:
sourceUrl: z.string().url().optional(),
```

- [ ] **Step 3-4: test pass + 既存 agent-runner / chat-runner テストが退行なしで通る**

Run: `pnpm -F @tally/core test && pnpm -F @tally/ai-engine test && pnpm -F @tally/storage test`

- [ ] **Step 3-5: commit**

```bash
git add packages/core/src/schema.ts packages/core/src/schema.test.ts
git commit -m "feat(core): ChatBlock.tool_use に source を追加、Requirement に sourceUrl を追加"
```

---

## Task 4: redact-logs utility

**Files:**
- Create: `packages/ai-engine/src/mcp/redact.ts`
- Create: `packages/ai-engine/src/mcp/redact.test.ts`

- [ ] **Step 4-1: failing test**

```typescript
// packages/ai-engine/src/mcp/redact.test.ts
import { describe, expect, it } from 'vitest';
import { redactMcpSecrets } from './redact';

describe('redactMcpSecrets', () => {
  it('Authorization header を "***" に置換', () => {
    const input = {
      mcpServers: {
        atlassian: {
          type: 'http',
          url: 'https://x.test/mcp',
          headers: { Authorization: 'Bearer abc-123' },
        },
      },
    };
    const out = redactMcpSecrets(input);
    expect((out as any).mcpServers.atlassian.headers.Authorization).toBe('***');
    // 元オブジェクトは破壊しない
    expect(input.mcpServers.atlassian.headers.Authorization).toBe('Bearer abc-123');
  });

  it('他フィールドは保持', () => {
    const out = redactMcpSecrets({
      mcpServers: {
        atlassian: { type: 'http', url: 'https://x.test/mcp', headers: { 'X-Other': 'keep' } },
      },
    });
    expect((out as any).mcpServers.atlassian.url).toBe('https://x.test/mcp');
    expect((out as any).mcpServers.atlassian.headers['X-Other']).toBe('keep');
  });

  it('mcpServers が無ければそのまま', () => {
    const input = { foo: 'bar' };
    expect(redactMcpSecrets(input)).toEqual(input);
  });
});
```

- [ ] **Step 4-2: test fail を確認**

Run: `pnpm -F @tally/ai-engine test -- redact.test`
Expected: FAIL (モジュール未定義)

- [ ] **Step 4-3: 実装**

```typescript
// packages/ai-engine/src/mcp/redact.ts

// SDK に渡す mcpServers 設定 (特に Authorization ヘッダ) をログに出す前の
// 安全な形に変換する。プロセスメモリには PAT が残るが、ログ出力経路では ***。
export function redactMcpSecrets(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value;
  const obj = value as Record<string, unknown>;
  if (!obj.mcpServers || typeof obj.mcpServers !== 'object') return value;

  const servers = obj.mcpServers as Record<string, unknown>;
  const redactedServers: Record<string, unknown> = {};
  for (const [name, cfg] of Object.entries(servers)) {
    if (cfg && typeof cfg === 'object' && 'headers' in cfg) {
      const src = cfg as { headers?: Record<string, unknown> };
      const headers = src.headers;
      if (headers && typeof headers === 'object' && 'Authorization' in headers) {
        redactedServers[name] = {
          ...src,
          headers: { ...headers, Authorization: '***' },
        };
        continue;
      }
    }
    redactedServers[name] = cfg;
  }
  return { ...obj, mcpServers: redactedServers };
}
```

- [ ] **Step 4-4: test pass**

Run: `pnpm -F @tally/ai-engine test -- redact.test`

- [ ] **Step 4-5: commit**

```bash
git add packages/ai-engine/src/mcp/
git commit -m "feat(ai-engine): redactMcpSecrets を追加 (Authorization header のログ漏洩予防)"
```

---

## Task 5: buildMcpServers utility

**Files:**
- Create: `packages/ai-engine/src/mcp/build-mcp-servers.ts`
- Create: `packages/ai-engine/src/mcp/build-mcp-servers.test.ts`

**Spike 0a/0b の結果を反映**: auth.scheme で Basic/Bearer 分岐、Basic は `base64(email:token)`。allowedTools は wildcard `mcp__<id>__*` を使用 (Spike 0b で確認)。

- [ ] **Step 5-1: failing test**

```typescript
// packages/ai-engine/src/mcp/build-mcp-servers.test.ts
import { afterEach, describe, expect, it } from 'vitest';
import { buildMcpServers } from './build-mcp-servers';

describe('buildMcpServers', () => {
  const ORIGINAL_ENV = { ...process.env };
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('mcpServers 空配列 → external 無し、allowedTools は tally のみ', () => {
    const result = buildMcpServers({ tallyMcp: { type: 'sdk' } as any, configs: [] });
    expect(Object.keys(result.mcpServers)).toEqual(['tally']);
    expect(result.allowedTools).toEqual(['mcp__tally__*']);
  });

  it('Bearer (Server/DC) → Authorization: Bearer <token>', () => {
    process.env.JIRA_PAT = 'secret-xyz';
    const result = buildMcpServers({
      tallyMcp: { type: 'sdk' } as any,
      configs: [
        {
          id: 'atlassian-dc', name: 'A', kind: 'atlassian',
          url: 'https://jira.test/mcp',
          auth: { type: 'pat', scheme: 'bearer', tokenEnvVar: 'JIRA_PAT' },
          options: { maxChildIssues: 30, maxCommentsPerIssue: 5 },
        },
      ],
    });
    const atlassian = result.mcpServers['atlassian-dc'] as any;
    expect(atlassian.type).toBe('http');
    expect(atlassian.url).toBe('https://jira.test/mcp');
    expect(atlassian.headers.Authorization).toBe('Bearer secret-xyz');
    expect(result.allowedTools).toContain('mcp__tally__*');
    expect(result.allowedTools).toContain('mcp__atlassian-dc__*');
  });

  it('Basic (Cloud) → Authorization: Basic <base64(email:token)>', () => {
    process.env.ATLASSIAN_EMAIL = 'user@example.com';
    process.env.ATLASSIAN_API_TOKEN = 'api-token-xyz';
    const result = buildMcpServers({
      tallyMcp: { type: 'sdk' } as any,
      configs: [
        {
          id: 'atlassian-cloud', name: 'A', kind: 'atlassian',
          url: 'https://x.test/mcp',
          auth: {
            type: 'pat', scheme: 'basic',
            emailEnvVar: 'ATLASSIAN_EMAIL',
            tokenEnvVar: 'ATLASSIAN_API_TOKEN',
          },
          options: { maxChildIssues: 30, maxCommentsPerIssue: 5 },
        },
      ],
    });
    const atlassian = result.mcpServers['atlassian-cloud'] as any;
    const expected = Buffer.from('user@example.com:api-token-xyz').toString('base64');
    expect(atlassian.headers.Authorization).toBe(`Basic ${expected}`);
  });

  it('Bearer の tokenEnvVar 未設定 → throw', () => {
    delete process.env.JIRA_PAT;
    expect(() =>
      buildMcpServers({
        tallyMcp: { type: 'sdk' } as any,
        configs: [
          {
            id: 'a', name: 'A', kind: 'atlassian',
            url: 'https://x.test/mcp',
            auth: { type: 'pat', scheme: 'bearer', tokenEnvVar: 'JIRA_PAT' },
            options: { maxChildIssues: 30, maxCommentsPerIssue: 5 },
          },
        ],
      }),
    ).toThrowError(/JIRA_PAT/);
  });

  it('Basic の emailEnvVar 未設定 → throw', () => {
    delete process.env.ATLASSIAN_EMAIL;
    process.env.ATLASSIAN_API_TOKEN = 'x';
    expect(() =>
      buildMcpServers({
        tallyMcp: { type: 'sdk' } as any,
        configs: [
          {
            id: 'a', name: 'A', kind: 'atlassian',
            url: 'https://x.test/mcp',
            auth: {
              type: 'pat', scheme: 'basic',
              emailEnvVar: 'ATLASSIAN_EMAIL', tokenEnvVar: 'ATLASSIAN_API_TOKEN',
            },
            options: { maxChildIssues: 30, maxCommentsPerIssue: 5 },
          },
        ],
      }),
    ).toThrowError(/ATLASSIAN_EMAIL/);
  });

  it('env 値が空文字でも → throw', () => {
    process.env.JIRA_PAT = '';
    expect(() =>
      buildMcpServers({
        tallyMcp: { type: 'sdk' } as any,
        configs: [
          {
            id: 'a', name: 'A', kind: 'atlassian',
            url: 'https://x.test/mcp',
            auth: { type: 'pat', scheme: 'bearer', tokenEnvVar: 'JIRA_PAT' },
            options: { maxChildIssues: 30, maxCommentsPerIssue: 5 },
          },
        ],
      }),
    ).toThrowError(/JIRA_PAT/);
  });
});
```

- [ ] **Step 5-2: test fail を確認**

Run: `pnpm -F @tally/ai-engine test -- build-mcp-servers.test`
Expected: FAIL (未実装)

- [ ] **Step 5-3: 実装**

```typescript
// packages/ai-engine/src/mcp/build-mcp-servers.ts
import type { McpServerConfig } from '@tally/core';

// SDK の mcpServers は Record<string, McpServerConfig> を受ける (sdk.d.ts:1386 参照)。
// chat-runner / agent-runner が共通で使える shape にする。
export interface BuildMcpServersInput {
  // createSdkMcpServer で組み立てた Tally MCP。ここでは opaque。
  tallyMcp: unknown;
  // プロジェクト設定 project.mcpServers[]。
  configs: McpServerConfig[];
}

export interface BuildMcpServersResult {
  mcpServers: Record<string, unknown>;
  allowedTools: string[];
}

function requireEnv(varName: string, contextId: string): string {
  const v = process.env[varName];
  if (v === undefined || v === '') {
    throw new Error(
      `MCP 設定 "${contextId}" の env var "${varName}" が未設定または空です`,
    );
  }
  return v;
}

function buildAuthHeader(auth: McpServerConfig['auth'], contextId: string): string {
  if (auth.scheme === 'bearer') {
    const token = requireEnv(auth.tokenEnvVar, contextId);
    return `Bearer ${token}`;
  }
  // basic
  const email = requireEnv(auth.emailEnvVar, contextId);
  const token = requireEnv(auth.tokenEnvVar, contextId);
  const b64 = Buffer.from(`${email}:${token}`).toString('base64');
  return `Basic ${b64}`;
}

// SDK 設定と allowedTools を組み立てる。env 未設定は throw。
// 呼び出し元は runUserTurn の都度これを呼ぶ → env 変更がホットリロードされる。
// allowedTools は wildcard `mcp__<id>__*` を使用 (Spike 0b で SDK サポート確認済み)。
export function buildMcpServers(input: BuildMcpServersInput): BuildMcpServersResult {
  const { tallyMcp, configs } = input;

  const mcpServers: Record<string, unknown> = { tally: tallyMcp };
  const allowedTools: string[] = ['mcp__tally__*'];

  for (const cfg of configs) {
    const authHeader = buildAuthHeader(cfg.auth, cfg.id);
    mcpServers[cfg.id] = {
      type: 'http' as const,
      url: cfg.url,
      headers: { Authorization: authHeader },
    };
    allowedTools.push(`mcp__${cfg.id}__*`);
  }

  return { mcpServers, allowedTools };
}
```

- [ ] **Step 5-4: test pass**

Run: `pnpm -F @tally/ai-engine test -- build-mcp-servers.test`

- [ ] **Step 5-5: commit**

```bash
git add packages/ai-engine/src/mcp/build-mcp-servers.ts packages/ai-engine/src/mcp/build-mcp-servers.test.ts
git commit -m "feat(ai-engine): buildMcpServers utility を追加 (外部 MCP 合成 + env 検証)"
```

---

## Task 6: duplicate-guards 骨格 (interface + strategy map)

**Files:**
- Create: `packages/ai-engine/src/duplicate-guards/index.ts`
- Create: `packages/ai-engine/src/duplicate-guards/index.test.ts`

- [ ] **Step 6-1: failing test — guard map のディスパッチ**

```typescript
// packages/ai-engine/src/duplicate-guards/index.test.ts
import { describe, expect, it } from 'vitest';
import { dispatchDuplicateGuard, type DuplicateGuardContext } from './index';

describe('dispatchDuplicateGuard', () => {
  const fakeStore = { listNodes: async () => [], findRelatedNodes: async () => [] } as any;
  const baseCtx: DuplicateGuardContext = {
    store: fakeStore,
    anchorId: '',
    sessionMemo: new Set(),
  };

  it('adoptAs="requirement" は guard 対象外 → null', async () => {
    const result = await dispatchDuplicateGuard('requirement', { title: 't', body: '', additional: undefined }, baseCtx);
    expect(result).toBeNull();
  });

  it('guard 登録が無い adoptAs は null', async () => {
    const result = await dispatchDuplicateGuard('usecase' as any, { title: 't', body: '', additional: undefined }, baseCtx);
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 6-2: test fail を確認**

Run: `pnpm -F @tally/ai-engine test -- duplicate-guards`

- [ ] **Step 6-3: interface + dispatcher を実装 (個別 guard は後続 task)**

```typescript
// packages/ai-engine/src/duplicate-guards/index.ts
import type { AdoptableType } from '@tally/core';
import type { ProjectStore } from '@tally/storage';

// create-node 入力のうち guard に必要な最小 shape。
export interface GuardInput {
  title: string;
  body: string;
  additional: Record<string, unknown> | undefined;
}

// guard が共有するランタイム文脈。
export interface DuplicateGuardContext {
  store: ProjectStore;
  // anchor 無し (chat) のときは空文字。anchor 依存 guard は空文字を skip せよ。
  anchorId: string;
  // セッション内で生成済みノードの重複記録。キーは guard 実装が決める。
  sessionMemo: Set<string>;
  // マルチコードベース対応のために流すコードベース ID (optional)。
  codebaseId?: string;
}

export interface DuplicateFound {
  reason: string; // ユーザー向けメッセージ (既存 node id などを含む)
}

export interface DuplicateGuard {
  // 対象 adoptAs。複数対応は同 guard を複数 adoptAs で登録する。
  adoptAs: AdoptableType;
  // 重複があれば DuplicateFound、無ければ null。
  // 副作用: 重複が無く生成が成功するかどうかの追跡は呼び出し側 (create-node) が行う。
  check(input: GuardInput, ctx: DuplicateGuardContext): Promise<DuplicateFound | null>;
  // 生成成功後に呼ばれる (sessionMemo 更新など)。
  onCreated?(input: GuardInput, ctx: DuplicateGuardContext): void;
}

// adoptAs → Guard[] のレジストリ。Task 7-9 で個別 guard を追加する。
const REGISTRY = new Map<AdoptableType, DuplicateGuard[]>();

export function registerGuard(guard: DuplicateGuard): void {
  const list = REGISTRY.get(guard.adoptAs) ?? [];
  list.push(guard);
  REGISTRY.set(guard.adoptAs, list);
}

export async function dispatchDuplicateGuard(
  adoptAs: AdoptableType,
  input: GuardInput,
  ctx: DuplicateGuardContext,
): Promise<DuplicateFound | null> {
  const guards = REGISTRY.get(adoptAs) ?? [];
  for (const g of guards) {
    const found = await g.check(input, ctx);
    if (found) return found;
  }
  return null;
}

export function notifyCreated(
  adoptAs: AdoptableType,
  input: GuardInput,
  ctx: DuplicateGuardContext,
): void {
  const guards = REGISTRY.get(adoptAs) ?? [];
  for (const g of guards) g.onCreated?.(input, ctx);
}
```

- [ ] **Step 6-4: test pass**

Run: `pnpm -F @tally/ai-engine test -- duplicate-guards`

- [ ] **Step 6-5: commit**

```bash
git add packages/ai-engine/src/duplicate-guards/
git commit -m "feat(ai-engine): duplicate-guards の骨格 (interface + dispatcher) を追加"
```

---

## Task 7: coderef guard を分離 (既存ロジック移行)

**Files:**
- Create: `packages/ai-engine/src/duplicate-guards/coderef.ts`
- Create: `packages/ai-engine/src/duplicate-guards/coderef.test.ts`
- Modify: `packages/ai-engine/src/duplicate-guards/index.ts` (register 呼び出し)

- [ ] **Step 7-1: failing test — 既存挙動を網羅する単体テスト**

```typescript
// packages/ai-engine/src/duplicate-guards/coderef.test.ts
import { describe, expect, it, vi } from 'vitest';
import { coderefGuard } from './coderef';
import type { DuplicateGuardContext } from './index';

function makeCtx(nodes: any[], anchorId = ''): DuplicateGuardContext {
  return {
    store: {
      listNodes: async () => nodes,
      findRelatedNodes: async () => [],
    } as any,
    anchorId,
    sessionMemo: new Set(),
    codebaseId: undefined,
  };
}

describe('coderefGuard', () => {
  it('同一 filePath + 近接 startLine (±10) で重複検知', async () => {
    const ctx = makeCtx([
      { id: 'n1', type: 'coderef', filePath: 'src/a.ts', startLine: 100, codebaseId: 'cb1' },
    ]);
    const res = await coderefGuard.check(
      {
        title: 'T', body: '',
        additional: { filePath: 'src/a.ts', startLine: 105, codebaseId: 'cb1' },
      },
      ctx,
    );
    expect(res?.reason).toContain('重複');
  });

  it('11 行以上離れていれば重複ではない', async () => {
    const ctx = makeCtx([
      { id: 'n1', type: 'coderef', filePath: 'src/a.ts', startLine: 100, codebaseId: 'cb1' },
    ]);
    const res = await coderefGuard.check(
      {
        title: 'T', body: '',
        additional: { filePath: 'src/a.ts', startLine: 112, codebaseId: 'cb1' },
      },
      ctx,
    );
    expect(res).toBeNull();
  });

  it('codebaseId が異なれば別物扱い', async () => {
    const ctx = makeCtx([
      { id: 'n1', type: 'coderef', filePath: 'src/a.ts', startLine: 100, codebaseId: 'cb1' },
    ]);
    const res = await coderefGuard.check(
      {
        title: 'T', body: '',
        additional: { filePath: 'src/a.ts', startLine: 100, codebaseId: 'cb2' },
      },
      ctx,
    );
    expect(res).toBeNull();
  });

  it('filePath が "./" 付きでも正規化して判定', async () => {
    const ctx = makeCtx([
      { id: 'n1', type: 'coderef', filePath: 'src/a.ts', startLine: 100 },
    ]);
    const res = await coderefGuard.check(
      {
        title: 'T', body: '',
        additional: { filePath: './src/a.ts', startLine: 100 },
      },
      ctx,
    );
    expect(res?.reason).toContain('重複');
  });
});
```

- [ ] **Step 7-2: test fail を確認**

Run: `pnpm -F @tally/ai-engine test -- duplicate-guards/coderef`

- [ ] **Step 7-3: 既存 `findDuplicateCoderef` を移行**

`packages/ai-engine/src/duplicate-guards/coderef.ts` に既存 create-node.ts の normalizeFilePath + findDuplicateCoderef を guard 形式で書く:

```typescript
import path from 'node:path';
import type { DuplicateGuard } from './index';

const CODEREF_LINE_TOLERANCE = 10;

function normalizeFilePath(fp: string): string {
  const stripped = fp.startsWith('./') ? fp.slice(2) : fp;
  return path.posix.normalize(stripped);
}

export const coderefGuard: DuplicateGuard = {
  adoptAs: 'coderef',
  async check(input, ctx) {
    const additional = input.additional ?? {};
    const fp = additional.filePath;
    const sl = additional.startLine;
    if (typeof fp !== 'string' || typeof sl !== 'number') return null;

    const normalized = normalizeFilePath(fp);
    const activeCbId =
      typeof additional.codebaseId === 'string' ? additional.codebaseId : ctx.codebaseId;

    const all = await ctx.store.listNodes();
    for (const n of all) {
      const rec = n as Record<string, unknown>;
      const type = rec.type as string | undefined;
      const adoptAs = rec.adoptAs as string | undefined;
      const isCoderef = type === 'coderef' || (type === 'proposal' && adoptAs === 'coderef');
      if (!isCoderef) continue;
      const existingFp = rec.filePath as string | undefined;
      const existingSl = rec.startLine as number | undefined;
      if (!existingFp || typeof existingSl !== 'number') continue;
      if (normalizeFilePath(existingFp) !== normalized) continue;
      const existingCb = rec.codebaseId as string | undefined;
      if (activeCbId !== undefined && existingCb !== undefined && existingCb !== activeCbId) {
        continue;
      }
      if (Math.abs(existingSl - sl) <= CODEREF_LINE_TOLERANCE) {
        return {
          reason: `重複: ${rec.id} と近接 (filePath=${normalized}, startLine 差=${Math.abs(existingSl - sl)})`,
        };
      }
    }
    return null;
  },
};
```

`packages/ai-engine/src/duplicate-guards/index.ts` の末尾に register:

```typescript
import { coderefGuard } from './coderef';
registerGuard(coderefGuard);
```

- [ ] **Step 7-4: test pass**

Run: `pnpm -F @tally/ai-engine test -- duplicate-guards`

- [ ] **Step 7-5: commit**

```bash
git add packages/ai-engine/src/duplicate-guards/coderef.ts packages/ai-engine/src/duplicate-guards/coderef.test.ts packages/ai-engine/src/duplicate-guards/index.ts
git commit -m "feat(ai-engine): coderef 重複ガードを duplicate-guards/ に分離"
```

---

## Task 8: question guard を分離 (既存ロジック移行)

**Files:**
- Create: `packages/ai-engine/src/duplicate-guards/question.ts`
- Create: `packages/ai-engine/src/duplicate-guards/question.test.ts`
- Modify: `packages/ai-engine/src/duplicate-guards/index.ts`

- [ ] **Step 8-1: failing test**

```typescript
// packages/ai-engine/src/duplicate-guards/question.test.ts
import { describe, expect, it } from 'vitest';
import { questionGuard } from './question';
import type { DuplicateGuardContext } from './index';

function makeCtx(neighbors: any[], anchorId = 'anchor-1'): DuplicateGuardContext {
  return {
    store: {
      listNodes: async () => [],
      findRelatedNodes: async () => neighbors,
    } as any,
    anchorId,
    sessionMemo: new Set(),
  };
}

describe('questionGuard', () => {
  it('anchorId が空なら skip (null を返す)', async () => {
    const ctx = makeCtx([], '');
    const res = await questionGuard.check({ title: '[AI] Q', body: '', additional: undefined }, ctx);
    expect(res).toBeNull();
  });

  it('同 anchor に同タイトルが既にあれば重複', async () => {
    const ctx = makeCtx([
      { id: 'q1', type: 'question', title: 'どうするか', adoptAs: undefined },
    ]);
    const res = await questionGuard.check(
      { title: '[AI] どうするか', body: '', additional: undefined },
      ctx,
    );
    expect(res?.reason).toContain('q1');
  });

  it('sessionMemo に同 anchor+title が記録済みなら重複', async () => {
    const ctx = makeCtx([]);
    ctx.sessionMemo.add('anchor-1|どうするか');
    const res = await questionGuard.check(
      { title: '[AI] どうするか', body: '', additional: undefined },
      ctx,
    );
    expect(res?.reason).toContain('同一セッション');
  });
});
```

- [ ] **Step 8-2: test fail を確認**

Run: `pnpm -F @tally/ai-engine test -- duplicate-guards/question`

- [ ] **Step 8-3: 移行実装**

```typescript
// packages/ai-engine/src/duplicate-guards/question.ts
import { stripAiPrefix } from '@tally/core';
import type { DuplicateGuard } from './index';

export const questionGuard: DuplicateGuard = {
  adoptAs: 'question',
  async check(input, ctx) {
    // T1: anchorId が空なら anchor ベースのチェックは skip。
    // chat 経由では anchor が無いので、source-url guard が代わりに重複検知する。
    if (!ctx.anchorId) return null;

    const normalizedTitle = stripAiPrefix(input.title);
    const sessionKey = `${ctx.anchorId}|${normalizedTitle}`;
    if (ctx.sessionMemo.has(sessionKey)) {
      return {
        reason: `重複 (同一セッション内): anchor ${ctx.anchorId} に既に同タイトル question を生成済み`,
      };
    }

    const neighbors = await ctx.store.findRelatedNodes(ctx.anchorId);
    for (const n of neighbors) {
      const rec = n as unknown as { id: string; type: string; adoptAs?: string; title: string };
      const isQuestion =
        rec.type === 'question' || (rec.type === 'proposal' && rec.adoptAs === 'question');
      if (isQuestion && stripAiPrefix(rec.title) === normalizedTitle) {
        return {
          reason: `重複: anchor ${ctx.anchorId} に既に同タイトル question 候補 ${rec.id} が存在`,
        };
      }
    }
    return null;
  },
  onCreated(input, ctx) {
    if (!ctx.anchorId) return;
    const normalizedTitle = stripAiPrefix(input.title);
    ctx.sessionMemo.add(`${ctx.anchorId}|${normalizedTitle}`);
  },
};
```

`packages/ai-engine/src/duplicate-guards/index.ts` に register 追記:

```typescript
import { questionGuard } from './question';
registerGuard(questionGuard);
```

- [ ] **Step 8-4: test pass**

Run: `pnpm -F @tally/ai-engine test -- duplicate-guards`

- [ ] **Step 8-5: commit**

```bash
git add packages/ai-engine/src/duplicate-guards/question.ts packages/ai-engine/src/duplicate-guards/question.test.ts packages/ai-engine/src/duplicate-guards/index.ts
git commit -m "feat(ai-engine): question 重複ガードを duplicate-guards/ に分離 (anchorId 空は skip)"
```

---

## Task 9: source-url guard 追加 (T1 fix、chat anchor 無しでも動く)

**Files:**
- Create: `packages/ai-engine/src/duplicate-guards/source-url.ts`
- Create: `packages/ai-engine/src/duplicate-guards/source-url.test.ts`
- Modify: `packages/ai-engine/src/duplicate-guards/index.ts`

- [ ] **Step 9-1: failing test**

```typescript
// packages/ai-engine/src/duplicate-guards/source-url.test.ts
import { describe, expect, it } from 'vitest';
import { sourceUrlGuard } from './source-url';
import type { DuplicateGuardContext } from './index';

function makeCtx(nodes: any[]): DuplicateGuardContext {
  return {
    store: { listNodes: async () => nodes, findRelatedNodes: async () => [] } as any,
    anchorId: '',
    sessionMemo: new Set(),
  };
}

describe('sourceUrlGuard', () => {
  it('sourceUrl が additional に無ければ skip', async () => {
    const res = await sourceUrlGuard.check(
      { title: 'R', body: '', additional: undefined },
      makeCtx([]),
    );
    expect(res).toBeNull();
  });

  it('同 sourceUrl の requirement が既にあれば重複', async () => {
    const ctx = makeCtx([
      { id: 'r1', type: 'requirement', sourceUrl: 'https://jira.test/EPIC-1' },
    ]);
    const res = await sourceUrlGuard.check(
      {
        title: 'R', body: '',
        additional: { sourceUrl: 'https://jira.test/EPIC-1' },
      },
      ctx,
    );
    expect(res?.reason).toContain('r1');
  });

  it('proposal 段階の sourceUrl も重複検知対象', async () => {
    const ctx = makeCtx([
      {
        id: 'p1', type: 'proposal', adoptAs: 'requirement',
        sourceUrl: 'https://jira.test/EPIC-1',
      },
    ]);
    const res = await sourceUrlGuard.check(
      {
        title: 'R', body: '',
        additional: { sourceUrl: 'https://jira.test/EPIC-1' },
      },
      ctx,
    );
    expect(res?.reason).toContain('p1');
  });

  it('セッション内 sessionMemo でも重複検知', async () => {
    const ctx = makeCtx([]);
    ctx.sessionMemo.add('sourceUrl:https://jira.test/EPIC-1');
    const res = await sourceUrlGuard.check(
      { title: 'R', body: '', additional: { sourceUrl: 'https://jira.test/EPIC-1' } },
      ctx,
    );
    expect(res?.reason).toContain('同一セッション');
  });

  it('onCreated で sessionMemo 更新', async () => {
    const ctx = makeCtx([]);
    sourceUrlGuard.onCreated?.(
      { title: 'R', body: '', additional: { sourceUrl: 'https://jira.test/EPIC-1' } },
      ctx,
    );
    expect(ctx.sessionMemo.has('sourceUrl:https://jira.test/EPIC-1')).toBe(true);
  });
});
```

- [ ] **Step 9-2: test fail を確認**

Run: `pnpm -F @tally/ai-engine test -- duplicate-guards/source-url`

- [ ] **Step 9-3: 実装**

```typescript
// packages/ai-engine/src/duplicate-guards/source-url.ts
import type { DuplicateGuard } from './index';

// sourceUrl ベースの重複検知。
// anchor 不要 → chat (anchorId='') でも動く (T1 fix の核)。
// requirement / proposal(adoptAs=requirement) の全件スキャン。
export const sourceUrlGuard: DuplicateGuard = {
  adoptAs: 'requirement',
  async check(input, ctx) {
    const sourceUrl = input.additional?.sourceUrl;
    if (typeof sourceUrl !== 'string' || sourceUrl.length === 0) return null;

    const sessionKey = `sourceUrl:${sourceUrl}`;
    if (ctx.sessionMemo.has(sessionKey)) {
      return { reason: `重複 (同一セッション内): sourceUrl ${sourceUrl} を既に生成済み` };
    }

    const all = await ctx.store.listNodes();
    for (const n of all) {
      const rec = n as Record<string, unknown>;
      const type = rec.type as string | undefined;
      const adoptAs = rec.adoptAs as string | undefined;
      const isRequirement =
        type === 'requirement' || (type === 'proposal' && adoptAs === 'requirement');
      if (!isRequirement) continue;
      const existingUrl = rec.sourceUrl as string | undefined;
      if (existingUrl === sourceUrl) {
        return { reason: `重複: sourceUrl ${sourceUrl} は既に node ${rec.id} が保持` };
      }
    }
    return null;
  },
  onCreated(input, ctx) {
    const sourceUrl = input.additional?.sourceUrl;
    if (typeof sourceUrl === 'string' && sourceUrl.length > 0) {
      ctx.sessionMemo.add(`sourceUrl:${sourceUrl}`);
    }
  },
};
```

`packages/ai-engine/src/duplicate-guards/index.ts` に register 追記:

```typescript
import { sourceUrlGuard } from './source-url';
registerGuard(sourceUrlGuard);
```

- [ ] **Step 9-4: test pass**

Run: `pnpm -F @tally/ai-engine test -- duplicate-guards`

- [ ] **Step 9-5: commit**

```bash
git add packages/ai-engine/src/duplicate-guards/source-url.ts packages/ai-engine/src/duplicate-guards/source-url.test.ts packages/ai-engine/src/duplicate-guards/index.ts
git commit -m "feat(ai-engine): sourceUrl ベースの重複ガードを追加 (T1 fix: chat anchor 無しで動く)"
```

---

## Task 10: create-node を duplicate-guards に委譲

**Files:**
- Modify: `packages/ai-engine/src/tools/create-node.ts`
- Modify: `packages/ai-engine/src/tools/create-node.test.ts`

- [ ] **Step 10-1: failing test — source-url guard の動作と既存 coderef/question regression**

```typescript
// packages/ai-engine/src/tools/create-node.test.ts に追加:
it('sourceUrl 重複で 2 度目の作成は fail', async () => {
  // arrange: 既に sourceUrl を持つ proposal が 1 個存在
  const store = makeFakeStore({
    listNodes: async () => [
      {
        id: 'p1', type: 'proposal', adoptAs: 'requirement',
        sourceUrl: 'https://jira.test/EPIC-1',
      },
    ],
  });
  const handler = createNodeHandler({
    store, emit: () => {},
    anchor: { x: 0, y: 0 }, anchorId: '',
    agentName: 'ingest-document',
  });
  const res = await handler({
    adoptAs: 'requirement',
    title: 'R', body: '',
    additional: { sourceUrl: 'https://jira.test/EPIC-1' },
  });
  expect(res.ok).toBe(false);
  expect(res.output).toContain('sourceUrl');
});

it('既存 coderef 重複 test は引き続き pass (regression)', async () => {
  // ... 既存テストをそのまま
});

it('既存 question 重複 test (anchor あり) は引き続き pass (regression)', async () => {
  // ... 既存テストをそのまま
});
```

- [ ] **Step 10-2: test fail を確認**

Run: `pnpm -F @tally/ai-engine test -- create-node.test`

- [ ] **Step 10-3: create-node.ts を dispatcher に委譲するよう書き換え**

現在の `findDuplicateCoderef` / `sessionQuestionKeys` 関連ロジックを削除し、`dispatchDuplicateGuard` / `notifyCreated` を呼ぶ形に書き換える。normalizeFilePath は coderef guard 側に移したので、create-node で filePath 正規化する処理は「DB 保存前の正規化」目的で残す (guard 側と独立、重複して OK)。

```typescript
// packages/ai-engine/src/tools/create-node.ts の該当箇所書き換え
import {
  dispatchDuplicateGuard,
  notifyCreated,
  type DuplicateGuardContext,
} from '../duplicate-guards/index';

export function createNodeHandler(deps: CreateNodeDeps) {
  let nextOffsetIndex = 0;
  const sessionMemo = new Set<string>();

  return async (input: unknown): Promise<ToolResult> => {
    const parsed = CreateNodeInputSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, output: `invalid input: ${parsed.error.message}` };
    }
    const { adoptAs, title, body, x, y, additional } = parsed.data;

    // coderef の filePath 正規化 + codebaseId 注入 (保存前の integrity)
    let normalizedAdditional = additional;
    if (adoptAs === 'coderef') {
      const base = additional ?? {};
      const withCb: Record<string, unknown> =
        deps.codebaseId !== undefined && base.codebaseId === undefined
          ? { ...base, codebaseId: deps.codebaseId }
          : { ...base };
      const fp = withCb.filePath;
      if (typeof fp === 'string' && fp.length > 0) {
        withCb.filePath = normalizeFilePathForStorage(fp);
      }
      normalizedAdditional = withCb;
    }

    // question の options 正規化 + min 2 検証 (既存ロジック保持)
    if (adoptAs === 'question') {
      const rawOptions = additional?.options;
      const normalizedOptions = Array.isArray(rawOptions)
        ? rawOptions
            .map((opt) => {
              const text =
                typeof opt === 'object' && opt !== null && 'text' in opt
                  ? String((opt as { text: unknown }).text ?? '')
                  : String(opt ?? '');
              return { id: newQuestionOptionId(), text: text.trim(), selected: false };
            })
            .filter((o) => o.text.length > 0)
        : [];
      if (normalizedOptions.length < QUESTION_MIN_OPTIONS) {
        return {
          ok: false,
          output: `options は最低 ${QUESTION_MIN_OPTIONS} 個の非空 text を要求します (受け取り: ${normalizedOptions.length} 個)`,
        };
      }
      normalizedAdditional = {
        ...(additional ?? {}),
        options: normalizedOptions,
        decision: null,
      };
    }

    // duplicate-guards dispatch
    const guardCtx: DuplicateGuardContext = {
      store: deps.store,
      anchorId: deps.anchorId,
      sessionMemo,
      codebaseId: deps.codebaseId,
    };
    const dup = await dispatchDuplicateGuard(
      adoptAs,
      { title, body, additional: normalizedAdditional },
      guardCtx,
    );
    if (dup) return { ok: false, output: dup.reason };

    // 既存の ensureTitle + placement + addNode フロー (変更なし)
    const ensuredTitle = title.startsWith('[AI]') ? title : `[AI] ${title}`;
    const idx = nextOffsetIndex++;
    const placedX = x ?? deps.anchor.x + 260 + idx * 20;
    const placedY = y ?? deps.anchor.y + idx * 120;

    try {
      const created = (await deps.store.addNode({
        ...(normalizedAdditional ?? {}),
        type: 'proposal',
        x: placedX, y: placedY,
        title: ensuredTitle, body,
        adoptAs,
        sourceAgentId: deps.agentName,
      } as Parameters<typeof deps.store.addNode>[0])) as ProposalNode;
      deps.emit({ type: 'node_created', node: created });

      // 生成成功後、guard に通知 (sessionMemo 更新など)
      notifyCreated(
        adoptAs,
        { title, body, additional: normalizedAdditional },
        guardCtx,
      );
      return { ok: true, output: JSON.stringify(created) };
    } catch (err) {
      return { ok: false, output: `addNode failed: ${String(err)}` };
    }
  };
}

// 旧 normalizeFilePath を storage 用に残す (guard 側と独立)
function normalizeFilePathForStorage(fp: string): string {
  const stripped = fp.startsWith('./') ? fp.slice(2) : fp;
  return path.posix.normalize(stripped);
}
```

旧 `findDuplicateCoderef` 関数は削除 (coderef guard に移行済み)。

- [ ] **Step 10-4: test pass + regression**

Run: `pnpm -F @tally/ai-engine test -- create-node`
Expected: PASS 全件 (新規 sourceUrl test + 既存 coderef/question test)

- [ ] **Step 10-5: commit**

```bash
git add packages/ai-engine/src/tools/create-node.ts packages/ai-engine/src/tools/create-node.test.ts
git commit -m "refactor(ai-engine): create-node を duplicate-guards に委譲、sourceUrl guard を有効化"
```

---

## Task 11: ChatRunner — buildMcpServers 統合

**Files:**
- Modify: `packages/ai-engine/src/chat-runner.ts`
- Modify: `packages/ai-engine/src/chat-runner.test.ts`

- [ ] **Step 11-1: failing test — プロジェクトの mcpServers[] から外部 MCP が sdk.query に渡る**

```typescript
// chat-runner.test.ts に追加
it('プロジェクト設定の mcpServers[] を sdk.query に渡す', async () => {
  process.env.TEST_PAT = 'secret';
  const chatStore = new FileSystemChatStore(root);
  const projectStore = new FileSystemProjectStore(root);
  // saveProjectMeta で mcpServers を含めて保存
  await projectStore.saveProjectMeta({
    id: 'proj-1', name: 'P', codebases: [],
    mcpServers: [
      {
        id: 'test-mcp', name: 'T', kind: 'atlassian',
        url: 'https://t.test/mcp',
        auth: { type: 'pat', envVar: 'TEST_PAT' },
        options: { maxChildIssues: 30, maxCommentsPerIssue: 5 },
      },
    ],
    createdAt: '2026-04-24T00:00:00Z',
    updatedAt: '2026-04-24T00:00:00Z',
  });
  const thread = await chatStore.createChat({ projectId: 'proj-1', title: 't' });

  const querySpy = vi.fn(() =>
    (async function* () {
      yield { type: 'result', subtype: 'success', result: 'ok' } as unknown as SdkMessageLike;
    })(),
  );
  const sdk: SdkLike = { query: querySpy };
  const runner = new ChatRunner({
    sdk, chatStore, projectStore, projectDir: root, threadId: thread.id,
  });
  const events: ChatEvent[] = [];
  for await (const e of runner.runUserTurn('hi')) events.push(e);

  const callArg = querySpy.mock.calls[0][0] as any;
  expect(Object.keys(callArg.options.mcpServers)).toEqual(
    expect.arrayContaining(['tally', 'test-mcp']),
  );
  expect((callArg.options.mcpServers['test-mcp'] as any).headers.Authorization).toBe(
    'Bearer secret',
  );
  expect(callArg.options.allowedTools).toContain('mcp__tally__*');
  expect(callArg.options.allowedTools).toContain('mcp__test-mcp__*');
});

it('env 未設定ならエラーイベントを発火 (sdk.query は呼ばない)', async () => {
  delete process.env.MISSING_PAT;
  const chatStore = new FileSystemChatStore(root);
  const projectStore = new FileSystemProjectStore(root);
  await projectStore.saveProjectMeta({
    id: 'proj-1', name: 'P', codebases: [],
    mcpServers: [
      {
        id: 'a', name: 'A', kind: 'atlassian',
        url: 'https://t.test/mcp',
        auth: { type: 'pat', envVar: 'MISSING_PAT' },
        options: { maxChildIssues: 30, maxCommentsPerIssue: 5 },
      },
    ],
    createdAt: '2026-04-24T00:00:00Z', updatedAt: '2026-04-24T00:00:00Z',
  });
  const thread = await chatStore.createChat({ projectId: 'proj-1', title: 't' });

  const querySpy = vi.fn();
  const sdk: SdkLike = { query: querySpy };
  const runner = new ChatRunner({
    sdk, chatStore, projectStore, projectDir: root, threadId: thread.id,
  });
  const events: ChatEvent[] = [];
  for await (const e of runner.runUserTurn('hi')) events.push(e);

  expect(querySpy).not.toHaveBeenCalled();
  expect(events.some((e) => e.type === 'error' && /MISSING_PAT/.test(e.message))).toBe(true);
});
```

- [ ] **Step 11-2: test fail**

Run: `pnpm -F @tally/ai-engine test -- chat-runner`

- [ ] **Step 11-3: ChatRunner.runUserTurn を書き換え**

`runUserTurn` の step 5 (sdkDone IIFE) 冒頭で buildMcpServers を呼び、エラー時は error event を push して early return:

```typescript
// chat-runner.ts の runUserTurn 内
import { buildMcpServers } from './mcp/build-mcp-servers';
import { redactMcpSecrets } from './mcp/redact';

// ... (既存の step 1-4 は維持)

// プロジェクトから最新の mcpServers[] を取得 (run ごとにホットリロード)
const projectMeta = await projectStore.getProjectMeta();
const externalConfigs = projectMeta?.mcpServers ?? [];

let mcpServers: Record<string, unknown>;
let allowedTools: string[];
try {
  const built = buildMcpServers({ tallyMcp: mcp, configs: externalConfigs });
  mcpServers = built.mcpServers;
  allowedTools = built.allowedTools;
} catch (err) {
  yield { type: 'error', code: 'mcp_config_invalid', message: String(err) };
  return;
}

// ... sdkDone IIFE 内の sdk.query options を差し替え
const iter = sdk.query({
  prompt,
  options: {
    systemPrompt,
    mcpServers,  // 動的生成
    tools: [],
    allowedTools,  // 動的生成
    permissionMode: 'dontAsk',
    settingSources: [],
    cwd: projectDir,
    // ... (既存 CLAUDE_CODE_PATH 処理)
  },
});

// 既存 console.log は redaction 経由に
console.log('[chat-runner] sdk msg:', JSON.stringify(redactMcpSecrets(msg)).slice(0, 200));
```

- [ ] **Step 11-4: test pass + regression (text-only / invokeInterceptedTool テスト)**

Run: `pnpm -F @tally/ai-engine test -- chat-runner`
Expected: PASS 全件 (新規 2 件 + 既存 3 件)

- [ ] **Step 11-5: commit**

```bash
git add packages/ai-engine/src/chat-runner.ts packages/ai-engine/src/chat-runner.test.ts
git commit -m "feat(ai-engine): ChatRunner が buildMcpServers で外部 MCP を合成するように変更"
```

---

## Task 12: ChatRunner — extractAssistantBlocks + 外部 tool_use 永続化

**Files:**
- Modify: `packages/ai-engine/src/chat-runner.ts`
- Modify: `packages/ai-engine/src/chat-runner.test.ts`

- [ ] **Step 12-1: failing test — 外部 MCP の tool_use block が source='external' で永続化される**

```typescript
it('SDK から来た外部 tool_use/tool_result は source=external で chatStore に append', async () => {
  process.env.TEST_PAT = 'secret';
  const chatStore = new FileSystemChatStore(root);
  const projectStore = new FileSystemProjectStore(root);
  await projectStore.saveProjectMeta({
    id: 'proj-1', name: 'P', codebases: [],
    mcpServers: [
      {
        id: 'atlassian', name: 'A', kind: 'atlassian',
        url: 'https://t.test/mcp',
        auth: { type: 'pat', envVar: 'TEST_PAT' },
        options: { maxChildIssues: 30, maxCommentsPerIssue: 5 },
      },
    ],
    createdAt: '2026-04-24T00:00:00Z', updatedAt: '2026-04-24T00:00:00Z',
  });
  const thread = await chatStore.createChat({ projectId: 'proj-1', title: 't' });

  const sdk: SdkLike = {
    query: () =>
      (async function* () {
        yield {
          type: 'assistant',
          message: {
            content: [
              { type: 'text', text: 'Jira を読みます' },
              {
                type: 'tool_use',
                id: 'atlassian-tu-1',
                name: 'mcp__atlassian__getJiraIssue',
                input: { key: 'EPIC-1' },
              },
            ],
          },
        } as unknown as SdkMessageLike;
        yield {
          type: 'user',
          message: {
            content: [
              {
                type: 'tool_result',
                tool_use_id: 'atlassian-tu-1',
                content: [{ type: 'text', text: '{"summary":"Epic title"}' }],
              },
            ],
          },
        } as unknown as SdkMessageLike;
        yield { type: 'result', subtype: 'success', result: 'ok' } as unknown as SdkMessageLike;
      })(),
  };
  const runner = new ChatRunner({
    sdk, chatStore, projectStore, projectDir: root, threadId: thread.id,
  });
  for await (const _ of runner.runUserTurn('@JIRA EPIC-1 を読んで')) {}

  const reloaded = await chatStore.getChat(thread.id);
  const asstMsg = reloaded?.messages.find((m) => m.role === 'assistant');
  const toolUse = asstMsg?.blocks.find((b) => b.type === 'tool_use') as any;
  expect(toolUse.source).toBe('external');
  expect(toolUse.name).toBe('mcp__atlassian__getJiraIssue');
  expect(toolUse.approval).toBeUndefined();

  const toolResult = asstMsg?.blocks.find((b) => b.type === 'tool_result') as any;
  expect(toolResult.ok).toBe(true);
  expect(toolResult.output).toContain('Epic title');
});
```

- [ ] **Step 12-2: test fail**

Run: `pnpm -F @tally/ai-engine test -- chat-runner`

- [ ] **Step 12-3: 実装 — extractAssistantBlocks を拡張**

```typescript
// chat-runner.ts の下部 helper 書き換え
type ExtractedBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; toolUseId: string; name: string; input: unknown }
  | { type: 'tool_result'; toolUseId: string; ok: boolean; output: string };

// SDK から流れてくる assistant message + user message (tool_result を含む) から block 抽出。
// Tally MCP の tool_use は MCP handler が処理するので、ここでは外部 MCP (mcp__<name>__*
// で name !== 'tally') のものだけ拾う。
function extractExternalBlocks(msg: SdkMessageLike): ExtractedBlock[] {
  const m = msg as unknown as { type?: string; message?: { content?: unknown[] } };
  if ((m.type !== 'assistant' && m.type !== 'user') || !m.message?.content) return [];
  const out: ExtractedBlock[] = [];
  for (const block of m.message.content) {
    const b = block as {
      type?: string;
      text?: string;
      id?: string;
      name?: string;
      input?: unknown;
      tool_use_id?: string;
      content?: Array<{ type?: string; text?: string }>;
      is_error?: boolean;
    };
    if (b.type === 'text' && typeof b.text === 'string' && m.type === 'assistant') {
      out.push({ type: 'text', text: b.text });
    } else if (
      b.type === 'tool_use' &&
      typeof b.id === 'string' &&
      typeof b.name === 'string' &&
      !b.name.startsWith('mcp__tally__')  // Tally MCP は intercept 経路
    ) {
      out.push({
        type: 'tool_use',
        toolUseId: b.id,
        name: b.name,
        input: b.input,
      });
    } else if (
      b.type === 'tool_result' &&
      typeof b.tool_use_id === 'string' &&
      Array.isArray(b.content)
    ) {
      const text = b.content
        .filter((c) => c.type === 'text' && typeof c.text === 'string')
        .map((c) => c.text)
        .join('');
      out.push({
        type: 'tool_result',
        toolUseId: b.tool_use_id,
        ok: !b.is_error,
        output: text,
      });
    }
  }
  return out;
}
```

`runUserTurn` 内 SDK iterate loop を書き換え:

```typescript
for await (const msg of iter) {
  console.log('[chat-runner] sdk msg:', JSON.stringify(redactMcpSecrets(msg)).slice(0, 200));
  const blocks = extractExternalBlocks(msg);
  for (const b of blocks) {
    if (b.type === 'text') {
      textBuffer.push(b.text);
      queue.push({ type: 'chat_text_delta', messageId: assistantMsgId, text: b.text });
    } else if (b.type === 'tool_use') {
      // 外部 MCP の tool_use: 永続化 + UI 通知 (承認なし)
      await chatStore.appendBlockToMessage(threadId, assistantMsgId, {
        type: 'tool_use',
        toolUseId: b.toolUseId,
        name: b.name,
        input: b.input,
        source: 'external',
      });
      queue.push({
        type: 'chat_tool_external_use',
        messageId: assistantMsgId,
        toolUseId: b.toolUseId,
        name: b.name,
        input: b.input,
      });
    } else if (b.type === 'tool_result') {
      await chatStore.appendBlockToMessage(threadId, assistantMsgId, {
        type: 'tool_result',
        toolUseId: b.toolUseId,
        ok: b.ok,
        output: b.output,
      });
      queue.push({
        type: 'chat_tool_external_result',
        messageId: assistantMsgId,
        toolUseId: b.toolUseId,
        ok: b.ok,
        output: b.output,
      });
    }
  }
}
```

`packages/ai-engine/src/stream.ts` に新 event を追加:

```typescript
| { type: 'chat_tool_external_use'; messageId: string; toolUseId: string; name: string; input: unknown }
| { type: 'chat_tool_external_result'; messageId: string; toolUseId: string; ok: boolean; output: string }
```

- [ ] **Step 12-4: test pass**

Run: `pnpm -F @tally/ai-engine test -- chat-runner`

- [ ] **Step 12-5: commit**

```bash
git add packages/ai-engine/src/chat-runner.ts packages/ai-engine/src/chat-runner.test.ts packages/ai-engine/src/stream.ts
git commit -m "feat(ai-engine): ChatRunner が外部 MCP の tool_use/tool_result を source=external で永続化"
```

---

## Task 13: ChatRunner — tool_result 4KB truncate (永続化時のみ)

**Files:**
- Modify: `packages/ai-engine/src/chat-runner.ts`
- Modify: `packages/ai-engine/src/chat-runner.test.ts`

- [ ] **Step 13-1: failing test**

```typescript
it('tool_result output が 4KB 超えると永続化時に truncate、event は full', async () => {
  process.env.TEST_PAT = 'secret';
  const chatStore = new FileSystemChatStore(root);
  const projectStore = new FileSystemProjectStore(root);
  await projectStore.saveProjectMeta({
    id: 'proj-1', name: 'P', codebases: [],
    mcpServers: [
      {
        id: 'atlassian', name: 'A', kind: 'atlassian',
        url: 'https://t.test/mcp',
        auth: { type: 'pat', envVar: 'TEST_PAT' },
        options: { maxChildIssues: 30, maxCommentsPerIssue: 5 },
      },
    ],
    createdAt: '2026-04-24T00:00:00Z', updatedAt: '2026-04-24T00:00:00Z',
  });
  const thread = await chatStore.createChat({ projectId: 'proj-1', title: 't' });
  const bigOutput = 'X'.repeat(10_000);
  const sdk: SdkLike = {
    query: () =>
      (async function* () {
        yield {
          type: 'user',
          message: {
            content: [
              { type: 'tool_result', tool_use_id: 'big-1', content: [{ type: 'text', text: bigOutput }] },
            ],
          },
        } as unknown as SdkMessageLike;
        yield { type: 'result', subtype: 'success', result: 'ok' } as unknown as SdkMessageLike;
      })(),
  };
  const runner = new ChatRunner({
    sdk, chatStore, projectStore, projectDir: root, threadId: thread.id,
  });
  const events: ChatEvent[] = [];
  for await (const e of runner.runUserTurn('q')) events.push(e);

  // event には full output
  const evt = events.find((e) => e.type === 'chat_tool_external_result') as any;
  expect(evt.output.length).toBe(10_000);

  // YAML 永続化は truncate
  const reloaded = await chatStore.getChat(thread.id);
  const tr = reloaded?.messages
    .flatMap((m) => m.blocks)
    .find((b) => b.type === 'tool_result') as any;
  expect(tr.output.length).toBeLessThanOrEqual(4200);  // 4KB + marker 余裕
  expect(tr.output).toContain('(truncated');
});
```

- [ ] **Step 13-2: test fail**

Run: `pnpm -F @tally/ai-engine test -- chat-runner`

- [ ] **Step 13-3: 実装 — truncate ロジック**

chat-runner.ts の tool_result 永続化箇所を修正:

```typescript
const TOOL_RESULT_PERSIST_LIMIT = 4096;

function truncateForPersistence(output: string): string {
  if (output.length <= TOOL_RESULT_PERSIST_LIMIT) return output;
  const head = output.slice(0, TOOL_RESULT_PERSIST_LIMIT);
  return `${head}\n... (truncated, ${output.length} chars total)`;
}

// tool_result append:
await chatStore.appendBlockToMessage(threadId, assistantMsgId, {
  type: 'tool_result',
  toolUseId: b.toolUseId,
  ok: b.ok,
  output: truncateForPersistence(b.output),
});
// event は full を流す:
queue.push({
  type: 'chat_tool_external_result',
  messageId: assistantMsgId,
  toolUseId: b.toolUseId,
  ok: b.ok,
  output: b.output,
});
```

- [ ] **Step 13-4: test pass**

Run: `pnpm -F @tally/ai-engine test -- chat-runner`

- [ ] **Step 13-5: commit**

```bash
git add packages/ai-engine/src/chat-runner.ts packages/ai-engine/src/chat-runner.test.ts
git commit -m "feat(ai-engine): tool_result output を永続化時 4KB に truncate (event はフル)"
```

---

## Task 14: ChatRunner — buildChatPrompt が tool_use/tool_result を replay (T4 fix)

**Files:**
- Modify: `packages/ai-engine/src/chat-runner.ts`
- Modify: `packages/ai-engine/src/chat-runner.test.ts`

- [ ] **Step 14-1: failing test — multi-turn で前ターンの tool_result が prompt に含まれる**

```typescript
it('buildChatPrompt が tool_use と tool_result も replay する', async () => {
  const chatStore = new FileSystemChatStore(root);
  const projectStore = new FileSystemProjectStore(root);
  const thread = await chatStore.createChat({ projectId: 'proj-1', title: 't' });
  // 1 ターン目: user + assistant (tool_use + tool_result + text)
  await chatStore.appendMessage(thread.id, {
    id: 'u1', role: 'user',
    blocks: [{ type: 'text', text: '@JIRA EPIC-1 を読んで' }],
    createdAt: '2026-04-24T00:00:00Z',
  });
  await chatStore.appendMessage(thread.id, {
    id: 'a1', role: 'assistant',
    blocks: [
      { type: 'text', text: 'Jira を読みます' },
      {
        type: 'tool_use', toolUseId: 'tu-1',
        name: 'mcp__atlassian__getJiraIssue', input: { key: 'EPIC-1' },
        source: 'external',
      },
      { type: 'tool_result', toolUseId: 'tu-1', ok: true, output: '{"summary":"Epic X"}' },
      { type: 'text', text: '読みました。Epic X です' },
    ],
    createdAt: '2026-04-24T00:01:00Z',
  });

  // 2 ターン目: 新しい user message
  await chatStore.appendMessage(thread.id, {
    id: 'u2', role: 'user',
    blocks: [{ type: 'text', text: '続けて子チケット STORY-42 を読んで' }],
    createdAt: '2026-04-24T00:02:00Z',
  });

  // buildChatPrompt を直接 import (export 必要)
  const reloaded = await chatStore.getChat(thread.id);
  const prompt = buildChatPromptForTest(reloaded!.messages);

  // 過去 tool_use / tool_result が含まれる
  expect(prompt).toContain('Epic X');
  expect(prompt).toContain('getJiraIssue');
  // 直近 user が current message として出る
  expect(prompt).toContain('STORY-42');
});
```

`chat-runner.ts` の `buildChatPrompt` を export に変更する必要がある (或いは test 用に関数エクスポート)。

- [ ] **Step 14-2: test fail**

Run: `pnpm -F @tally/ai-engine test -- chat-runner`

- [ ] **Step 14-3: buildChatPrompt を拡張**

```typescript
// chat-runner.ts の buildChatPrompt 書き換え、export を追加
export function buildChatPromptForTest(messages: ChatMessage[]): string {
  return buildChatPrompt(messages);
}

function buildChatPrompt(messages: ChatMessage[]): string {
  const lines: string[] = [];
  const last = messages[messages.length - 1];
  const past = last?.role === 'user' ? messages.slice(0, -1) : messages;

  if (past.length > 0) {
    lines.push('<conversation_history>');
    for (const m of past) {
      lines.push(`<message role="${m.role}">`);
      for (const b of m.blocks) {
        if (b.type === 'text') {
          lines.push(b.text);
        } else if (b.type === 'tool_use') {
          const srcTag = (b as any).source === 'external' ? ' source="external"' : '';
          lines.push(
            `<tool_use id="${b.toolUseId}" name="${b.name}"${srcTag}>${JSON.stringify(b.input)}</tool_use>`,
          );
        } else if (b.type === 'tool_result') {
          lines.push(
            `<tool_result id="${b.toolUseId}" ok="${b.ok}">${b.output}</tool_result>`,
          );
        }
      }
      lines.push(`</message>`);
    }
    lines.push('</conversation_history>');
  }

  if (last && last.role === 'user') {
    const texts = last.blocks
      .filter((b): b is Extract<ChatBlock, { type: 'text' }> => b.type === 'text')
      .map((b) => b.text);
    lines.push('<current_user_message>');
    lines.push(texts.join('\n'));
    lines.push('</current_user_message>');
  }

  return lines.join('\n');
}
```

- [ ] **Step 14-4: test pass + multi-turn E2E (runUserTurn 2 回) の regression なし**

Run: `pnpm -F @tally/ai-engine test -- chat-runner`

- [ ] **Step 14-5: commit**

```bash
git add packages/ai-engine/src/chat-runner.ts packages/ai-engine/src/chat-runner.test.ts
git commit -m "feat(ai-engine): buildChatPrompt が tool_use/tool_result も replay (T4 fix: multi-turn で context 保持)"
```

---

## Task 15: agent-runner — buildMcpServers 共有 + regression snapshot

**Files:**
- Modify: `packages/ai-engine/src/agent-runner.ts`
- Modify: `packages/ai-engine/src/agent-runner.test.ts`

- [ ] **Step 15-1: failing test — プロジェクトの mcpServers[] が agent-runner でも外部 MCP として渡る**

```typescript
// agent-runner.test.ts
it('プロジェクト mcpServers[] が sdk.query に渡る (agent-runner も外部 MCP 合成)', async () => {
  process.env.TEST_PAT = 'secret';
  const store = makeProjectStoreWithMeta({
    mcpServers: [
      {
        id: 'atlassian', name: 'A', kind: 'atlassian',
        url: 'https://t.test/mcp',
        auth: { type: 'pat', envVar: 'TEST_PAT' },
        options: { maxChildIssues: 30, maxCommentsPerIssue: 5 },
      },
    ],
  });
  const querySpy = vi.fn(() =>
    (async function* () {
      yield { type: 'result', subtype: 'success', result: 'ok' } as unknown as SdkMessageLike;
    })(),
  );
  const sdk: SdkLike = { query: querySpy };
  // 既存 agent (extract-questions) で試行
  await runAgent({
    sdk, store, agentName: 'extract-questions', input: { nodeId: 'n-anchor' },
    projectDir: root,
  });
  const call = querySpy.mock.calls[0][0] as any;
  expect(Object.keys(call.options.mcpServers)).toEqual(expect.arrayContaining(['tally', 'atlassian']));
});
```

- [ ] **Step 15-2: test fail**

Run: `pnpm -F @tally/ai-engine test -- agent-runner`

- [ ] **Step 15-3: agent-runner.ts の sdk.query options を buildMcpServers 経由にする**

`packages/ai-engine/src/agent-runner.ts:114` 周辺を書き換え:

```typescript
import { buildMcpServers } from './mcp/build-mcp-servers';
import { redactMcpSecrets } from './mcp/redact';

// runAgent 内で project meta を取得 → buildMcpServers
const projectMeta = await store.getProjectMeta();
const externalConfigs = projectMeta?.mcpServers ?? [];
const { mcpServers, allowedTools: externalAllowed } = buildMcpServers({
  tallyMcp: mcp,
  configs: externalConfigs,
});

// agent の allowedTools + 外部 MCP allowedTools を合成
const finalAllowedTools = [
  ...agentDef.allowedTools,
  ...externalAllowed.filter((t) => t !== 'mcp__tally__*'), // agentDef 側に既に具体指定あれば dedup
];

const iter = sdk.query({
  prompt,
  options: {
    systemPrompt,
    mcpServers,
    tools: [],
    allowedTools: finalAllowedTools,
    permissionMode: 'dontAsk',
    settingSources: [],
    cwd: agentCwd,
    // ...
  },
});

// ログ redaction
console.log('[agent-runner] msg:', JSON.stringify(redactMcpSecrets(msg)).slice(0, 200));
```

- [ ] **Step 15-4: regression snapshot — 既存 5 agent の動作不変**

各 agent (decompose-to-stories / extract-questions / find-related-code / analyze-impact / ingest-document) に対して:
- mcpServers[] 空のプロジェクトで runAgent を走らせる
- sdk.query に渡る mcpServers が `{ tally }` のみ
- allowedTools が既存 agentDef.allowedTools と一致
- agent event の emit シーケンスが不変

```typescript
it.each([
  'decompose-to-stories',
  'extract-questions',
  'find-related-code',
  'analyze-impact',
  'ingest-document',
] as const)('%s は mcpServers[] 空で既存動作不変', async (agentName) => {
  // ... 各 agent に最小 valid input を渡し、sdk.query の options snapshot を記録
  // 期待: mcpServers = { tally }, allowedTools = agentDef.allowedTools (外部 MCP 合成なし)
});
```

- [ ] **Step 15-5: test pass**

Run: `pnpm -F @tally/ai-engine test`

- [ ] **Step 15-6: commit**

```bash
git add packages/ai-engine/src/agent-runner.ts packages/ai-engine/src/agent-runner.test.ts
git commit -m "feat(ai-engine): agent-runner を buildMcpServers に統合 (chat-runner と共有、5 agent regression OK)"
```

---

## Task 16: プロジェクト設定 API — mcpServers round-trip

**Files:**
- Modify: `packages/frontend/src/app/api/projects/[id]/route.ts`
- Modify: `packages/frontend/src/lib/api.ts`
- Test: `packages/frontend/src/app/api/projects/[id]/route.test.ts` (既存 or 新規)

- [ ] **Step 16-1: failing test — GET/PUT で mcpServers を round-trip**

```typescript
// packages/frontend/src/app/api/projects/[id]/route.test.ts
it('PUT with mcpServers → GET で同じ mcpServers が返る', async () => {
  // ... test setup
  const putRes = await PUT(/* ... */, {
    params: { id: 'proj-1' },
    body: {
      // 既存 project fields
      mcpServers: [
        {
          id: 'atlassian', name: 'A', kind: 'atlassian',
          url: 'https://t.test/mcp',
          auth: { type: 'pat', envVar: 'ATLASSIAN_PAT' },
          options: { maxChildIssues: 30, maxCommentsPerIssue: 5 },
        },
      ],
    },
  });
  expect(putRes.status).toBe(200);

  const getRes = await GET(/* ... */, { params: { id: 'proj-1' } });
  const json = await getRes.json();
  expect(json.mcpServers).toHaveLength(1);
  expect(json.mcpServers[0].auth.envVar).toBe('ATLASSIAN_PAT');
});
```

- [ ] **Step 16-2: test fail (まだ route.ts が mcpServers を受けない)**

- [ ] **Step 16-3: route.ts を修正**

既存 PUT handler のバリデーションに `mcpServers: McpServerConfig[]` を含めた入力受付を追加。既存 ProjectSchema/ProjectMetaSchema 経由で zod parse が自動的に mcpServers を受けるようになっている (Task 2 で default [] を追加済み) ため、handler 側は明示フィールド追加不要の可能性あり。それでも入力 shape を再確認:

```typescript
// route.ts の PUT 内
const body = await request.json();
const parsed = UpdateProjectInputSchema.parse(body);
// parsed.mcpServers が自動で入る
await projectStore.saveProjectMeta({
  ...existingMeta,
  name: parsed.name ?? existingMeta.name,
  codebases: parsed.codebases ?? existingMeta.codebases,
  mcpServers: parsed.mcpServers ?? existingMeta.mcpServers ?? [],
  updatedAt: new Date().toISOString(),
});
```

`packages/frontend/src/lib/api.ts` の UpdateProjectInput 型 (または zod schema) に mcpServers を追加:

```typescript
export const UpdateProjectInputSchema = z.object({
  name: z.string().optional(),
  codebases: z.array(CodebaseSchema).optional(),
  mcpServers: z.array(McpServerConfigSchema).optional(),
});
```

- [ ] **Step 16-4: test pass**

Run: `pnpm -F @tally/frontend test`

- [ ] **Step 16-5: commit**

```bash
git add packages/frontend/src/app/api/projects/ packages/frontend/src/lib/api.ts
git commit -m "feat(frontend): projects API が mcpServers[] を受け取る"
```

---

## Task 17: 設定ダイアログ UI — mcpServers CRUD

**Files:**
- Modify: `packages/frontend/src/components/dialog/project-settings-dialog.tsx`
- Test: `packages/frontend/src/components/dialog/project-settings-dialog.test.tsx`

- [ ] **Step 17-1: failing test — mcpServers セクションの CRUD**

```typescript
it('mcpServers[] セクションで新規追加 → name/url/envVar 入力 → 保存 → 再表示で復元', async () => {
  const onSave = vi.fn();
  const { getByText, getByLabelText } = render(
    <ProjectSettingsDialog project={{ /* ... */ mcpServers: [] }} onSave={onSave} />,
  );
  fireEvent.click(getByText('MCP サーバーを追加'));
  fireEvent.change(getByLabelText('表示名'), { target: { value: 'Atlassian' } });
  fireEvent.change(getByLabelText('URL'), { target: { value: 'https://t.test/mcp' } });
  fireEvent.change(getByLabelText('環境変数名'), { target: { value: 'ATLASSIAN_PAT' } });
  fireEvent.click(getByText('保存'));
  expect(onSave).toHaveBeenCalledWith(
    expect.objectContaining({
      mcpServers: [
        expect.objectContaining({
          name: 'Atlassian',
          url: 'https://t.test/mcp',
          auth: expect.objectContaining({ envVar: 'ATLASSIAN_PAT' }),
        }),
      ],
    }),
  );
});

it('secret 値 (PAT) の入力欄は表示しない', () => {
  const { queryByText, queryByLabelText } = render(
    <ProjectSettingsDialog project={{ mcpServers: [/* ... */] }} onSave={() => {}} />,
  );
  expect(queryByLabelText('PAT')).toBeNull();
  expect(queryByLabelText('シークレット')).toBeNull();
  expect(queryByText(/\.env/)).toBeTruthy(); // 「PAT は .env ファイルに置いてください」的な説明
});
```

- [ ] **Step 17-2: test fail**

- [ ] **Step 17-3: 実装 — ダイアログに mcpServers セクションを追加**

既存の project-settings-dialog.tsx に新セクション:

```tsx
// ProjectSettingsDialog 内の JSX
<section>
  <h3>MCP サーバー (外部連携)</h3>
  <p>
    AI が外部の情報源にアクセスするための接続先。
    秘密値 (PAT など) はこのフォームではなく .env ファイルに置いてください
    (例: <code>ATLASSIAN_PAT=...</code>)。
  </p>
  {mcpServers.map((s, i) => (
    <div key={s.id} style={{ border: '1px solid #ccc', padding: 8, marginBottom: 8 }}>
      <input
        aria-label="ID"
        value={s.id}
        onChange={(e) => updateMcpServer(i, { ...s, id: e.target.value })}
      />
      <input
        aria-label="表示名"
        value={s.name}
        onChange={(e) => updateMcpServer(i, { ...s, name: e.target.value })}
      />
      <select
        aria-label="種別"
        value={s.kind}
        onChange={(e) => updateMcpServer(i, { ...s, kind: e.target.value as 'atlassian' })}
      >
        <option value="atlassian">Atlassian</option>
      </select>
      <input
        aria-label="URL"
        value={s.url}
        onChange={(e) => updateMcpServer(i, { ...s, url: e.target.value })}
      />
      <input
        aria-label="環境変数名"
        value={s.auth.envVar}
        placeholder="ATLASSIAN_PAT"
        onChange={(e) =>
          updateMcpServer(i, { ...s, auth: { ...s.auth, envVar: e.target.value } })
        }
      />
      <button onClick={() => removeMcpServer(i)}>削除</button>
    </div>
  ))}
  <button onClick={addMcpServer}>MCP サーバーを追加</button>
</section>
```

`addMcpServer`, `updateMcpServer`, `removeMcpServer` は local state handler。保存時に `onSave({ ..., mcpServers })` を呼ぶ。

- [ ] **Step 17-4: test pass**

Run: `pnpm -F @tally/frontend test`

- [ ] **Step 17-5: commit**

```bash
git add packages/frontend/src/components/dialog/
git commit -m "feat(frontend): プロジェクト設定に MCP サーバー CRUD UI を追加 (secret は .env で管理)"
```

---

## Task 18: Chat UI — source 分岐 (external は承認 UI 出さない)

**Files:**
- Modify: `packages/frontend/src/components/chat/tool-approval-card.tsx`
- Modify: `packages/frontend/src/components/chat/chat-tab.tsx`
- Test: 各 test

- [ ] **Step 18-1: failing test — external tool_use は承認ボタンが出ない**

```typescript
// tool-approval-card.test.tsx
it('source=external の tool_use は承認ボタンを表示しない', () => {
  const { queryByText, getByText } = render(
    <ToolApprovalCard
      block={{
        type: 'tool_use',
        toolUseId: 'tu-1',
        name: 'mcp__atlassian__getJiraIssue',
        input: { key: 'EPIC-1' },
        source: 'external',
      }}
      onApprove={() => {}}
      onReject={() => {}}
    />,
  );
  expect(queryByText('承認')).toBeNull();
  expect(queryByText('却下')).toBeNull();
  expect(getByText(/getJiraIssue/)).toBeTruthy(); // AI が読んだ外部ソース表示
});

it('source=internal (approval=pending) の tool_use は承認ボタンが出る (既存挙動 regression)', () => {
  const { getByText } = render(
    <ToolApprovalCard
      block={{
        type: 'tool_use', toolUseId: 'tu-2',
        name: 'mcp__tally__create_node', input: {},
        source: 'internal', approval: 'pending',
      }}
      onApprove={() => {}}
      onReject={() => {}}
    />,
  );
  expect(getByText('承認')).toBeTruthy();
});
```

- [ ] **Step 18-2: test fail**

- [ ] **Step 18-3: tool-approval-card.tsx を source 分岐**

```tsx
export function ToolApprovalCard({ block, onApprove, onReject }: Props) {
  if (block.source === 'external') {
    return (
      <div style={{ border: '1px solid #aaa', padding: 8, background: '#f5f5ff' }}>
        <details>
          <summary>🔗 外部ソース: {block.name}</summary>
          <pre>{JSON.stringify(block.input, null, 2)}</pre>
        </details>
      </div>
    );
  }
  // 既存 internal + approval=pending/approved/rejected 表示 (変更なし)
  return <div>{/* 既存 JSX */}</div>;
}
```

- [ ] **Step 18-4: chat-tab.tsx で external tool_result を折り畳み表示**

chat-tab.tsx 内 block レンダリング箇所:

```tsx
{block.type === 'tool_result' && (
  <details>
    <summary>tool_result ({block.ok ? 'OK' : 'ERROR'})</summary>
    <pre style={{ whiteSpace: 'pre-wrap', maxHeight: 400, overflow: 'auto' }}>
      {block.output}
    </pre>
  </details>
)}
```

- [ ] **Step 18-5: test pass**

Run: `pnpm -F @tally/frontend test`

- [ ] **Step 18-6: commit**

```bash
git add packages/frontend/src/components/chat/
git commit -m "feat(frontend): Chat UI が外部 MCP の tool_use/tool_result を折り畳み表示 (承認ボタン非表示)"
```

---

## Task 19: Dogfooding Protocol (手動、実装ではなく運用手順)

**Files:**
- Create: `docs/superpowers/plans/2026-04-24-atlassian-mcp-c-phase-dogfood-log.md`

これは実装タスクではない。Task 1-18 完了後、自分の手元で 10 個の Jira エピックを使って動作確認し、Success Criteria を測る。plan ではこの手順だけを明記する。

- [ ] **Step 19-1: dogfooding log ファイルを作成**

```bash
cat > docs/superpowers/plans/2026-04-24-atlassian-mcp-c-phase-dogfood-log.md <<'EOF'
# Dogfood Log — Atlassian MCP C フェーズ

## Setup
- .env に `ATLASSIAN_PAT=<your PAT>` を設定
- プロジェクト設定で MCP サーバー追加: kind=atlassian, url=<your MCP URL>, envVar=ATLASSIAN_PAT

## Epic 1-10
### Epic N: <JIRA-KEY>
- **Turn 1:** `@JIRA <JIRA-KEY> を読んで論点を出して`
  - 生成 question proposal: N 個
  - 所要時間: <秒>
  - 採用: <N 個>、却下: <N 個>
  - 採用判断の理由:
- **Turn 2 (multi-turn test):** `続けて子チケット <STORY-KEY> を読んで論点を追加して`
  - AI が前ターンの Epic 内容を覚えているか: YES / NO
  - 生成 question proposal: N 個
  - 採用: <N 個>
- **「気づかなかった論点」判定:** YES / NO、YES なら具体:
- **重複ガード動作:** 同 URL 2 度目取り込み → sourceUrl guard 発動: YES / NO

## 集計
- 合計生成 question proposal: N 個
- 合計採用数: N 個
- 採用率: N% (target: 50%+)
- 「気づかなかった論点」合計: N 件 (target: 3+)
- multi-turn が機能した Epic: N/10 (target: 10/10)
- 重複ガード発動数 / 試行数: N/N

## 観察メモ (A フェーズの ingest-jira-epic プロンプト設計の入力)
- プロンプト改善点:
- tool 呼び出しパターン:
- レイテンシ分布:
- 失敗パターン (接続失敗 / rate limit / タイムアウト):
EOF
```

- [ ] **Step 19-2: 実際に 10 epic で dogfood**

ユーザーが手元で実施、上記 log に記録。

- [ ] **Step 19-3: Success Criteria 判定**

C フェーズの Success Criteria:
- 90 秒以内に question proposal 3 個以上 (all 10 epics で満たすこと)
- 採用率 50%+
- 「気づかなかった論点」3+ 件
- multi-turn での context 保持

満たせば A フェーズへ。満たさなければ Task 1-18 のどこかに追加修正。

- [ ] **Step 19-4: commit (dogfood log)**

```bash
git add docs/superpowers/plans/2026-04-24-atlassian-mcp-c-phase-dogfood-log.md
git commit -m "docs: Atlassian MCP C フェーズ dogfood log を記録"
```

---

## Final Verification

C フェーズ完了条件:

- [ ] `pnpm test` 全パッケージ PASS
- [ ] `pnpm -F @tally/ai-engine test` の既存 agent 5 個 (decompose-to-stories / extract-questions / find-related-code / analyze-impact / ingest-document) が regression なしで通る
- [ ] 既存 Chat の Tally MCP 承認フロー (pending → approve → executed) が動作不変
- [ ] `pnpm lint` PASS (Biome)
- [ ] `pnpm typecheck` PASS (tsc)
- [ ] dogfood log が 10 epic 分記録されている
- [ ] C フェーズ Success Criteria 満たす

これで A フェーズ (`ingest-jira-epic` agent + 専用ボタン + ADR) の plan を別途書ける。

---

## Self-Review

- [x] **Spec coverage:** design doc の C フェーズ Step 1-8 すべてをタスクに落としている。Issue 1-9 + T1-T4 すべてに対応する task がある。
- [x] **Placeholder scan:** "TBD" / "implement later" / "add validation" なし。各 step にコード記述あり。
- [x] **Type consistency:** `McpServerConfig` / `DuplicateGuard` / `ChatBlock` の型名・フィールド名が全タスクで一致。
- [x] **spec 対応:** Test Plan の Coverage Diagram 54 GAP のうち主要 file 単位のテストをすべて TDD で組み込み。dogfooding は Task 19 で記録。
- [x] **Parallel 可能性:** Task 1-3 (core schema) → Task 4-9 (ai-engine utilities) → Task 10 (create-node refactor) → Task 11-14 (ChatRunner) → Task 15 (agent-runner) → Task 16-18 (frontend) の依存関係は直列寄り。Task 4/5/6 は相互独立なので worktree 並列可。Task 16/17/18 も frontend 内で独立ファイルなので並列可。
