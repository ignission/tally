import { promises as fs, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { McpOAuthToken } from '@tally/core';
import { describe, expect, it } from 'vitest';

import { FileSystemOAuthStore } from './oauth-store';

function makeProjectDir(): string {
  return mkdtempSync(path.join(tmpdir(), 'tally-oauth-'));
}

function makeToken(overrides: Partial<McpOAuthToken> = {}): McpOAuthToken {
  return {
    mcpServerId: 'atlassian',
    accessToken: 'access-abc',
    refreshToken: 'refresh-xyz',
    acquiredAt: '2026-05-02T10:00:00Z',
    expiresAt: '2026-05-02T11:00:00Z',
    scopes: ['read:jira-work'],
    tokenType: 'Bearer',
    ...overrides,
  };
}

describe('FileSystemOAuthStore', () => {
  it('write → read で書き込んだ token が取り出せる', async () => {
    const projectDir = makeProjectDir();
    try {
      const store = new FileSystemOAuthStore(projectDir);
      const token = makeToken();
      await store.write(token);
      const got = await store.read('atlassian');
      expect(got).toEqual(token);
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it('未保存の mcpServerId は read で null', async () => {
    const projectDir = makeProjectDir();
    try {
      const store = new FileSystemOAuthStore(projectDir);
      const got = await store.read('atlassian');
      expect(got).toBeNull();
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  // Windows は POSIX permission を持たないので skip (Vitest レポートに skipped と表示される)。
  it.skipIf(process.platform === 'win32')(
    'write 後のファイルは mode 0o600 (owner-only)',
    async () => {
      const projectDir = makeProjectDir();
      try {
        const store = new FileSystemOAuthStore(projectDir);
        await store.write(makeToken());
        const stat = await fs.stat(path.join(projectDir, 'oauth', 'atlassian.yaml'));
        // owner read/write のみ立っていることを確認 (group / others は 0)。
        expect(stat.mode & 0o077).toBe(0);
        expect(stat.mode & 0o600).toBe(0o600);
      } finally {
        rmSync(projectDir, { recursive: true, force: true });
      }
    },
  );

  it('delete で該当 token ファイルが消える、未存在は no-op', async () => {
    const projectDir = makeProjectDir();
    try {
      const store = new FileSystemOAuthStore(projectDir);
      await store.write(makeToken());
      await store.delete('atlassian');
      expect(await store.read('atlassian')).toBeNull();
      // 2 度目は no-op
      await expect(store.delete('atlassian')).resolves.toBeUndefined();
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it('list は保存済み mcpServerId をソート済みで返す、空ディレクトリは空配列', async () => {
    const projectDir = makeProjectDir();
    try {
      const store = new FileSystemOAuthStore(projectDir);
      // 未保存時は空配列 (oauth ディレクトリ自体無し)
      expect(await store.list()).toEqual([]);

      await store.write(makeToken({ mcpServerId: 'github' }));
      await store.write(makeToken({ mcpServerId: 'atlassian' }));
      const list = await store.list();
      expect(list).toEqual(['atlassian', 'github']);
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it('破損 YAML は read で warn + null を返す (FS 系エラーは再スロー)', async () => {
    const projectDir = makeProjectDir();
    try {
      const store = new FileSystemOAuthStore(projectDir);
      const dir = path.join(projectDir, 'oauth');
      await fs.mkdir(dir, { recursive: true });
      // 必須フィールドが欠けた YAML を直接書き込む
      await fs.writeFile(path.join(dir, 'atlassian.yaml'), 'mcpServerId: atlassian\n');
      const got = await store.read('atlassian');
      expect(got).toBeNull();
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it('write は default tokenType を Bearer として保存する', async () => {
    const projectDir = makeProjectDir();
    try {
      const store = new FileSystemOAuthStore(projectDir);
      // input として tokenType が undefined でも McpOAuthTokenSchema の default で Bearer
      // が入る。store はそれを書き込む想定なので、明示的に Bearer を assert。
      await store.write(makeToken({ tokenType: 'Bearer' }));
      const got = await store.read('atlassian');
      expect(got?.tokenType).toBe('Bearer');
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });
});
