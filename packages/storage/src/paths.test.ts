import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { chatFileName, nodeFileName, resolveTallyPaths } from './paths';

describe('resolveTallyPaths', () => {
  it('workspaceRoot 配下の .tally/ サブツリーを返す', () => {
    const p = resolveTallyPaths('/tmp/repo');
    expect(p.root).toBe('/tmp/repo/.tally');
    expect(p.projectFile).toBe('/tmp/repo/.tally/project.yaml');
    expect(p.nodesDir).toBe('/tmp/repo/.tally/nodes');
    expect(p.edgesFile).toBe('/tmp/repo/.tally/edges/edges.yaml');
    expect(p.chatsDir).toBe('/tmp/repo/.tally/chats');
  });

  it('相対パスも絶対化する', () => {
    const p = resolveTallyPaths('./repo');
    expect(path.isAbsolute(p.root)).toBe(true);
  });
});

describe('nodeFileName', () => {
  it('id.yaml を返す', () => {
    expect(nodeFileName('req-invite')).toBe('req-invite.yaml');
    expect(nodeFileName('q-link-expiry')).toBe('q-link-expiry.yaml');
  });
});

describe('chatFileName', () => {
  it('thread-id.yaml を返す', () => {
    expect(chatFileName('chat-abc123')).toBe('chat-abc123.yaml');
  });
});
