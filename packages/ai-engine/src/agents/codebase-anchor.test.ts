import { promises as fs } from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { ProjectStore } from '@tally/storage';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { validateCodebaseAnchor } from './codebase-anchor';

function makeStore(overrides: Partial<ProjectStore>): ProjectStore {
  return {
    getNode: vi.fn().mockResolvedValue(null),
    getProjectMeta: vi.fn().mockResolvedValue(null),
    ...overrides,
  } as unknown as ProjectStore;
}

describe('validateCodebaseAnchor', () => {
  const workspaceRoot = '/workspace';
  const allowed = ['usecase', 'requirement', 'userstory'] as const;

  it('nodeId が存在しなければ not_found', async () => {
    const store = makeStore({ getNode: vi.fn().mockResolvedValue(null) });
    const r = await validateCodebaseAnchor(
      { store, workspaceRoot },
      'x',
      allowed,
      'analyze-impact',
    );
    expect(r).toEqual({ ok: false, code: 'not_found', message: expect.stringContaining('x') });
  });

  it('対象外 type なら bad_request', async () => {
    const store = makeStore({
      getNode: vi
        .fn()
        .mockResolvedValue({ id: 'n', type: 'issue', x: 0, y: 0, title: '', body: '' }),
    });
    const r = await validateCodebaseAnchor(
      { store, workspaceRoot },
      'n',
      allowed,
      'analyze-impact',
    );
    expect(r).toEqual({
      ok: false,
      code: 'bad_request',
      message: expect.stringContaining('analyze-impact'),
    });
  });

  it('codebasePath 未設定なら bad_request', async () => {
    const store = makeStore({
      getNode: vi
        .fn()
        .mockResolvedValue({ id: 'uc', type: 'usecase', x: 0, y: 0, title: '', body: '' }),
      getProjectMeta: vi
        .fn()
        .mockResolvedValue({ id: 'p', name: 'x', createdAt: '', updatedAt: '' }),
    });
    const r = await validateCodebaseAnchor(
      { store, workspaceRoot },
      'uc',
      allowed,
      'analyze-impact',
    );
    expect(r).toEqual({
      ok: false,
      code: 'bad_request',
      message: expect.stringContaining('codebasePath'),
    });
  });

  it('codebasePath 解決先が存在しなければ not_found', async () => {
    const store = makeStore({
      getNode: vi
        .fn()
        .mockResolvedValue({ id: 'uc', type: 'usecase', x: 0, y: 0, title: '', body: '' }),
      getProjectMeta: vi.fn().mockResolvedValue({
        id: 'p',
        name: 'x',
        codebasePath: '/nonexistent/path/xyz',
        createdAt: '',
        updatedAt: '',
      }),
    });
    const r = await validateCodebaseAnchor(
      { store, workspaceRoot: '/' },
      'uc',
      allowed,
      'analyze-impact',
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('not_found');
  });

  it('codebasePath がファイルなら bad_request', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'cba-'));
    const file = path.join(dir, 'a.txt');
    await fs.writeFile(file, 'x');
    const store = makeStore({
      getNode: vi
        .fn()
        .mockResolvedValue({ id: 'uc', type: 'usecase', x: 0, y: 0, title: '', body: '' }),
      getProjectMeta: vi
        .fn()
        .mockResolvedValue({
          id: 'p',
          name: 'x',
          codebasePath: 'a.txt',
          createdAt: '',
          updatedAt: '',
        }),
    });
    const r = await validateCodebaseAnchor(
      { store, workspaceRoot: dir },
      'uc',
      allowed,
      'analyze-impact',
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('bad_request');
    rmSync(dir, { recursive: true, force: true });
  });

  it('成功時は anchor と cwd を返す', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'cba-'));
    const node = { id: 'uc', type: 'usecase', x: 0, y: 0, title: '', body: '' };
    const store = makeStore({
      getNode: vi.fn().mockResolvedValue(node),
      getProjectMeta: vi
        .fn()
        .mockResolvedValue({ id: 'p', name: 'x', codebasePath: '.', createdAt: '', updatedAt: '' }),
    });
    const r = await validateCodebaseAnchor(
      { store, workspaceRoot: dir },
      'uc',
      allowed,
      'analyze-impact',
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.anchor).toEqual(node);
      expect(r.cwd).toBe(path.resolve(dir, '.'));
    }
    rmSync(dir, { recursive: true, force: true });
  });

  it('requireCodebasePath: false なら codebasePath 未設定でも ok', async () => {
    const node = { id: 'uc', type: 'usecase', x: 0, y: 0, title: '', body: '' };
    const store = makeStore({
      getNode: vi.fn().mockResolvedValue(node),
      getProjectMeta: vi
        .fn()
        .mockResolvedValue({ id: 'p', name: 'x', createdAt: '', updatedAt: '' }),
    });
    const r = await validateCodebaseAnchor(
      { store, workspaceRoot },
      'uc',
      allowed,
      'extract-questions',
      { requireCodebasePath: false },
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.anchor).toEqual(node);
      expect(r.cwd).toBeUndefined();
    }
  });

  it('requireCodebasePath: false でも nodeId 不存在 / 対象外 type は従来通り弾く', async () => {
    const store = makeStore({ getNode: vi.fn().mockResolvedValue(null) });
    const r = await validateCodebaseAnchor(
      { store, workspaceRoot },
      'missing',
      allowed,
      'extract-questions',
      { requireCodebasePath: false },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('not_found');
  });
});
