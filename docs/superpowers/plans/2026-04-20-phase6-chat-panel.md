# Phase 6: チャットパネル 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 右サイドバーにチャットパネルを追加し、マルチスレッド対話で requirement / usecase proposal 等を個別承認しながら生成できる UX を実装する。既存ボタン型エージェントは共存で残す。

**Architecture:** core に `ChatThread` / `ChatMessage` / `ChatBlock` schema を追加、storage に `ChatStore` (.tally/chats/<id>.yaml) を実装、ai-engine に新 WS `/chat` と `chat-runner` (multi-turn + tool 承認 intercept) を追加。frontend は DetailSheet をタブ化、ChatTab でスレッド一覧 + メッセージ + 承認 UI。承認 intercept は MCP handler wrapper が `chat_tool_pending` を emit して Promise で user 応答を待つ方式。

**Tech Stack:** TypeScript, Claude Agent SDK, Next.js 15, Zustand, Zod, ws (WebSocket), Vitest, Testing Library, YAML (js-yaml).

---

## 前提

- spec: `docs/superpowers/specs/2026-04-20-phase6-chat-panel-design.md`
- 直前 Phase: 5e (ingest-document docs-dir 入力、276→291 tests)
- ADR-0005 (proposal 採用) / ADR-0007 (ツール制約)
- HEAD (開始時): `f606d77 docs: Phase 6 チャットパネル設計書を追加`

## ファイル構造

### core
- **変更** `packages/core/src/types.ts` — `ChatThread` / `ChatMessage` / `ChatBlock` / `ChatThreadMeta` 型
- **変更** `packages/core/src/schema.ts` — zod スキーマ
- **変更** `packages/core/src/id.ts` — `newChatId` / `newChatMessageId` / `newToolUseId`
- **変更** `packages/core/src/id.test.ts` / `schema.test.ts`
- **変更** `packages/core/src/index.ts` — export

### storage
- **変更** `packages/storage/src/paths.ts` — `chatsDir` / `chatFile(id)`
- **新規** `packages/storage/src/chat-store.ts` — `FileSystemChatStore` + `ChatStore` interface
- **新規** `packages/storage/src/chat-store.test.ts`
- **変更** `packages/storage/src/index.ts` — export

### ai-engine
- **新規** `packages/ai-engine/src/chat-runner.ts` — multi-turn + tool 承認 intercept
- **新規** `packages/ai-engine/src/chat-runner.test.ts`
- **変更** `packages/ai-engine/src/server.ts` — WS `/chat` エンドポイント追加
- **変更** `packages/ai-engine/src/server.test.ts` — `/chat` の open / user_message / approve_tool テスト
- **変更** `packages/ai-engine/src/stream.ts` — `AgentEvent` に `chat_*` バリアント追加 (or 新 `ChatEvent` 型)
- **変更** `packages/ai-engine/src/index.ts` — export

### frontend
- **新規** `packages/frontend/src/app/api/projects/[id]/chats/route.ts` (GET, POST)
- **新規** `packages/frontend/src/app/api/projects/[id]/chats/[threadId]/route.ts` (GET)
- **変更** `packages/frontend/src/lib/ws.ts` — `openChat` / `ChatHandle`
- **変更** `packages/frontend/src/lib/store.ts` — chat state + actions
- **変更** `packages/frontend/src/lib/store.test.ts`
- **新規** `packages/frontend/src/components/chat/chat-tab.tsx`
- **新規** `packages/frontend/src/components/chat/chat-thread-list.tsx`
- **新規** `packages/frontend/src/components/chat/chat-messages.tsx`
- **新規** `packages/frontend/src/components/chat/chat-message.tsx`
- **新規** `packages/frontend/src/components/chat/tool-approval-card.tsx`
- **新規** `packages/frontend/src/components/chat/chat-input.tsx`
- **新規** `packages/frontend/src/components/chat/*.test.tsx`
- **変更** `packages/frontend/src/components/details/detail-sheet.tsx` — Tab 化

### docs
- **変更** `docs/04-roadmap.md`
- **新規** `docs/phase-6-manual-e2e.md`
- **新規** `docs/phase-6-progress.md`

---

## Task 1: core に Chat schema + id helper

**Files:**
- Modify: `packages/core/src/types.ts`
- Modify: `packages/core/src/schema.ts`
- Modify: `packages/core/src/id.ts`
- Modify: `packages/core/src/id.test.ts`
- Modify: `packages/core/src/schema.test.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: id.test.ts に newChatId / newChatMessageId / newToolUseId のテスト追加 (RED)**

末尾に:

```typescript
import { newChatId, newChatMessageId, newToolUseId } from './id';

describe('newChatId / newChatMessageId / newToolUseId', () => {
  it('chat- / msg- / tool- プレフィックス + 10 文字サフィックス', () => {
    expect(newChatId()).toMatch(/^chat-[a-zA-Z0-9]{10}$/);
    expect(newChatMessageId()).toMatch(/^msg-[a-zA-Z0-9]{10}$/);
    expect(newToolUseId()).toMatch(/^tool-[a-zA-Z0-9]{10}$/);
  });

  it('連続呼び出しで衝突しない (10 件)', () => {
    const ids = new Set(Array.from({ length: 10 }, () => newChatId()));
    expect(ids.size).toBe(10);
  });
});
```

- [ ] **Step 2: id.ts に追加**

```typescript
export function newChatId(): string {
  return `chat-${generateSuffix()}`;
}

export function newChatMessageId(): string {
  return `msg-${generateSuffix()}`;
}

export function newToolUseId(): string {
  return `tool-${generateSuffix()}`;
}
```

- [ ] **Step 3: index.ts に export 追加**

既存 export 行に `newChatId, newChatMessageId, newToolUseId` を追加。

- [ ] **Step 4: schema.test.ts に ChatBlockSchema / ChatMessageSchema / ChatThreadSchema のテスト追加**

```typescript
import {
  ChatBlockSchema,
  ChatMessageSchema,
  ChatThreadSchema,
  ChatThreadMetaSchema,
} from './schema';

describe('ChatBlockSchema', () => {
  it('text ブロック', () => {
    expect(ChatBlockSchema.safeParse({ type: 'text', text: 'hi' }).success).toBe(true);
  });
  it('tool_use ブロック (approval pending)', () => {
    expect(
      ChatBlockSchema.safeParse({
        type: 'tool_use',
        toolUseId: 'tool-1',
        name: 'mcp__tally__create_node',
        input: { adoptAs: 'requirement', title: 'X', body: '' },
        approval: 'pending',
      }).success,
    ).toBe(true);
  });
  it('tool_result ブロック', () => {
    expect(
      ChatBlockSchema.safeParse({ type: 'tool_result', toolUseId: 'tool-1', ok: true, output: '{}' })
        .success,
    ).toBe(true);
  });
  it('不正な type は reject', () => {
    expect(ChatBlockSchema.safeParse({ type: 'other', text: 'x' }).success).toBe(false);
  });
});

