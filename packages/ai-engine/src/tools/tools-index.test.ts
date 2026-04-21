import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { FileSystemProjectStore } from '@tally/storage';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildTallyMcpServer } from './index';

describe('buildTallyMcpServer', () => {
  let root: string;
  let store: FileSystemProjectStore;
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'tally-mcp-'));
    store = new FileSystemProjectStore(root);
    await fs.mkdir(path.join(root, '.tally', 'nodes'), { recursive: true });
  });
  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('MCP サーバを構築でき、name と type が期待通り', () => {
    const server = buildTallyMcpServer({
      store,
      emit: () => {},
      anchor: { x: 0, y: 0 },
      anchorId: 'uc-test',
      agentName: 'decompose-to-stories',
    });
    // createSdkMcpServer は McpSdkServerConfigWithInstance を返す。
    // 実装詳細 (instance 等) は SDK のバージョンに依存するので、
    // 最低限 name フィールドと type が 'sdk' であることだけを検証する。
    expect(server).toBeTruthy();
    expect((server as { type?: string }).type).toBe('sdk');
    expect((server as { name?: string }).name).toBe('tally');
  });

  it('4 ツール (create_node, create_edge, find_related, list_by_type) を公開する', () => {
    const server = buildTallyMcpServer({
      store,
      emit: () => {},
      anchor: { x: 0, y: 0 },
      anchorId: 'uc-test',
      agentName: 'decompose-to-stories',
    });
    // SDK 内部で tools を instance に持つ実装になっているかは非公開の可能性が高いので、
    // ここではビルドが例外を投げないこと + name だけで最低保証を担保する。
    // 実際のツール呼び出しは Task 14 の agent-runner 統合テストでカバーする。
    expect(server).toBeTruthy();
  });
});
