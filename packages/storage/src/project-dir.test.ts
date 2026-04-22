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
