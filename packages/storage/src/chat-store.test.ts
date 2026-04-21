import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { FileSystemChatStore } from './chat-store';

function makeProjectDir(): string {
  return mkdtempSync(path.join(tmpdir(), 'tally-chat-'));
}

describe('FileSystemChatStore', () => {
  it('createChat → listChats で新規スレッドが出る', async () => {
    const projectDir = makeProjectDir();
    try {
      const store = new FileSystemChatStore(projectDir);
      const thread = await store.createChat({ projectId: 'proj-1', title: '新規検討' });
      expect(thread.id.startsWith('chat-')).toBe(true);
      expect(thread.title).toBe('新規検討');
      expect(thread.messages).toEqual([]);
      const list = await store.listChats();
      expect(list.map((t) => t.id)).toContain(thread.id);
      expect(list[0]?.title).toBe('新規検討');
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it('appendMessage でメッセージが追加され updatedAt が更新', async () => {
    const projectDir = makeProjectDir();
    try {
      const store = new FileSystemChatStore(projectDir);
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
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it('updateMessageBlock で特定 block の approval を変更できる', async () => {
    const projectDir = makeProjectDir();
    try {
      const store = new FileSystemChatStore(projectDir);
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
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it('updateChatTitle でタイトル変更', async () => {
    const projectDir = makeProjectDir();
    try {
      const store = new FileSystemChatStore(projectDir);
      const thread = await store.createChat({ projectId: 'proj-1', title: 'old' });
      await store.updateChatTitle(thread.id, '新タイトル');
      const reloaded = await store.getChat(thread.id);
      expect(reloaded?.title).toBe('新タイトル');
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it('listChats は updatedAt 降順', async () => {
    const projectDir = makeProjectDir();
    try {
      const store = new FileSystemChatStore(projectDir);
      const t1 = await store.createChat({ projectId: 'p', title: 'first' });
      await new Promise((r) => setTimeout(r, 10));
      const t2 = await store.createChat({ projectId: 'p', title: 'second' });
      const list = await store.listChats();
      expect(list[0]?.id).toBe(t2.id);
      expect(list[1]?.id).toBe(t1.id);
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it('存在しないスレッドは getChat で null', async () => {
    const projectDir = makeProjectDir();
    try {
      const store = new FileSystemChatStore(projectDir);
      expect(await store.getChat('chat-missing')).toBeNull();
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it('appendMessage で存在しないスレッド ID は throw', async () => {
    const projectDir = makeProjectDir();
    try {
      const store = new FileSystemChatStore(projectDir);
      await expect(
        store.appendMessage('chat-missing', {
          id: 'msg-1',
          role: 'user',
          blocks: [{ type: 'text', text: 'x' }],
          createdAt: new Date().toISOString(),
        }),
      ).rejects.toThrow(/thread が存在しない/);
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it('appendBlockToMessage で既存メッセージの blocks に append される', async () => {
    const projectDir = makeProjectDir();
    try {
      const store = new FileSystemChatStore(projectDir);
      const thread = await store.createChat({ projectId: 'proj-1', title: 't' });
      await store.appendMessage(thread.id, {
        id: 'msg-1',
        role: 'assistant',
        blocks: [{ type: 'text', text: 'first' }],
        createdAt: new Date().toISOString(),
      });
      await store.appendBlockToMessage(thread.id, 'msg-1', {
        type: 'tool_use',
        toolUseId: 'tool-aaa',
        name: 'mcp__tally__create_node',
        input: { adoptAs: 'requirement', title: 'X', body: '' },
        approval: 'pending',
      });
      const reloaded = await store.getChat(thread.id);
      expect(reloaded?.messages[0]?.blocks).toHaveLength(2);
      expect(reloaded?.messages[0]?.blocks[1]).toEqual({
        type: 'tool_use',
        toolUseId: 'tool-aaa',
        name: 'mcp__tally__create_node',
        input: { adoptAs: 'requirement', title: 'X', body: '' },
        approval: 'pending',
      });
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it('appendBlockToMessage で存在しない messageId は throw', async () => {
    const projectDir = makeProjectDir();
    try {
      const store = new FileSystemChatStore(projectDir);
      const thread = await store.createChat({ projectId: 'proj-1', title: 't' });
      await expect(
        store.appendBlockToMessage(thread.id, 'msg-missing', {
          type: 'text',
          text: 'x',
        }),
      ).rejects.toThrow(/message が存在しない/);
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it('replaceMessageBlocks で blocks 配列を置換 + updatedAt 更新', async () => {
    const projectDir = makeProjectDir();
    try {
      const store = new FileSystemChatStore(projectDir);
      const thread = await store.createChat({ projectId: 'proj-1', title: 't' });
      const created = await store.appendMessage(thread.id, {
        id: 'msg-1',
        role: 'assistant',
        blocks: [{ type: 'text', text: 'first' }],
        createdAt: new Date().toISOString(),
      });
      const before = created.updatedAt;
      await new Promise((r) => setTimeout(r, 10));
      await store.replaceMessageBlocks(thread.id, 'msg-1', [
        { type: 'text', text: 'alpha' },
        { type: 'text', text: 'beta' },
      ]);
      const reloaded = await store.getChat(thread.id);
      expect(reloaded?.messages[0]?.blocks).toHaveLength(2);
      expect(reloaded?.messages[0]?.blocks[0]).toEqual({ type: 'text', text: 'alpha' });
      expect(reloaded?.messages[0]?.blocks[1]).toEqual({ type: 'text', text: 'beta' });
      expect(reloaded && reloaded.updatedAt > before).toBe(true);
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it('updateBlockApproval で該当 toolUseId の approval を更新', async () => {
    const projectDir = makeProjectDir();
    try {
      const store = new FileSystemChatStore(projectDir);
      const thread = await store.createChat({ projectId: 'proj-1', title: 't' });
      await store.appendMessage(thread.id, {
        id: 'msg-1',
        role: 'assistant',
        blocks: [
          { type: 'text', text: 'これを作ります' },
          {
            type: 'tool_use',
            toolUseId: 'tool-a',
            name: 'mcp__tally__create_node',
            input: { adoptAs: 'requirement', title: 'A', body: '' },
            approval: 'pending',
          },
          {
            type: 'tool_use',
            toolUseId: 'tool-b',
            name: 'mcp__tally__create_node',
            input: { adoptAs: 'requirement', title: 'B', body: '' },
            approval: 'pending',
          },
        ],
        createdAt: new Date().toISOString(),
      });
      await store.updateBlockApproval(thread.id, 'msg-1', 'tool-b', 'approved');
      const reloaded = await store.getChat(thread.id);
      const blocks = reloaded?.messages[0]?.blocks ?? [];
      // text block は不変
      expect(blocks[0]?.type).toBe('text');
      // tool-a は pending のまま
      expect(blocks[1]?.type === 'tool_use' && blocks[1].approval === 'pending').toBe(true);
      // tool-b のみ approved に遷移
      expect(blocks[2]?.type === 'tool_use' && blocks[2].approval === 'approved').toBe(true);
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it('並列 appendBlockToMessage (Promise.all 3 件) が全件永続化される', async () => {
    const projectDir = makeProjectDir();
    try {
      const store = new FileSystemChatStore(projectDir);
      const thread = await store.createChat({ projectId: 'proj-1', title: 't' });
      await store.appendMessage(thread.id, {
        id: 'msg-1',
        role: 'assistant',
        blocks: [],
        createdAt: new Date().toISOString(),
      });
      // 3 つを同時に投げる。mutex で直列化されていないと最後の書き込みが他をロールバックしてしまう。
      await Promise.all([
        store.appendBlockToMessage(thread.id, 'msg-1', { type: 'text', text: 'A' }),
        store.appendBlockToMessage(thread.id, 'msg-1', { type: 'text', text: 'B' }),
        store.appendBlockToMessage(thread.id, 'msg-1', { type: 'text', text: 'C' }),
      ]);
      const reloaded = await store.getChat(thread.id);
      const blocks = reloaded?.messages[0]?.blocks ?? [];
      expect(blocks).toHaveLength(3);
      const texts = blocks
        .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
        .map((b) => b.text)
        .sort();
      expect(texts).toEqual(['A', 'B', 'C']);
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it('deleteChat で YAML が消え listChats から外れる、存在しない id は no-op', async () => {
    const projectDir = makeProjectDir();
    try {
      const store = new FileSystemChatStore(projectDir);
      const t1 = await store.createChat({ projectId: 'p', title: 'a' });
      const t2 = await store.createChat({ projectId: 'p', title: 'b' });
      expect((await store.listChats()).length).toBe(2);
      await store.deleteChat(t1.id);
      const after = await store.listChats();
      expect(after.map((t) => t.id)).toEqual([t2.id]);
      // 存在しない id でも throw しない
      await store.deleteChat('chat-missing');
      expect((await store.listChats()).length).toBe(1);
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });
});
