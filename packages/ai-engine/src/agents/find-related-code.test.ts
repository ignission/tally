import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { FileSystemProjectStore } from '@tally/storage';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildFindRelatedCodePrompt, findRelatedCodeAgent } from './find-related-code';

describe('buildFindRelatedCodePrompt', () => {
  it('system プロンプトに Edit/Write/Bash の禁止と coderef proposal の契約が入っている', () => {
    const p = buildFindRelatedCodePrompt({
      anchor: { id: 'uc-1', type: 'usecase', x: 0, y: 0, title: '招待', body: 'メール招待' },
    });
    expect(p.systemPrompt).toContain('coderef');
    expect(p.systemPrompt).toContain('derive');
    expect(p.systemPrompt).toContain('Edit');
    expect(p.systemPrompt).toContain('Write');
    expect(p.systemPrompt).toContain('Bash');
  });

  it('user プロンプトに anchor の id / title / body が含まれる', () => {
    const p = buildFindRelatedCodePrompt({
      anchor: { id: 'uc-1', type: 'usecase', x: 0, y: 0, title: '招待', body: 'メール招待' },
    });
    expect(p.userPrompt).toContain('uc-1');
    expect(p.userPrompt).toContain('招待');
    expect(p.userPrompt).toContain('メール招待');
  });
});

describe('findRelatedCodeAgent.validateInput', () => {
  let workspaceRoot: string;
  let codebaseDir: string;
  let store: FileSystemProjectStore;

  beforeEach(async () => {
    workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'tally-frc-'));
    codebaseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tally-frc-code-'));
    store = new FileSystemProjectStore(workspaceRoot);
    await fs.mkdir(path.join(workspaceRoot, '.tally', 'nodes'), { recursive: true });
    await store.saveProjectMeta({
      id: 'proj-frc',
      name: 'FRC',
      codebasePath: codebaseDir,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  });

  afterEach(async () => {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
    await fs.rm(codebaseDir, { recursive: true, force: true });
  });

  it('usecase ノードで ok + cwd が返る', async () => {
    const uc = await store.addNode({ type: 'usecase', x: 0, y: 0, title: 'uc', body: 'b' });
    const r = await findRelatedCodeAgent.validateInput({ store, workspaceRoot }, { nodeId: uc.id });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.anchor?.id).toBe(uc.id);
      expect(r.cwd).toBe(path.resolve(workspaceRoot, codebaseDir));
    }
  });

  it('requirement / userstory も許可される', async () => {
    const req = await store.addNode({ type: 'requirement', x: 0, y: 0, title: 'r', body: '' });
    const story = await store.addNode({ type: 'userstory', x: 0, y: 0, title: 's', body: '' });
    const r1 = await findRelatedCodeAgent.validateInput(
      { store, workspaceRoot },
      { nodeId: req.id },
    );
    const r2 = await findRelatedCodeAgent.validateInput(
      { store, workspaceRoot },
      { nodeId: story.id },
    );
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
  });

  it('対象外 type (question) は bad_request', async () => {
    const q = await store.addNode({ type: 'question', x: 0, y: 0, title: 'q', body: '' });
    const r = await findRelatedCodeAgent.validateInput({ store, workspaceRoot }, { nodeId: q.id });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('bad_request');
  });

  it('不在 nodeId は not_found', async () => {
    const r = await findRelatedCodeAgent.validateInput(
      { store, workspaceRoot },
      { nodeId: 'uc-missing' },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('not_found');
  });

  it('codebasePath 未設定は bad_request', async () => {
    const current = await store.getProjectMeta();
    if (!current) throw new Error('meta missing');
    const { codebasePath: _drop, ...rest } = current;
    await store.saveProjectMeta(rest);
    const uc = await store.addNode({ type: 'usecase', x: 0, y: 0, title: 'uc', body: 'b' });
    const r = await findRelatedCodeAgent.validateInput({ store, workspaceRoot }, { nodeId: uc.id });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('bad_request');
  });

  it('codebasePath がファイル (非ディレクトリ) なら bad_request', async () => {
    const filePath = path.join(workspaceRoot, 'not-a-dir.txt');
    await fs.writeFile(filePath, 'x');
    await store.saveProjectMeta({
      id: 'proj-frc',
      name: 'FRC',
      codebasePath: filePath,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const uc = await store.addNode({ type: 'usecase', x: 0, y: 0, title: 'uc', body: 'b' });
    const r = await findRelatedCodeAgent.validateInput({ store, workspaceRoot }, { nodeId: uc.id });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('bad_request');
  });

  it('codebasePath 解決先が存在しない場合は not_found', async () => {
    await store.saveProjectMeta({
      id: 'proj-frc',
      name: 'FRC',
      codebasePath: '../nonexistent-xyz',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const uc = await store.addNode({ type: 'usecase', x: 0, y: 0, title: 'uc', body: 'b' });
    const r = await findRelatedCodeAgent.validateInput({ store, workspaceRoot }, { nodeId: uc.id });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('not_found');
  });
});

describe('findRelatedCodeAgent.allowedTools', () => {
  it('Read / Glob / Grep と tally ツールを含み、Bash/Edit/Write は含まない', () => {
    const tools = findRelatedCodeAgent.allowedTools;
    expect(tools).toContain('Read');
    expect(tools).toContain('Glob');
    expect(tools).toContain('Grep');
    expect(tools).toContain('mcp__tally__create_node');
    expect(tools).toContain('mcp__tally__create_edge');
    expect(tools).toContain('mcp__tally__find_related');
    expect(tools).toContain('mcp__tally__list_by_type');
    expect(tools).not.toContain('Bash');
    expect(tools).not.toContain('Edit');
    expect(tools).not.toContain('Write');
  });
});
