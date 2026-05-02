import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { __resetAllFlowsForTest, getOAuthFlowStatus } from '@tally/ai-engine';
import { FileSystemProjectStore, initProject } from '@tally/storage';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DELETE, GET, POST } from './route';

let home: string;
let ws: string;
let projectId: string;
let projectDir: string;
const prevHome = process.env.TALLY_HOME;

beforeEach(async () => {
  await __resetAllFlowsForTest();
  home = await fs.mkdtemp(path.join(os.tmpdir(), 'tally-home-'));
  ws = await fs.mkdtemp(path.join(os.tmpdir(), 'tally-ws-'));
  process.env.TALLY_HOME = home;
  projectDir = path.join(ws, 'p');
  const res = await initProject({ projectDir, name: 'P', codebases: [] });
  projectId = res.id;
});

afterEach(async () => {
  await __resetAllFlowsForTest();
  vi.unstubAllGlobals();
  if (prevHome === undefined) delete process.env.TALLY_HOME;
  else process.env.TALLY_HOME = prevHome;
  await fs.rm(home, { recursive: true, force: true });
  await fs.rm(ws, { recursive: true, force: true });
});

// project meta に Atlassian の mcpServer (oauth 設定付き) を 1 件追加する helper。
// ADR-0011 PR-E4: oauth は schema 上 required になったので、テストは常に clientId 込みで投入する。
async function addAtlassianServer(): Promise<void> {
  const store = new FileSystemProjectStore(projectDir);
  const meta = await store.getProjectMeta();
  if (!meta) throw new Error('meta missing');
  await store.saveProjectMeta({
    ...meta,
    mcpServers: [
      {
        id: 'atlassian',
        name: 'Atlassian',
        kind: 'atlassian',
        url: 'https://api.atlassian.com/mcp',
        oauth: { clientId: 'cid-xyz' },
        options: { maxChildIssues: 30, maxCommentsPerIssue: 5 },
      },
    ],
    updatedAt: new Date().toISOString(),
  });
}

describe('POST /api/projects/:id/mcp/:mcpServerId/oauth', () => {
  it('start で authorizationUrl を返し、orchestrator が pending になる', async () => {
    await addAtlassianServer();
    const res = await POST(new Request('http://localhost', { method: 'POST' }), {
      params: Promise.resolve({ id: projectId, mcpServerId: 'atlassian' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { authorizationUrl: string };
    expect(body.authorizationUrl).toMatch(/^https:\/\/auth\.atlassian\.com\/authorize\?/);
    expect(body.authorizationUrl).toContain('client_id=cid-xyz');
    // orchestrator state も pending
    expect(getOAuthFlowStatus(projectId, 'atlassian')?.status).toBe('pending');
  });

  it('未知 project id は 404', async () => {
    const res = await POST(new Request('http://localhost', { method: 'POST' }), {
      params: Promise.resolve({ id: 'nope', mcpServerId: 'atlassian' }),
    });
    expect(res.status).toBe(404);
  });

  it('未知 mcpServerId は 404', async () => {
    await addAtlassianServer();
    const res = await POST(new Request('http://localhost', { method: 'POST' }), {
      params: Promise.resolve({ id: projectId, mcpServerId: 'no-such' }),
    });
    expect(res.status).toBe(404);
  });

  // ADR-0011 PR-E4: oauth は schema 上 required になったため、`oauth 未設定` の case は
  // YAML の手動編集等で起きうる「壊れた状態」だが、route.ts の事前チェックは保ったまま
  // (server.oauth が undefined になるパス) で残す。type 上は到達不能だがコンパイル制約の
  // 緩和で fall-through するので、test では再現しない。

  it('既に pending の状態で再 start すると 409 Conflict (UI 漏洩しない固定文言)', async () => {
    await addAtlassianServer();
    // 1 回目 start
    const r1 = await POST(new Request('http://localhost', { method: 'POST' }), {
      params: Promise.resolve({ id: projectId, mcpServerId: 'atlassian' }),
    });
    expect(r1.status).toBe(200);
    // 2 回目 start (pending 中)
    const r2 = await POST(new Request('http://localhost', { method: 'POST' }), {
      params: Promise.resolve({ id: projectId, mcpServerId: 'atlassian' }),
    });
    expect(r2.status).toBe(409);
    const body = (await r2.json()) as { error: string };
    // 内部の `OAuth flow already in progress for "atlassian"` を直接出さず固定文言で返す
    expect(body.error).toBe('oauth flow already in progress');
  });
});

describe('GET /api/projects/:id/mcp/:mcpServerId/oauth', () => {
  it('未開始は 404', async () => {
    const res = await GET(new Request('http://localhost'), {
      params: Promise.resolve({ id: projectId, mcpServerId: 'atlassian' }),
    });
    expect(res.status).toBe(404);
  });

  it('start 後は pending 状態を返す', async () => {
    await addAtlassianServer();
    await POST(new Request('http://localhost', { method: 'POST' }), {
      params: Promise.resolve({ id: projectId, mcpServerId: 'atlassian' }),
    });
    const res = await GET(new Request('http://localhost'), {
      params: Promise.resolve({ id: projectId, mcpServerId: 'atlassian' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; authorizationUrl: string };
    expect(body.status).toBe('pending');
    expect(body.authorizationUrl).toMatch(/^https:\/\/auth\.atlassian\.com\//);
  });
});

describe('DELETE /api/projects/:id/mcp/:mcpServerId/oauth', () => {
  it('進行中フローを clear し、再 start が可能になる', async () => {
    await addAtlassianServer();
    await POST(new Request('http://localhost', { method: 'POST' }), {
      params: Promise.resolve({ id: projectId, mcpServerId: 'atlassian' }),
    });
    expect(getOAuthFlowStatus(projectId, 'atlassian')?.status).toBe('pending');

    const del = await DELETE(new Request('http://localhost', { method: 'DELETE' }), {
      params: Promise.resolve({ id: projectId, mcpServerId: 'atlassian' }),
    });
    expect(del.status).toBe(200);
    expect(getOAuthFlowStatus(projectId, 'atlassian')).toBeNull();

    // clear 後の再 start は 409 にならず正常
    const r = await POST(new Request('http://localhost', { method: 'POST' }), {
      params: Promise.resolve({ id: projectId, mcpServerId: 'atlassian' }),
    });
    expect(r.status).toBe(200);
  });

  it('未開始でも 200 を返す (idempotent)', async () => {
    const res = await DELETE(new Request('http://localhost', { method: 'DELETE' }), {
      params: Promise.resolve({ id: projectId, mcpServerId: 'atlassian' }),
    });
    expect(res.status).toBe(200);
  });
});