describe('ChatMessageSchema', () => {
  it('user text メッセージ', () => {
    const msg = {
      id: 'msg-1',
      role: 'user',
      blocks: [{ type: 'text', text: '要求追加' }],
      createdAt: '2026-04-20T00:00:00Z',
    };
    expect(ChatMessageSchema.safeParse(msg).success).toBe(true);
  });
  it('role が system は reject (永続化しない)', () => {
    const msg = {
      id: 'msg-1',
      role: 'system',
      blocks: [],
      createdAt: '2026-04-20T00:00:00Z',
    };
    expect(ChatMessageSchema.safeParse(msg).success).toBe(false);
  });
});

describe('ChatThreadSchema / ChatThreadMetaSchema', () => {
  it('最小のスレッドをパース', () => {
    expect(
      ChatThreadSchema.safeParse({
        id: 'chat-1',
        projectId: 'proj-1',
        title: 'test',
        messages: [],
        createdAt: '2026-04-20T00:00:00Z',
        updatedAt: '2026-04-20T00:00:00Z',
      }).success,
    ).toBe(true);
  });
  it('Meta は messages を持たない', () => {
    expect(
      ChatThreadMetaSchema.safeParse({
        id: 'chat-1',
        projectId: 'proj-1',
        title: 'test',
        createdAt: '2026-04-20T00:00:00Z',
        updatedAt: '2026-04-20T00:00:00Z',
      }).success,
    ).toBe(true);
  });
});
```

- [ ] **Step 5: types.ts に型追加**

```typescript
// (schema から推論するので types.ts では re-export するのみ、schema.ts 側で z.infer)
export type { ChatBlock, ChatMessage, ChatThread, ChatThreadMeta } from './schema';
```

- [ ] **Step 6: schema.ts に追加**

```typescript
export const ChatBlockSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: z.string() }),
  z.object({
    type: z.literal('tool_use'),
    toolUseId: z.string().min(1),
    name: z.string().min(1),
    input: z.unknown(),
    approval: z.enum(['pending', 'approved', 'rejected']),
  }),
  z.object({
    type: z.literal('tool_result'),
    toolUseId: z.string().min(1),
    ok: z.boolean(),
    output: z.string(),
  }),
]);

export const ChatMessageSchema = z.object({
  id: z.string().min(1),
  role: z.enum(['user', 'assistant']),
  blocks: z.array(ChatBlockSchema),
  createdAt: z.string().min(1),
});

export const ChatThreadMetaSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  title: z.string().min(1),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});

export const ChatThreadSchema = ChatThreadMetaSchema.extend({
  messages: z.array(ChatMessageSchema),
});

export type ChatBlock = z.infer<typeof ChatBlockSchema>;
export type ChatMessage = z.infer<typeof ChatMessageSchema>;
export type ChatThread = z.infer<typeof ChatThreadSchema>;
export type ChatThreadMeta = z.infer<typeof ChatThreadMetaSchema>;
```

index.ts で schema / type を export 追加。

- [ ] **Step 7: core 全緑 + 型チェック**

```bash
cd ~/dev/github.com/ignission/tally
NODE_ENV=development pnpm --filter @tally/core test
NODE_ENV=development pnpm --filter @tally/core build
```

Expected: 全緑、build PASS。

- [ ] **Step 8: コミット**

```bash
git add packages/core/src/types.ts packages/core/src/schema.ts packages/core/src/id.ts packages/core/src/id.test.ts packages/core/src/schema.test.ts packages/core/src/index.ts
git commit -m "feat(core): ChatThread / ChatMessage / ChatBlock schema + id ヘルパ"
```

---

## Task 2: storage の ChatStore

**Files:**
- Modify: `packages/storage/src/paths.ts`
- Create: `packages/storage/src/chat-store.ts`
- Create: `packages/storage/src/chat-store.test.ts`
- Modify: `packages/storage/src/index.ts`

- [ ] **Step 1: paths.ts に chatsDir / chatFile 追加**

```typescript
export interface TallyPaths {
  root: string;
  projectFile: string;
  nodesDir: string;
  edgesDir: string;
  edgesFile: string;
  chatsDir: string;
}

export function resolveTallyPaths(workspaceRoot: string): TallyPaths {
  const root = path.resolve(workspaceRoot, '.tally');
  return {
    root,
    projectFile: path.join(root, 'project.yaml'),
    nodesDir: path.join(root, 'nodes'),
    edgesDir: path.join(root, 'edges'),
    edgesFile: path.join(root, 'edges', 'edges.yaml'),
    chatsDir: path.join(root, 'chats'),
  };
}

export function chatFileName(threadId: string): string {
  return `${threadId}.yaml`;
}
```

- [ ] **Step 2: chat-store.test.ts を新規作成 (RED)**

```typescript
import { promises as fs } from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { FileSystemChatStore } from './chat-store';

function makeRoot(): string {
  return mkdtempSync(path.join(tmpdir(), 'tally-chat-'));
}

