import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { FileSystemProjectStore, initProject, listProjects } from '@tally/storage';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { GET, PATCH } from './route';

let home: string;
let ws: string;
let projectId: string;
const prevHome = process.env.TALLY_HOME;

beforeEach(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), 'tally-home-'));
  ws = await fs.mkdtemp(path.join(os.tmpdir(), 'tally-ws-'));
  process.env.TALLY_HOME = home;
  const res = await initProject({
    projectDir: path.join(ws, 'p'),
    name: 'P',
    codebases: [],
  });
  projectId = res.id;
});

afterEach(async () => {
  if (prevHome === undefined) delete process.env.TALLY_HOME;
  else process.env.TALLY_HOME = prevHome;
  await fs.rm(home, { recursive: true, force: true });
  await fs.rm(ws, { recursive: true, force: true });
});

describe('GET /api/projects/:id', () => {
  it('プロジェクトを返し、touchProject を呼ぶ', async () => {
    const before = Date.now();
    await new Promise((r) => setTimeout(r, 5));
    const res = await GET(new Request('http://localhost'), {
      params: Promise.resolve({ id: projectId }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; codebases: unknown[] };
    expect(body.id).toBe(projectId);
    expect(body.codebases).toEqual([]);
    const list = await listProjects();
    const entry = list.find((p) => p.id === projectId);
    expect(entry).toBeDefined();
    expect(new Date(entry?.lastOpenedAt ?? '').getTime()).toBeGreaterThanOrEqual(before);
  });

  it('未知 id は 404', async () => {
    const res = await GET(new Request('http://localhost'), {
      params: Promise.resolve({ id: 'nope' }),
    });
    expect(res.status).toBe(404);
  });
});

describe('PATCH /api/projects/:id', () => {
  it('codebases を全置換', async () => {
    const res = await PATCH(
      new Request('http://localhost', {
        method: 'PATCH',
        body: JSON.stringify({ codebases: [{ id: 'web', label: 'Web', path: '/w' }] }),
      }),
      { params: Promise.resolve({ id: projectId }) },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { codebases: unknown };
    expect(body.codebases).toEqual([{ id: 'web', label: 'Web', path: '/w' }]);
  });

  it('mcpServers[] を全置換 (Task 16)', async () => {
    const res = await PATCH(
      new Request('http://localhost', {
        method: 'PATCH',
        body: JSON.stringify({
          mcpServers: [
            {
              id: 'atlassian',
              name: 'Atlassian',
              kind: 'atlassian',
              url: 'https://x.test/mcp',
              auth: { type: 'pat', scheme: 'bearer', tokenEnvVar: 'JIRA_PAT' },
              options: { maxChildIssues: 30, maxCommentsPerIssue: 5 },
            },
          ],
        }),
      }),
      { params: Promise.resolve({ id: projectId }) },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { mcpServers: Array<{ id: string }> };
    expect(body.mcpServers).toHaveLength(1);
    expect(body.mcpServers[0]?.id).toBe('atlassian');
  });

  it('mcpServers の url が http (loopback 以外) なら 400 (Task 1 hardening)', async () => {
    const res = await PATCH(
      new Request('http://localhost', {
        method: 'PATCH',
        body: JSON.stringify({
          mcpServers: [
            {
              id: 'a',
              name: 'A',
              kind: 'atlassian',
              url: 'http://example.com/mcp',
              auth: { type: 'pat', scheme: 'bearer', tokenEnvVar: 'X' },
              options: { maxChildIssues: 30, maxCommentsPerIssue: 5 },
            },
          ],
        }),
      }),
      { params: Promise.resolve({ id: projectId }) },
    );
    expect(res.status).toBe(400);
  });

  it('mcpServers を空配列で全消去できる', async () => {
    // 事前に登録
    await PATCH(
      new Request('http://localhost', {
        method: 'PATCH',
        body: JSON.stringify({
          mcpServers: [
            {
              id: 'a',
              name: 'A',
              kind: 'atlassian',
              url: 'https://x.test/mcp',
              auth: { type: 'pat', scheme: 'bearer', tokenEnvVar: 'X' },
              options: { maxChildIssues: 30, maxCommentsPerIssue: 5 },
            },
          ],
        }),
      }),
      { params: Promise.resolve({ id: projectId }) },
    );
    // 空配列で全消去
    const res = await PATCH(
      new Request('http://localhost', {
        method: 'PATCH',
        body: JSON.stringify({ mcpServers: [] }),
      }),
      { params: Promise.resolve({ id: projectId }) },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { mcpServers: unknown[] };
    expect(body.mcpServers).toEqual([]);
  });

  it('name を更新', async () => {
    const res = await PATCH(
      new Request('http://localhost', {
        method: 'PATCH',
        body: JSON.stringify({ name: 'newname' }),
      }),
      { params: Promise.resolve({ id: projectId }) },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { name: string };
    expect(body.name).toBe('newname');
  });

  it('description に null を渡すと削除', async () => {
    // 事前に description を設定
    await PATCH(
      new Request('http://localhost', {
        method: 'PATCH',
        body: JSON.stringify({ description: 'initial' }),
      }),
      { params: Promise.resolve({ id: projectId }) },
    );
    const res = await PATCH(
      new Request('http://localhost', {
        method: 'PATCH',
        body: JSON.stringify({ description: null }),
      }),
      { params: Promise.resolve({ id: projectId }) },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { description?: string };
    expect(body.description).toBeUndefined();
  });

  it('未知フィールドは strict で 400', async () => {
    const res = await PATCH(
      new Request('http://localhost', {
        method: 'PATCH',
        body: JSON.stringify({ codebasePath: '/old' }),
      }),
      { params: Promise.resolve({ id: projectId }) },
    );
    expect(res.status).toBe(400);
  });

  it('codebases[].id 重複は 400', async () => {
    const res = await PATCH(
      new Request('http://localhost', {
        method: 'PATCH',
        body: JSON.stringify({
          codebases: [
            { id: 'a', label: 'A', path: '/a' },
            { id: 'a', label: 'A2', path: '/b' },
          ],
        }),
      }),
      { params: Promise.resolve({ id: projectId }) },
    );
    expect(res.status).toBe(400);
  });

  it('codebase 削除で orphan になる coderef ノードがあれば 409 と nodeIds を返す', async () => {
    // codebase を追加してから coderef ノードを作成する
    await PATCH(
      new Request('http://localhost', {
        method: 'PATCH',
        body: JSON.stringify({ codebases: [{ id: 'web', label: 'Web', path: '/w' }] }),
      }),
      { params: Promise.resolve({ id: projectId }) },
    );
    const store = new FileSystemProjectStore(path.join(ws, 'p'));
    const node = await store.addNode({
      type: 'coderef',
      x: 0,
      y: 0,
      title: 'ref',
      body: '',
      codebaseId: 'web',
    });
    // codebase を空にして coderef が orphan になるリクエストを送る
    const res = await PATCH(
      new Request('http://localhost', {
        method: 'PATCH',
        body: JSON.stringify({ codebases: [] }),
      }),
      { params: Promise.resolve({ id: projectId }) },
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string; nodeIds: string[] };
    expect(body.nodeIds).toContain(node.id);
  });
});

describe('GET/PATCH /api/projects/:id — registry id mismatch', () => {
  it('GET: registry id と project.yaml id が不一致なら 409', async () => {
    // project.yaml の id を直接書き換えてズレを作る
    const yamlPath = path.join(ws, 'p', 'project.yaml');
    const content = await fs.readFile(yamlPath, 'utf-8');
    await fs.writeFile(yamlPath, content.replace(`id: ${projectId}`, 'id: different-id'));
    const res = await GET(new Request('http://localhost'), {
      params: Promise.resolve({ id: projectId }),
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { registryId: string; fileId: string };
    expect(body.registryId).toBe(projectId);
    expect(body.fileId).toBe('different-id');
  });

  it('PATCH: registry id と project.yaml id が不一致なら 409', async () => {
    const yamlPath = path.join(ws, 'p', 'project.yaml');
    const content = await fs.readFile(yamlPath, 'utf-8');
    await fs.writeFile(yamlPath, content.replace(`id: ${projectId}`, 'id: different-id'));
    const res = await PATCH(
      new Request('http://localhost', {
        method: 'PATCH',
        body: JSON.stringify({ name: 'new-name' }),
      }),
      { params: Promise.resolve({ id: projectId }) },
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { registryId: string; fileId: string };
    expect(body.registryId).toBe(projectId);
    expect(body.fileId).toBe('different-id');
  });
});
