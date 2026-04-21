import { promises as fs } from 'node:fs';
import path from 'node:path';

import {
  ChatMessageSchema,
  ChatThreadSchema,
  newChatId,
  type ChatBlock,
  type ChatMessage,
  type ChatThread,
  type ChatThreadMeta,
} from '@tally/core';

import { chatFileName, resolveTallyPaths } from './paths';
import { readYaml, writeYaml } from './yaml';

export interface CreateChatInput {
  projectId: string;
  title: string;
}

// .tally/chats/<thread-id>.yaml 単位で 1 ファイル 1 スレッド。
// 単一ユーザー前提だが、chat-runner では同一 assistant message に複数の tool handler が
// 並列で append する可能性があるため、同一スレッドへの書き込みは内部 mutex で FIFO 直列化する。
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
  // 指定 message の blocks に 1 ブロックを追記する。
  // tool_use / tool_result の incremental append 用。
  appendBlockToMessage(
    threadId: string,
    messageId: string,
    block: ChatBlock,
  ): Promise<ChatThread>;
  // 指定 message の blocks 配列を丸ごと置換する。
  // turn 末の text blocks 統合用。
  replaceMessageBlocks(
    threadId: string,
    messageId: string,
    blocks: ChatBlock[],
  ): Promise<ChatThread>;
  // 特定 toolUseId を持つ tool_use block の approval 状態だけ更新する。
  updateBlockApproval(
    threadId: string,
    messageId: string,
    toolUseId: string,
    approval: 'approved' | 'rejected',
  ): Promise<ChatThread>;
  // スレッドを削除する (YAML ファイル単位)。存在しなければ no-op。
  deleteChat(threadId: string): Promise<void>;
}

export class FileSystemChatStore implements ChatStore {
  private readonly paths: ReturnType<typeof resolveTallyPaths>;
  // 同一スレッドへの書き込みを FIFO 直列化するための mutex 集合。
  // 並列 appendBlockToMessage が来た時に read-modify-write が重ならないようにする。
  private readonly writeLocks = new Map<string, Promise<unknown>>();

  constructor(workspaceRoot: string) {
    this.paths = resolveTallyPaths(workspaceRoot);
  }

  // 指定 threadId に対する書き込みを直列化する。
  // 既存チェーンの末尾に fn を繋ぎ、全てチェーンが完了したら Map から除去する。
  private async withWriteLock<T>(threadId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.writeLocks.get(threadId) ?? Promise.resolve();
    // 前段が reject した場合もチェーンを切らさないため catch でも fn を実行する。
    const next = prev.then(fn, fn);
    this.writeLocks.set(threadId, next);
    try {
      return await next;
    } finally {
      // 自分が末尾である間だけ片付ける (後続が同一 key で上書きしていれば残す)。
      if (this.writeLocks.get(threadId) === next) this.writeLocks.delete(threadId);
    }
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
    return this.withWriteLock(threadId, async () => {
      const thread = await this.getChat(threadId);
      if (!thread) throw new Error(`thread が存在しない: ${threadId}`);
      ChatMessageSchema.parse(message); // 事前検証
      const next: ChatThread = {
        ...thread,
        messages: [...thread.messages, message],
        updatedAt: new Date().toISOString(),
      };
      await writeYaml(path.join(this.paths.chatsDir, chatFileName(threadId)), next);
      return next;
    });
  }

  async updateMessageBlock(
    threadId: string,
    messageId: string,
    blockIndex: number,
    block: ChatBlock,
  ): Promise<ChatThread> {
    return this.withWriteLock(threadId, async () => {
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
    });
  }

  async updateChatTitle(threadId: string, title: string): Promise<ChatThread> {
    return this.withWriteLock(threadId, async () => {
      const thread = await this.getChat(threadId);
      if (!thread) throw new Error(`thread が存在しない: ${threadId}`);
      const next: ChatThread = {
        ...thread,
        title,
        updatedAt: new Date().toISOString(),
      };
      await writeYaml(path.join(this.paths.chatsDir, chatFileName(threadId)), next);
      return next;
    });
  }

  async appendBlockToMessage(
    threadId: string,
    messageId: string,
    block: ChatBlock,
  ): Promise<ChatThread> {
    return this.withWriteLock(threadId, async () => {
      const thread = await this.getChat(threadId);
      if (!thread) throw new Error(`thread が存在しない: ${threadId}`);
      const target = thread.messages.find((m) => m.id === messageId);
      if (!target) {
        throw new Error(`message が存在しない: thread=${threadId} message=${messageId}`);
      }
      const messages = thread.messages.map((m) =>
        m.id === messageId ? { ...m, blocks: [...m.blocks, block] } : m,
      );
      const next: ChatThread = {
        ...thread,
        messages,
        updatedAt: new Date().toISOString(),
      };
      await writeYaml(path.join(this.paths.chatsDir, chatFileName(threadId)), next);
      return next;
    });
  }

  async replaceMessageBlocks(
    threadId: string,
    messageId: string,
    blocks: ChatBlock[],
  ): Promise<ChatThread> {
    return this.withWriteLock(threadId, async () => {
      const thread = await this.getChat(threadId);
      if (!thread) throw new Error(`thread が存在しない: ${threadId}`);
      const target = thread.messages.find((m) => m.id === messageId);
      if (!target) {
        throw new Error(`message が存在しない: thread=${threadId} message=${messageId}`);
      }
      const messages = thread.messages.map((m) =>
        m.id === messageId ? { ...m, blocks: [...blocks] } : m,
      );
      const next: ChatThread = {
        ...thread,
        messages,
        updatedAt: new Date().toISOString(),
      };
      await writeYaml(path.join(this.paths.chatsDir, chatFileName(threadId)), next);
      return next;
    });
  }

  async updateBlockApproval(
    threadId: string,
    messageId: string,
    toolUseId: string,
    approval: 'approved' | 'rejected',
  ): Promise<ChatThread> {
    return this.withWriteLock(threadId, async () => {
      const thread = await this.getChat(threadId);
      if (!thread) throw new Error(`thread が存在しない: ${threadId}`);
      const target = thread.messages.find((m) => m.id === messageId);
      if (!target) {
        throw new Error(`message が存在しない: thread=${threadId} message=${messageId}`);
      }
      // toolUseId 一致する tool_use block だけ approval を差替える (他は不変)。
      const messages = thread.messages.map((m) => {
        if (m.id !== messageId) return m;
        const blocks = m.blocks.map((b) =>
          b.type === 'tool_use' && b.toolUseId === toolUseId ? { ...b, approval } : b,
        );
        return { ...m, blocks };
      });
      const next: ChatThread = {
        ...thread,
        messages,
        updatedAt: new Date().toISOString(),
      };
      await writeYaml(path.join(this.paths.chatsDir, chatFileName(threadId)), next);
      return next;
    });
  }

  async deleteChat(threadId: string): Promise<void> {
    return this.withWriteLock(threadId, async () => {
      const file = path.join(this.paths.chatsDir, chatFileName(threadId));
      try {
        await fs.unlink(file);
      } catch (err) {
        // 存在しなければ no-op (冪等)。他のエラーは投げる。
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      }
    });
  }
}