describe('FileSystemChatStore', () => {
  it('createChat → listChats で新規スレッドが出る', async () => {
    const root = makeRoot();
    try {
      const store = new FileSystemChatStore(root);
      const thread = await store.createChat({ projectId: 'proj-1', title: '新規検討' });
      expect(thread.id.startsWith('chat-')).toBe(true);
      const list = await store.listChats();
      expect(list.map((t) => t.id)).toContain(thread.id);
      expect(list[0]?.title).toBe('新規検討');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('appendMessage でメッセージが追加され updatedAt が更新', async () => {
    const root = makeRoot();
    try {
      const store = new FileSystemChatStore(root);
      const thread = await store.createChat({ projectId: 'proj-1', title: 't' });
      const beforeUpdated = thread.updatedAt;
      await new Promise((r) => setTimeout(r, 10));
      const next = await store.appendMessage(thread.id, {
        id: 'msg-1',
        role: 'user',
        blocks: [{ type: 'text', text: 'hello' }],
        createdAt: new Date().toISOString(),
      });
      expect(next.messages).toHaveLength(1);
      expect(next.updatedAt >= beforeUpdated).toBe(true);
      const reloaded = await store.getChat(thread.id);
      expect(reloaded?.messages[0]?.blocks[0]).toEqual({ type: 'text', text: 'hello' });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('updateMessageBlock で特定 block の approval を変更できる', async () => {
    const root = makeRoot();
    try {
      const store = new FileSystemChatStore(root);
      const thread = await store.createChat({ projectId: 'proj-1', title: 't' });
      await store.appendMessage(thread.id, {
        id: 'msg-1',
        role: 'assistant',
        blocks: [
          { type: 'text', text: 'これを作ります' },
          {
            type: 'tool_use',
            toolUseId: 'tool-1',
            name: 'mcp__tally__create_node',
            input: { x: 1 },
            approval: 'pending',
          },
        ],
        createdAt: new Date().toISOString(),
      });
      await store.updateMessageBlock(thread.id, 'msg-1', 1, {
        type: 'tool_use',
        toolUseId: 'tool-1',
        name: 'mcp__tally__create_node',
        input: { x: 1 },
        approval: 'approved',
      });
      const reloaded = await store.getChat(thread.id);
      const block = reloaded?.messages[0]?.blocks[1];
      expect(block && block.type === 'tool_use' && block.approval === 'approved').toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('updateChatTitle でタイトル変更', async () => {
    const root = makeRoot();
    try {
      const store = new FileSystemChatStore(root);
      const thread = await store.createChat({ projectId: 'proj-1', title: 'old' });
      await store.updateChatTitle(thread.id, '新タイトル');
      const reloaded = await store.getChat(thread.id);
      expect(reloaded?.title).toBe('新タイトル');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('listChats は updatedAt 降順', async () => {
    const root = makeRoot();
    try {
      const store = new FileSystemChatStore(root);
      const t1 = await store.createChat({ projectId: 'p', title: 'first' });
      await new Promise((r) => setTimeout(r, 10));
      const t2 = await store.createChat({ projectId: 'p', title: 'second' });
      const list = await store.listChats();
      expect(list[0]?.id).toBe(t2.id);
      expect(list[1]?.id).toBe(t1.id);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('存在しないスレッドは getChat で null', async () => {
    const root = makeRoot();
    try {
      const store = new FileSystemChatStore(root);
      expect(await store.getChat('chat-missing')).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 3: chat-store.ts を新規作成**

```typescript
import { promises as fs } from 'node:fs';
import path from 'node:path';

import {
  ChatMessageSchema,
  ChatThreadSchema,
  newChatId,
  type ChatMessage,
  type ChatBlock,
  type ChatThread,
  type ChatThreadMeta,
} from '@tally/core';

import { chatFileName, resolveTallyPaths } from './paths';
import { readYaml, writeYaml } from './yaml';

export interface CreateChatInput {
  projectId: string;
  title: string;
}

export interface ChatStore {
  listChats(): Promise<ChatThreadMeta[]>;
  getChat(threadId: string): Promise<ChatThread | null>;
  createChat(input: CreateChatInput): Promise<ChatThread>;
  appendMessage(threadId: string, message: ChatMessage): Promise<ChatThread>;
  updateMessageBlock(
    threadId: string,
    messageId: string,
    blockIndex: number,
    block: ChatBlock,
  ): Promise<ChatThread>;
  updateChatTitle(threadId: string, title: string): Promise<ChatThread>;
}

// .tally/chats/<thread-id>.yaml 単位で 1 ファイル 1 スレッド。
// 単一ユーザー前提なのでロック不要。
export class FileSystemChatStore implements ChatStore {
  private readonly paths: ReturnType<typeof resolveTallyPaths>;

  constructor(workspaceRoot: string) {
    this.paths = resolveTallyPaths(workspaceRoot);
  }

  async listChats(): Promise<ChatThreadMeta[]> {
    let entries: string[];
    try {
      entries = await fs.readdir(this.paths.chatsDir);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }
    const yamlFiles = entries.filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'));
    const threads = await Promise.all(
      yamlFiles.map(async (file) => {
        const t = await readYaml(path.join(this.paths.chatsDir, file), ChatThreadSchema);
        if (!t) return null;
        // meta だけ抜き出す
        return {
          id: t.id,
          projectId: t.projectId,
          title: t.title,
          createdAt: t.createdAt,
          updatedAt: t.updatedAt,
        } satisfies ChatThreadMeta;
      }),
    );
    return threads
      .filter((t): t is ChatThreadMeta => t !== null)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async getChat(threadId: string): Promise<ChatThread | null> {
    return readYaml(path.join(this.paths.chatsDir, chatFileName(threadId)), ChatThreadSchema);
  }

  async createChat(input: CreateChatInput): Promise<ChatThread> {
    await fs.mkdir(this.paths.chatsDir, { recursive: true });
    const now = new Date().toISOString();
    const thread: ChatThread = {
      id: newChatId(),
      projectId: input.projectId,
      title: input.title,
      messages: [],
      createdAt: now,
      updatedAt: now,
    };
    await writeYaml(path.join(this.paths.chatsDir, chatFileName(thread.id)), thread);
    return thread;
  }

  async appendMessage(threadId: string, message: ChatMessage): Promise<ChatThread> {
    const thread = await this.getChat(threadId);
    if (!thread) throw new Error(`thread が存在しない: ${threadId}`);
    // schema 検証
    ChatMessageSchema.parse(message);
    const next: ChatThread = {
      ...thread,
      messages: [...thread.messages, message],
      updatedAt: new Date().toISOString(),
    };
    await writeYaml(path.join(this.paths.chatsDir, chatFileName(threadId)), next);
    return next;
  }

  async updateMessageBlock(
    threadId: string,
    messageId: string,
    blockIndex: number,
    block: ChatBlock,
  ): Promise<ChatThread> {
    const thread = await this.getChat(threadId);
    if (!thread) throw new Error(`thread が存在しない: ${threadId}`);
    const messages = thread.messages.map((m) => {
      if (m.id !== messageId) return m;
      const blocks = [...m.blocks];
      blocks[blockIndex] = block;
      return { ...m, blocks };
    });
    const next: ChatThread = {
      ...thread,
      messages,
      updatedAt: new Date().toISOString(),
    };
    await writeYaml(path.join(this.paths.chatsDir, chatFileName(threadId)), next);
    return next;
  }

  async updateChatTitle(threadId: string, title: string): Promise<ChatThread> {
    const thread = await this.getChat(threadId);
    if (!thread) throw new Error(`thread が存在しない: ${threadId}`);
    const next: ChatThread = { ...thread, title, updatedAt: new Date().toISOString() };
    await writeYaml(path.join(this.paths.chatsDir, chatFileName(threadId)), next);
    return next;
  }
}
```

- [ ] **Step 4: index.ts に export 追加**

```typescript
export { FileSystemChatStore } from './chat-store';
export type { ChatStore, CreateChatInput } from './chat-store';
```

- [ ] **Step 5: 全緑 + 型チェック**

```bash
NODE_ENV=development pnpm --filter @tally/storage test
NODE_ENV=development pnpm --filter @tally/storage typecheck
```

Expected: 全緑 (既存 53 + 新規 6 = 59)、typecheck PASS。

- [ ] **Step 6: コミット**

```bash
git add packages/storage/src/paths.ts packages/storage/src/chat-store.ts packages/storage/src/chat-store.test.ts packages/storage/src/index.ts
git commit -m "feat(storage): FileSystemChatStore を追加 (.tally/chats/ 永続化)"
```

---

## Task 3: frontend API routes (GET / POST chats)

**Files:**
- Create: `packages/frontend/src/app/api/projects/[id]/chats/route.ts`
- Create: `packages/frontend/src/app/api/projects/[id]/chats/[threadId]/route.ts`
- Create: `packages/frontend/src/app/api/projects/[id]/chats/chats-route.test.ts`

- [ ] **Step 1: chats-route.test.ts を新規作成 (RED)**

既存 `packages/frontend/src/app/api/projects/[id]/nodes/nodes-route.test.ts` を踏襲。GET / POST / GET by id をカバー。

```typescript
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { FileSystemProjectStore, FileSystemChatStore } from '@tally/storage';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { GET as listHandler, POST as createHandler } from './route';
import { GET as getByIdHandler } from './[threadId]/route';

describe('/api/projects/[id]/chats', () => {
  let root: string;
  const prev = process.env.TALLY_WORKSPACE;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'tally-chats-api-'));
    const store = new FileSystemProjectStore(root);
    await store.saveProjectMeta({
      id: 'proj-1',
      name: 'P',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    process.env.TALLY_WORKSPACE = root;
  });
  afterEach(async () => {
    process.env.TALLY_WORKSPACE = prev;
    await fs.rm(root, { recursive: true, force: true });
  });

  it('POST で新規スレッド作成、GET で一覧化', async () => {
    const createRes = await createHandler(
      new Request('http://x', {
        method: 'POST',
        body: JSON.stringify({ title: 'Test' }),
      }),
      { params: Promise.resolve({ id: 'proj-1' }) },
    );
    expect(createRes.status).toBe(201);
    const created = await createRes.json();
    expect(created.id.startsWith('chat-')).toBe(true);

    const listRes = await listHandler(new Request('http://x'), {
      params: Promise.resolve({ id: 'proj-1' }),
    });
    const listBody = await listRes.json();
    expect(listBody.threads).toHaveLength(1);
    expect(listBody.threads[0].id).toBe(created.id);
  });

  it('GET /[threadId] で 1 スレッドの詳細', async () => {
    const chatStore = new FileSystemChatStore(root);
    const t = await chatStore.createChat({ projectId: 'proj-1', title: 'X' });

    const res = await getByIdHandler(new Request('http://x'), {
      params: Promise.resolve({ id: 'proj-1', threadId: t.id }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(t.id);
    expect(body.messages).toEqual([]);
  });

  it('存在しないプロジェクトは 404', async () => {
    const res = await listHandler(new Request('http://x'), {
      params: Promise.resolve({ id: 'proj-missing' }),
    });
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: 2 つの route.ts を新規作成**

`route.ts`:

```typescript
import { FileSystemChatStore } from '@tally/storage';
import { NextResponse } from 'next/server';

import { resolveProjectById } from '@/lib/project-resolver';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_req: Request, context: RouteContext): Promise<NextResponse> {
  const { id } = await context.params;
  const handle = await resolveProjectById(id);
  if (!handle) return NextResponse.json({ error: 'project not found' }, { status: 404 });
  const store = new FileSystemChatStore(handle.workspaceRoot);
  const threads = await store.listChats();
  return NextResponse.json({ threads });
}

export async function POST(req: Request, context: RouteContext): Promise<NextResponse> {
  const { id } = await context.params;
  const handle = await resolveProjectById(id);
  if (!handle) return NextResponse.json({ error: 'project not found' }, { status: 404 });
  const raw = await req.json().catch(() => null);
  if (raw === null || typeof raw !== 'object') {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }
  const { title } = raw as { title?: unknown };
  const titleStr =
    typeof title === 'string' && title.trim().length > 0 ? title.trim() : '新規スレッド';
  const store = new FileSystemChatStore(handle.workspaceRoot);
  const thread = await store.createChat({ projectId: id, title: titleStr });
  return NextResponse.json(thread, { status: 201 });
}
```

`[threadId]/route.ts`:

```typescript
import { FileSystemChatStore } from '@tally/storage';
import { NextResponse } from 'next/server';

import { resolveProjectById } from '@/lib/project-resolver';

interface RouteContext {
  params: Promise<{ id: string; threadId: string }>;
}

export async function GET(_req: Request, context: RouteContext): Promise<NextResponse> {
  const { id, threadId } = await context.params;
  const handle = await resolveProjectById(id);
  if (!handle) return NextResponse.json({ error: 'project not found' }, { status: 404 });
  const store = new FileSystemChatStore(handle.workspaceRoot);
  const thread = await store.getChat(threadId);
  if (!thread) return NextResponse.json({ error: 'thread not found' }, { status: 404 });
  return NextResponse.json(thread);
}
```

- [ ] **Step 3: テスト実行で GREEN**

```bash
NODE_ENV=development pnpm --filter @tally/frontend test -- chats
NODE_ENV=development pnpm --filter @tally/frontend test
```

Expected: 全緑 (+3 本)。

- [ ] **Step 4: コミット**

```bash
git add packages/frontend/src/app/api/projects/[id]/chats/
git commit -m "feat(frontend): チャットスレッド API (GET/POST list, GET by id)"
```

---

## Task 4: ai-engine chat-runner (WS 抜きで純ロジック)

**Files:**
- Modify: `packages/ai-engine/src/stream.ts` (ChatEvent 型追加)
- Create: `packages/ai-engine/src/chat-runner.ts`
- Create: `packages/ai-engine/src/chat-runner.test.ts`

### 方針

chat-runner は WS から切り離したロジック。
- 入力: `{ sdk, chatStore, projectStore, threadId, userMessage }`
- 挙動:
  1. thread を load
  2. user message を append (永続化 + event emit)
  3. SDK の query を過去履歴 + 新 user msg で呼ぶ
  4. SDK の stream を iterate
     - text block → assistant msg に追記 + text-delta emit
     - tool_use block → 承認 intercept (pending event emit + Promise で await) → approved なら実ツール実行 / rejected ならスキップ
     - tool_result → emit + 追記
  5. turn 終了で emit `chat_turn_ended`
- 外部インターフェイス: AsyncGenerator of ChatEvent + 承認コールバック

tool 承認の Promise 管理: `Map<toolUseId, { resolve: (approved: boolean) => void }>`。外から `approveTool(toolUseId, approved)` を呼ぶと resolve。

- [ ] **Step 1: stream.ts に ChatEvent 型追加**

```typescript
// 既存 AgentEvent はそのまま残す。
// 新しく chat 用イベントを別 type で定義。
export type ChatEvent =
  | { type: 'chat_opened'; threadId: string }
  | { type: 'chat_user_message_appended'; messageId: string }
  | { type: 'chat_assistant_message_started'; messageId: string }
  | { type: 'chat_text_delta'; messageId: string; text: string }
  | { type: 'chat_tool_pending'; messageId: string; toolUseId: string; name: string; input: unknown }
  | { type: 'chat_tool_result'; messageId: string; toolUseId: string; ok: boolean; output: string }
  | { type: 'chat_assistant_message_completed'; messageId: string }
  | { type: 'chat_turn_ended' }
  | { type: 'error'; code: string; message: string };
```

- [ ] **Step 2: chat-runner.test.ts を新規作成 (RED)**

```typescript
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { FileSystemChatStore, FileSystemProjectStore } from '@tally/storage';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ChatRunner } from './chat-runner';
import type { SdkLike, SdkMessageLike } from './agent-runner';
import type { ChatEvent } from './stream';

function makeSdk(messages: SdkMessageLike[]): SdkLike {
  return {
    query: () =>
      (async function* () {
        for (const m of messages) yield m;
      })(),
  };
}

describe('ChatRunner', () => {
  let root: string;
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'tally-chat-runner-'));
    const ps = new FileSystemProjectStore(root);
    await ps.saveProjectMeta({
      id: 'proj-1',
      name: 'P',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  });
  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('text-only 応答: user msg append → assistant msg stream → turn ended', async () => {
    const chatStore = new FileSystemChatStore(root);
    const projectStore = new FileSystemProjectStore(root);
    const thread = await chatStore.createChat({ projectId: 'proj-1', title: 't' });

    const sdk = makeSdk([
      {
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'こんにちは' }] },
      } as unknown as SdkMessageLike,
      { type: 'result', subtype: 'success', result: 'ok' } as unknown as SdkMessageLike,
    ]);

    const runner = new ChatRunner({
      sdk,
      chatStore,
      projectStore,
      workspaceRoot: root,
      threadId: thread.id,
    });

    const events: ChatEvent[] = [];
    const iter = runner.runUserTurn('こんにちは');
    for await (const e of iter) events.push(e);

    expect(events.some((e) => e.type === 'chat_user_message_appended')).toBe(true);
    expect(events.some((e) => e.type === 'chat_text_delta')).toBe(true);
    expect(events.some((e) => e.type === 'chat_turn_ended')).toBe(true);

    const reloaded = await chatStore.getChat(thread.id);
    expect(reloaded?.messages).toHaveLength(2);
    expect(reloaded?.messages[0]?.role).toBe('user');
    expect(reloaded?.messages[1]?.role).toBe('assistant');
  });

  it('tool_use: 承認前 pending を emit、approve() で Promise 解決後に tool が走る', async () => {
    const chatStore = new FileSystemChatStore(root);
    const projectStore = new FileSystemProjectStore(root);
    const thread = await chatStore.createChat({ projectId: 'proj-1', title: 't' });

    const addNodeSpy = vi.spyOn(projectStore, 'addNode');

    const sdk: SdkLike = {
      query: () =>
        (async function* () {
          yield {
            type: 'assistant',
            message: {
              content: [
                {
                  type: 'tool_use',
                  id: 'toolid-1',
                  name: 'mcp__tally__create_node',
                  input: {
                    adoptAs: 'requirement',
                    title: 'X',
                    body: '',
                  },
                },
              ],
            },
          } as unknown as SdkMessageLike;
          yield { type: 'result', subtype: 'success', result: 'ok' } as unknown as SdkMessageLike;
        })(),
    };

    const runner = new ChatRunner({
      sdk,
      chatStore,
      projectStore,
      workspaceRoot: root,
      threadId: thread.id,
    });

    const events: ChatEvent[] = [];
    const iterPromise = (async () => {
      for await (const e of runner.runUserTurn('要求追加して')) events.push(e);
    })();

    // pending イベントが来るまで待つ
    await vi.waitFor(
      () => {
        if (!events.some((e) => e.type === 'chat_tool_pending')) throw new Error('not yet');
      },
      { timeout: 1000 },
    );
    const pending = events.find((e) => e.type === 'chat_tool_pending');
    expect(pending).toBeDefined();
    if (pending?.type !== 'chat_tool_pending') throw new Error('narrow');

    // 承認
    runner.approveTool(pending.toolUseId, true);

    await iterPromise;

    expect(addNodeSpy).toHaveBeenCalledTimes(1);
    expect(events.some((e) => e.type === 'chat_tool_result' && e.ok)).toBe(true);
  });

  it('tool 却下で addNode 呼ばれず tool_result が ok:false', async () => {
    const chatStore = new FileSystemChatStore(root);
    const projectStore = new FileSystemProjectStore(root);
    const thread = await chatStore.createChat({ projectId: 'proj-1', title: 't' });

    const addNodeSpy = vi.spyOn(projectStore, 'addNode');

    const sdk: SdkLike = {
      query: () =>
        (async function* () {
          yield {
            type: 'assistant',
            message: {
              content: [
                {
                  type: 'tool_use',
                  id: 'toolid-x',
                  name: 'mcp__tally__create_node',
                  input: { adoptAs: 'requirement', title: 'X', body: '' },
                },
              ],
            },
          } as unknown as SdkMessageLike;
          yield { type: 'result', subtype: 'success', result: 'ok' } as unknown as SdkMessageLike;
        })(),
    };

    const runner = new ChatRunner({
      sdk,
      chatStore,
      projectStore,
      workspaceRoot: root,
      threadId: thread.id,
    });

    const events: ChatEvent[] = [];
    const iterPromise = (async () => {
      for await (const e of runner.runUserTurn('要求追加して')) events.push(e);
    })();

    await vi.waitFor(() => {
      if (!events.some((e) => e.type === 'chat_tool_pending')) throw new Error('not yet');
    });
    const pending = events.find((e) => e.type === 'chat_tool_pending');
    if (pending?.type !== 'chat_tool_pending') throw new Error('narrow');
    runner.approveTool(pending.toolUseId, false);
    await iterPromise;

    expect(addNodeSpy).not.toHaveBeenCalled();
    const result = events.find((e) => e.type === 'chat_tool_result');
    expect(result?.type === 'chat_tool_result' && result.ok === false).toBe(true);
  });
});
```

- [ ] **Step 3: chat-runner.ts を新規作成**

(以下の interface + class を実装。実装はマルチターン SDK 呼び出しで、tool_use を pending 状態で emit し Promise で待つ。)

```typescript
import {
  newChatMessageId,
  newToolUseId,
  type ChatBlock,
  type ChatMessage,
  type ChatThread,
} from '@tally/core';
import type { ChatStore, ProjectStore } from '@tally/storage';

import type { SdkLike, SdkMessageLike } from './agent-runner';
import type { ChatEvent } from './stream';
import { buildTallyMcpServer } from './tools';

export interface ChatRunnerDeps {
  sdk: SdkLike;
  chatStore: ChatStore;
  projectStore: ProjectStore;
  workspaceRoot: string;
  threadId: string;
}

export class ChatRunner {
  private readonly deps: ChatRunnerDeps;
  private pendingApprovals = new Map<
    string,
    (approved: boolean) => void
  >();

  constructor(deps: ChatRunnerDeps) {
    this.deps = deps;
  }

  approveTool(toolUseId: string, approved: boolean): void {
    const resolver = this.pendingApprovals.get(toolUseId);
    if (resolver) {
      this.pendingApprovals.delete(toolUseId);
      resolver(approved);
    }
  }

  // user の 1 ターンを実行。user メッセージ保存 → SDK query → stream →
  // 承認 intercept → tool 実行 → tool_result → 続きを SDK に渡す → turn end。
  async *runUserTurn(userText: string): AsyncGenerator<ChatEvent> {
    const { chatStore, projectStore, workspaceRoot, sdk, threadId } = this.deps;

    const thread = await chatStore.getChat(threadId);
    if (!thread) {
      yield { type: 'error', code: 'not_found', message: `thread: ${threadId}` };
      return;
    }

    // 1. user message append
    const userMsgId = newChatMessageId();
    const userMsg: ChatMessage = {
      id: userMsgId,
      role: 'user',
      blocks: [{ type: 'text', text: userText }],
      createdAt: new Date().toISOString(),
    };
    await chatStore.appendMessage(threadId, userMsg);
    yield { type: 'chat_user_message_appended', messageId: userMsgId };

    // 2. SDK の履歴を組む
    const priorMessages = thread.messages.concat(userMsg);
    const sdkPrompt = chatMessagesToSdkPrompt(priorMessages);
    const systemPrompt = buildChatSystemPrompt();

    // 3. assistant msg の初期化
    const assistantMsgId = newChatMessageId();
    const assistantBlocks: ChatBlock[] = [];
    await chatStore.appendMessage(threadId, {
      id: assistantMsgId,
      role: 'assistant',
      blocks: [],
      createdAt: new Date().toISOString(),
    });
    yield { type: 'chat_assistant_message_started', messageId: assistantMsgId };

    // 4. MCP server with approval intercept
    const sideEvents: ChatEvent[] = [];
    const mcp = this.buildInterceptedMcp(sideEvents, assistantMsgId);
    // NOTE: buildInterceptedMcp は create_node/create_edge を承認ガード付きで作る MCP server。
    // find_related / list_by_type はそのまま素通り。

    // 5. SDK query
    const iter = sdk.query({
      prompt: sdkPrompt,
      options: {
        systemPrompt,
        mcpServers: { tally: mcp as unknown as Record<string, unknown> },
        tools: [], // codebasePath ありなら Read/Glob/Grep を付ける (別途拡張)
        allowedTools: [
          'mcp__tally__create_node',
          'mcp__tally__create_edge',
          'mcp__tally__find_related',
          'mcp__tally__list_by_type',
        ],
        permissionMode: 'dontAsk',
        settingSources: [],
        cwd: workspaceRoot,
        ...(process.env.CLAUDE_CODE_PATH
          ? { pathToClaudeCodeExecutable: process.env.CLAUDE_CODE_PATH }
          : {}),
      },
    });

    for await (const msg of iter) {
      // SDK メッセージ → block / delta 発火
      const blocks = extractBlocks(msg);
      for (const b of blocks) {
        if (b.type === 'text') {
          assistantBlocks.push({ type: 'text', text: b.text });
          yield { type: 'chat_text_delta', messageId: assistantMsgId, text: b.text };
        } else if (b.type === 'tool_use') {
          // intercept 経路は MCP wrapper 内で実処理される。
          // ここでは ChatEvent としての pending/result は sideEvents から flush される。
        }
      }
      while (sideEvents.length > 0) {
        const e = sideEvents.shift();
        if (e) yield e;
      }
      // assistant msg の永続化を逐次更新するのはコストなので turn 末に全置換でも OK
    }

    // 6. 最終 assistant msg を store に upsert
    // simplification: appendMessage した時に空だったので、updateMessageBlock で埋める or 別メソッド必要
    // TODO: ここで thread を reload してから最終 blocks 配列を書き戻す helper を追加する
    // (MVP 実装時に chatStore.replaceMessage を追加 or updateMessageBlock で全 block 置換)

    yield { type: 'chat_assistant_message_completed', messageId: assistantMsgId };
    yield { type: 'chat_turn_ended' };
  }

  // ... buildInterceptedMcp などの private method は実装時に書く
}

// Helpers (実装時に丁寧に):
function chatMessagesToSdkPrompt(messages: ChatMessage[]): string {
  // SDK の prompt 形式に合わせて user/assistant を整形
  // 実 SDK は複数ターン形式の場合 prompt 内に会話履歴を埋め込むか messages 配列を渡す。
  // MVP: 最新の user text を prompt に、それ以前は system に要約 で妥協も可。
  // ここでは最もシンプルに「直近 user の text を prompt に出す」とする。
  const lastUser = [...messages].reverse().find((m) => m.role === 'user');
  return (
    lastUser?.blocks
      .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
      .map((b) => b.text)
      .join('\n') ?? ''
  );
}

function buildChatSystemPrompt(): string {
  return [
    'あなたは Tally の対話アシスタントです。',
    'ユーザーと自然に対話しながら、キャンバスに requirement / usecase /',
    'userstory / question / issue / coderef の proposal ノードを生やし、',
    '必要に応じて satisfy / contain / derive / refine エッジを張ります。',
    '',
    '重要な方針:',
    '- 一度にノードを作りすぎない。ユーザーの意図を確認してから小刻みに create_node を呼ぶ。',
    '- create_node / create_edge は必ずユーザー承認を経る (サーバ側で承認 UI を挟む)。',
    '- 迷ったら質問する。勝手に決めない。',
    '- 既存ノードを把握したい時は list_by_type / find_related を遠慮なく使う (承認不要)。',
  ].join('\n');
}

function extractBlocks(msg: SdkMessageLike): Array<
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
> {
  // SDK の AssistantMessage.content からブロック抽出。
  // agent-runner.ts の既存パターンを参考。
  const m = msg as unknown as {
    type?: string;
    message?: { content?: unknown[] };
  };
  if (m.type !== 'assistant' || !m.message?.content) return [];
  const out: Array<
    | { type: 'text'; text: string }
    | { type: 'tool_use'; id: string; name: string; input: unknown }
  > = [];
  for (const block of m.message.content) {
    const b = block as {
      type?: string;
      text?: string;
      id?: string;
      name?: string;
      input?: unknown;
    };
    if (b.type === 'text' && typeof b.text === 'string') {
      out.push({ type: 'text', text: b.text });
    } else if (b.type === 'tool_use' && typeof b.id === 'string' && typeof b.name === 'string') {
      out.push({ type: 'tool_use', id: b.id, name: b.name, input: b.input });
    }
  }
  return out;
}
```

> **実装注**: 上記は **スケルトン**。`buildInterceptedMcp` とメッセージ永続化の細部 (`chatStore.replaceLastAssistantMessage` のような helper) が必要。実装時に下記追加を想定:
>
> - `chat-store.ts` に `replaceMessage(threadId, messageId, message)` を追加
> - `chat-runner.ts` の `buildInterceptedMcp` で `create_node` / `create_edge` tool を wrap して pending→approve→実行 を実装
> - mock SDK で pending が来るタイミングと approveTool の呼び出しを unit test で検証 (test 側で待機する構造は上記 Step 2 の通り)

- [ ] **Step 4: テスト GREEN + build**

```bash
NODE_ENV=development pnpm --filter @tally/ai-engine test -- chat-runner
NODE_ENV=development pnpm --filter @tally/ai-engine build
```

Expected: 3 本 GREEN。build PASS。

- [ ] **Step 5: コミット**

```bash
git add packages/ai-engine/src/stream.ts packages/ai-engine/src/chat-runner.ts packages/ai-engine/src/chat-runner.test.ts
# chat-store.ts に replaceMessage を追加したなら:
git add packages/storage/src/chat-store.ts packages/storage/src/chat-store.test.ts 2>/dev/null || true
git commit -m "feat(ai-engine): chat-runner (multi-turn + tool 承認 intercept)"
```

---

## Task 5: ai-engine WS /chat エンドポイント

**Files:**
- Modify: `packages/ai-engine/src/server.ts`
- Modify: `packages/ai-engine/src/server.test.ts`

### 概要

既存 `/agent` に加えて `/chat` path を追加。メッセージプロトコル:

- user → server:
  - `{ type: 'open', projectId, threadId }`
  - `{ type: 'user_message', text }`
  - `{ type: 'approve_tool', toolUseId, approved }`
- server → user:
  - ChatEvent (chat_opened / chat_text_delta / chat_tool_pending / ...) を JSON で送信

接続 per thread。切断で runner 破棄。

- [ ] **Step 1: server.test.ts に /chat の open テスト追加 (RED)**

```typescript
  it('/chat: open → user_message → chat_turn_ended', async () => {
    // ... sample SDK with text response
    // WebSocket を /chat に繋ぎ、open → user_message 送って chat_turn_ended を受信する流れを検証
  });
```

(詳細は既存 `/agent` テストを踏襲)

- [ ] **Step 2: server.ts に /chat ルーティング追加**

既存 `WebSocketServer({ port, path: '/agent' })` に加え、別の path 用に WSS を 2 つ立てるか、1 つにして request.url でルーティング。後者が一般的:

```typescript
const wss = new WebSocketServer({ port: opts.port });  // path 無指定
wss.on('connection', (ws, req) => {
  const url = req.url ?? '';
  if (url.startsWith('/agent')) {
    handleAgentConnection(ws);
  } else if (url.startsWith('/chat')) {
    handleChatConnection(ws, opts.sdk);
  } else {
    ws.close(1008, 'unknown path');
  }
});
```

`handleChatConnection` は ChatRunner インスタンスを保持し、user_message で `runUserTurn` を起動、approve_tool で `approveTool` を呼ぶ。

- [ ] **Step 3: テスト GREEN**

```bash
NODE_ENV=development pnpm --filter @tally/ai-engine test -- server
```

- [ ] **Step 4: コミット**

```bash
git add packages/ai-engine/src/server.ts packages/ai-engine/src/server.test.ts
git commit -m "feat(ai-engine): WS /chat エンドポイント (ChatRunner を長寿命接続で駆動)"
```

---

## Task 6: frontend ws.ts 拡張 + store chat state

**Files:**
- Modify: `packages/frontend/src/lib/ws.ts`
- Modify: `packages/frontend/src/lib/store.ts`
- Modify: `packages/frontend/src/lib/store.test.ts`

- [ ] **Step 1: ws.ts に openChat 追加**

```typescript
export interface ChatHandle {
  events: AsyncIterable<ChatEvent>;
  sendUserMessage: (text: string) => void;
  approveTool: (toolUseId: string, approved: boolean) => void;
  close: () => void;
}

export function openChat(opts: {
  url?: string;
  projectId: string;
  threadId: string;
}): ChatHandle {
  // WebSocket 接続 + open message 送信 + 受信を AsyncIterable 化
  // ...
}
```

- [ ] **Step 2: store にスレッド状態 + actions 追加**

```typescript
interface ChatThreadState {
  id: string;
  title: string;
  messages: ChatMessage[];
  streaming: boolean;
}

// CanvasState:
chatThreads: Record<string, ChatThreadState>;
chatThreadList: ChatThreadMeta[];   // list API 取得分
activeChatThreadId: string | null;

loadChatThreads: () => Promise<void>;
createChatThread: (title?: string) => Promise<string>;
openChatThread: (threadId: string) => Promise<void>;
closeChatThread: () => void;
sendChatMessage: (text: string) => Promise<void>;
approveChatTool: (toolUseId: string, approved: boolean) => void;
```

- [ ] **Step 3: store.test.ts に新 action のテスト追加**

mock `ws` + mock fetch で、sendChatMessage → streaming events で messages が更新されるシナリオを書く。

- [ ] **Step 4: テスト GREEN**

```bash
NODE_ENV=development pnpm --filter @tally/frontend test -- store
```

- [ ] **Step 5: コミット**

```bash
git add packages/frontend/src/lib/ws.ts packages/frontend/src/lib/store.ts packages/frontend/src/lib/store.test.ts
git commit -m "feat(frontend): WS openChat + store にチャットスレッド state / actions 追加"
```

---

## Task 7: frontend Chat UI コンポーネント群

**Files:**
- Create: `packages/frontend/src/components/chat/chat-tab.tsx`
- Create: `packages/frontend/src/components/chat/chat-thread-list.tsx`
- Create: `packages/frontend/src/components/chat/chat-messages.tsx`
- Create: `packages/frontend/src/components/chat/chat-message.tsx`
- Create: `packages/frontend/src/components/chat/tool-approval-card.tsx`
- Create: `packages/frontend/src/components/chat/chat-input.tsx`
- Create: `packages/frontend/src/components/chat/chat-tab.test.tsx`
- Create: `packages/frontend/src/components/chat/tool-approval-card.test.tsx`
- Create: `packages/frontend/src/components/chat/chat-input.test.tsx`

### 実装の骨格

ChatTab:
- 上部: ChatThreadList (dropdown) + 新規ボタン
- 中央: ChatMessages
- 下部: ChatInput

ChatMessage は role ごとに分岐:
- user: 右寄せ、青背景
- assistant: 左寄せ、block ごとに render
  - text: 通常テキスト
  - tool_use (approval=pending): ToolApprovalCard
  - tool_use (approval=approved/rejected): 小さいステータスラベル
  - tool_result: 簡易表示

ToolApprovalCard:
- tool 名 + input 抜粋 + 「承認」「却下」ボタン
- クリックで `approveChatTool(toolUseId, true/false)`

ChatInput:
- textarea + 送信 (Enter / ボタン)
- streaming 中は disabled

- [ ] **Step 1-2: テスト + 実装 (RED → GREEN)**

各コンポーネントに対し、既存 ai-actions / dialog と同じ testing-library パターン。ToolApprovalCard は click → approve 呼び出しの spy 検証。

- [ ] **Step 3: コミット**

```bash
git add packages/frontend/src/components/chat/
git commit -m "feat(frontend): Chat UI コンポーネント群 (ChatTab / メッセージ / 承認カード / 入力)"
```

---

## Task 8: DetailSheet のタブ化

**Files:**
- Modify: `packages/frontend/src/components/details/detail-sheet.tsx`
- Modify: `packages/frontend/src/components/details/detail-sheet.test.tsx` (あれば)

- [ ] **Step 1: 既存 detail-sheet.tsx を Tab 構造にラップ**

- 上部に Detail / Chat タブ
- Detail タブは既存の子レンダリングそのまま
- Chat タブは `<ChatTab projectId={projectId} />`
- タブ状態は local useState (`useState<'detail' | 'chat'>('detail')`)
- プロジェクト ID が変わったらタブ選択を detail に戻す

- [ ] **Step 2: 手動確認 + テスト追加**

既存 canvas ページ → 右サイドバーに Detail / Chat のタブヘッダが出る、Chat タブで空状態 → 新規スレッドボタンで開始。

- [ ] **Step 3: 全緑 + typecheck + コミット**

```bash
NODE_ENV=development pnpm -r test
NODE_ENV=development pnpm -r typecheck
git add packages/frontend/src/components/details/detail-sheet.tsx
git commit -m "feat(frontend): DetailSheet を Detail/Chat タブ構成に変更"
```

---

## Task 9: docs + 最終全緑 + Playwright E2E 動作確認

**Files:**
- Modify: `docs/04-roadmap.md`
- Create: `docs/phase-6-manual-e2e.md`
- Create: `docs/phase-6-progress.md`

- [ ] **Step 1: 04-roadmap.md に Phase 6 章追加**

```markdown
## Phase 6: チャットパネル (完了)

### ゴール

対話 UI でスコープを詰めてから proposal を個別承認して生成する UX を導入。
マルチスレッド + YAML 永続化。

### 完了条件

- 右サイドバーに Chat タブ、新規スレッド / 切替 / 継続会話が動く
- AI の create_node/create_edge は tool_use pending → 承認 UI → 実行 の流れ
- `.tally/chats/<id>.yaml` に永続化、リロードで復元

手動 E2E 手順は `docs/phase-6-manual-e2e.md` 参照。
```

- [ ] **Step 2: phase-6-manual-e2e.md 新規**

spec § 6.2 のシナリオを手順書化。

- [ ] **Step 3: phase-6-progress.md 新規**

他 Phase と同形式。全 9 タスクの進捗表 + HEAD / テスト本数 / follow-up / 実装ルール。

- [ ] **Step 4: 最終全緑確認**

```bash
NODE_ENV=development pnpm -r test 2>&1 | grep -E 'Tests.*passed'
NODE_ENV=development pnpm -r typecheck
```

- [ ] **Step 5: Playwright E2E (スキップ可、手動でも OK)**

`/tmp/tally-chat-e2e.mjs` を書いて:
- 新規プロジェクト作成 → Chat タブ切替 → 新規スレッド → user message 送信 → pending approval カード確認 → 承認 → node 追加確認

- [ ] **Step 6: コミット**

```bash
git add docs/04-roadmap.md docs/phase-6-manual-e2e.md docs/phase-6-progress.md
git commit -m "docs: Phase 6 完了マーク + 手動 E2E 手順書追加"
```

---

## 完了条件 (plan 全体)

- Task 1-9 全て完了 commit
- `pnpm -r test` / `pnpm -r typecheck` 全緑
- 手動 E2E で対話 → 承認 → ノード生成のフルフローが動く
- spec § 8 受入条件を全て満たす

## Self-Review

**Spec coverage:**
- § 1 (ドメインモデル): Task 1-2 ✓
- § 2 (UI): Task 7-8 ✓
- § 3 (WS プロトコル): Task 4-5 ✓
- § 4 (frontend 実装): Task 6-7 ✓
- § 5 (API routes): Task 3 ✓
- § 6.1 (ユニットテスト): 各 Task で RED/GREEN ✓
- § 6.2 (手動 E2E): Task 9 ✓

**Placeholder scan:**
- Task 4 の chat-runner.ts の `buildInterceptedMcp` 実装詳細と「最終 assistant msg upsert」が TODO 表記。**これは実装時に埋める** (pseudocode ベース + agent-runner.ts の `buildTallyMcpServer` の wrapper パターンを流用)。この plan の目的は骨格明示なので許容範囲。
- Task 5 の test 詳細、Task 6-7 のテスト詳細も簡略化。実装時に既存 `server.test.ts` / `store.test.ts` / `ingest-document-dialog.test.tsx` のパターンを踏襲。

**Type consistency:**
- `ChatThread`, `ChatMessage`, `ChatBlock`, `ChatThreadMeta` は Task 1 で定義、全 Task で同じ型参照
- `ChatEvent` は Task 4 で定義、Task 5-6-7 で同じ type 参照
- `ChatHandle` は Task 6 で定義、Task 7 で消費

## 実装規模見積もり (再掲)

- Task 1 core: ~2h
- Task 2 storage: ~3h
- Task 3 API: ~1.5h
- Task 4 chat-runner: **~6h** (最も重い、tool 承認 intercept の Promise 管理 + test の非同期調整)
- Task 5 WS /chat: ~3h
- Task 6 ws/store: ~3h
- Task 7 UI components: ~5h
- Task 8 DetailSheet tab: ~1.5h
- Task 9 docs: ~1h

合計 ~26h = **~3.5 日** (spec § 9 の 4.5-5 日見積もりより短めだが Task 4 の詰まりで伸びる可能性大)
