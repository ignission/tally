import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createEdge,
  createNode,
  createProject,
  deleteEdge,
  deleteNode,
  fetchDefaultProjectPath,
  fetchRegistryProjects,
  importProject,
  listDirectory,
  mkdir,
  patchProjectMeta,
  unregisterProjectApi,
  updateEdge,
  updateNode,
} from './api';

const PID = 'proj-abc';

describe('lib/api', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function okJson<T>(body: T) {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  }

  it('createNode は POST /api/projects/:id/nodes', async () => {
    const created = {
      id: 'req-xxxxx',
      type: 'requirement',
      x: 10,
      y: 20,
      title: 't',
      body: 'b',
    };
    okJson(created);
    const result = await createNode(PID, {
      type: 'requirement',
      x: 10,
      y: 20,
      title: 't',
      body: 'b',
    });
    expect(result).toEqual(created);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/projects/${PID}/nodes`);
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ 'content-type': 'application/json' });
    expect(JSON.parse(init.body as string)).toEqual({
      type: 'requirement',
      x: 10,
      y: 20,
      title: 't',
      body: 'b',
    });
  });

  it('updateNode は PATCH /api/projects/:id/nodes/:nid', async () => {
    okJson({ ok: true });
    await updateNode<'requirement'>(PID, 'req-xxxxx', { title: 'new' });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/projects/${PID}/nodes/req-xxxxx`);
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body as string)).toEqual({ title: 'new' });
  });

  it('deleteNode は DELETE /api/projects/:id/nodes/:nid', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await deleteNode(PID, 'req-xxxxx');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/projects/${PID}/nodes/req-xxxxx`);
    expect(init.method).toBe('DELETE');
  });

  it('createEdge は POST /api/projects/:id/edges', async () => {
    const created = { id: 'e-xxxxx', from: 'req-a', to: 'uc-b', type: 'satisfy' };
    okJson(created);
    const result = await createEdge(PID, { from: 'req-a', to: 'uc-b', type: 'satisfy' });
    expect(result).toEqual(created);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/projects/${PID}/edges`);
    expect(init.method).toBe('POST');
  });

  it('updateEdge は PATCH /api/projects/:id/edges/:eid (type のみ)', async () => {
    okJson({ ok: true });
    await updateEdge(PID, 'e-xxxxx', 'refine');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/projects/${PID}/edges/e-xxxxx`);
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body as string)).toEqual({ type: 'refine' });
  });

  it('deleteEdge は DELETE /api/projects/:id/edges/:eid', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await deleteEdge(PID, 'e-xxxxx');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/projects/${PID}/edges/e-xxxxx`);
    expect(init.method).toBe('DELETE');
  });

  it('4xx はエラーとして throw する', async () => {
    fetchMock.mockResolvedValueOnce(new Response('bad', { status: 400 }));
    await expect(updateNode<'requirement'>(PID, 'req-xxxxx', { title: 'x' })).rejects.toThrow(/400/);
  });

  it('patchProjectMeta は PATCH /api/projects/:id', async () => {
    const updated = {
      id: PID,
      name: 'P',
      codebases: [{ id: 'backend', label: 'Backend', path: '../backend' }],
      createdAt: '2026-04-18T00:00:00Z',
      updatedAt: '2026-04-19T00:00:00Z',
    };
    okJson(updated);
    const result = await patchProjectMeta(PID, { codebases: [{ id: 'backend', label: 'Backend', path: '../backend' }] });
    expect(result).toEqual(updated);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/projects/${PID}`);
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body as string)).toEqual({ codebases: [{ id: 'backend', label: 'Backend', path: '../backend' }] });
  });

  it('patchProjectMeta は null で codebases 削除シグナル', async () => {
    okJson({
      id: PID,
      name: 'P',
      codebases: [],
      createdAt: '2026-04-18T00:00:00Z',
      updatedAt: '2026-04-19T00:00:00Z',
    });
    await patchProjectMeta(PID, { codebases: [] });
    const [, init] = fetchMock.mock.calls[0] as [unknown, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ codebases: [] });
  });

  it('updateNode は undefined 値を null に変換して送信する', async () => {
    okJson({ ok: true });
    // 汎用 NodePatchInput は全ノード型の共通交差型になるため、
    // 型別のプロパティ (kind/priority 等) を渡すには型引数を明示する。
    await updateNode<'requirement'>(PID, 'req-xxxxx', { kind: undefined, priority: 'must' });
    const firstCall = fetchMock.mock.calls[0];
    expect(firstCall).toBeDefined();
    const [, init] = firstCall as [unknown, RequestInit];
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.kind).toBeNull();
    expect(body.priority).toBe('must');
  });
});

describe('fetchRegistryProjects', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('GET /api/projects を叩いて projects を返す', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ projects: [{ id: 'a', name: 'A', codebases: [] }] }),
        { status: 200 },
      ),
    ) as typeof fetch;
    const list = await fetchRegistryProjects();
    expect(list[0]?.id).toBe('a');
  });
});

describe('createProject', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('POST /api/projects に projectDir + codebases を渡す', async () => {
    const spy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: 'new', projectDir: '/x' }), { status: 201 }),
    );
    globalThis.fetch = spy as typeof fetch;
    const res = await createProject({
      projectDir: '/some/dir',
      name: 'n',
      codebases: [{ id: 'web', label: 'Web', path: '/w' }],
    });
    expect(res.id).toBe('new');
    const call = spy.mock.calls[0];
    expect(call?.[0]).toBe('/api/projects');
    const body = JSON.parse((call?.[1] as RequestInit).body as string) as Record<string, unknown>;
    expect(body.projectDir).toBe('/some/dir');
    const codebases = body.codebases as Array<{ id: string }>;
    expect(codebases[0]?.id).toBe('web');
  });
});

describe('importProject', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('POST /api/projects/import を叩く', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: 'x', projectDir: '/x' }), { status: 201 }),
    ) as typeof fetch;
    const res = await importProject('/some/dir');
    expect(res.id).toBe('x');
  });
});

describe('unregisterProjectApi', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('POST /api/projects/:id/unregister を叩く', async () => {
    const spy = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    globalThis.fetch = spy as typeof fetch;
    await unregisterProjectApi('proj-a');
    expect(spy.mock.calls[0]?.[0]).toBe('/api/projects/proj-a/unregister');
  });
});

describe('listDirectory', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('/api/fs/ls を叩く', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          path: '/a',
          parent: null,
          entries: [],
          containsProjectYaml: false,
        }),
        { status: 200 },
      ),
    ) as typeof fetch;
    const res = await listDirectory('/a');
    expect(res.path).toBe('/a');
  });

  it('path 省略時は path パラメータを付けない', async () => {
    const spy = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ path: '/home', parent: null, entries: [], containsProjectYaml: false }),
        { status: 200 },
      ),
    );
    globalThis.fetch = spy as typeof fetch;
    await listDirectory();
    const url = spy.mock.calls[0]?.[0] as string;
    expect(url).not.toContain('?path=');
  });
});

describe('mkdir', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('POST /api/fs/mkdir に path / name を渡す', async () => {
    const spy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ path: '/a/b' }), { status: 201 }),
    );
    globalThis.fetch = spy as typeof fetch;
    const res = await mkdir('/a', 'b');
    expect(res.path).toBe('/a/b');
    const body = JSON.parse((spy.mock.calls[0]?.[1] as RequestInit).body as string) as unknown;
    expect(body).toEqual({ path: '/a', name: 'b' });
  });
});

describe('fetchDefaultProjectPath', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('/api/projects/default-path?name= を叩いて path を返す', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ path: '/home/you/.local/share/tally/projects/my-proj' }),
        {
          status: 200,
        },
      ),
    ) as typeof fetch;
    const p = await fetchDefaultProjectPath('My Proj');
    expect(p).toContain('/my-proj');
  });
});
