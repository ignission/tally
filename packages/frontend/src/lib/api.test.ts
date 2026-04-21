import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createEdge,
  createNode,
  deleteEdge,
  deleteNode,
  patchProjectMeta,
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
    await updateNode(PID, 'req-xxxxx', { title: 'new' });
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
    await expect(updateNode(PID, 'req-xxxxx', { title: 'x' })).rejects.toThrow(/400/);
  });

  it('patchProjectMeta は PATCH /api/projects/:id', async () => {
    const updated = {
      id: PID,
      name: 'P',
      codebasePath: '../backend',
      createdAt: '2026-04-18T00:00:00Z',
      updatedAt: '2026-04-19T00:00:00Z',
    };
    okJson(updated);
    const result = await patchProjectMeta(PID, { codebasePath: '../backend' });
    expect(result).toEqual(updated);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/projects/${PID}`);
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body as string)).toEqual({ codebasePath: '../backend' });
  });

  it('patchProjectMeta は null で codebasePath 削除シグナル', async () => {
    okJson({
      id: PID,
      name: 'P',
      createdAt: '2026-04-18T00:00:00Z',
      updatedAt: '2026-04-19T00:00:00Z',
    });
    await patchProjectMeta(PID, { codebasePath: null });
    const [, init] = fetchMock.mock.calls[0] as [unknown, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ codebasePath: null });
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
