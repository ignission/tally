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

  it('codebaseId が渡されたらプロンプト両方に含まれ、additional の契約にも codebaseId が明記される', () => {
    const p = buildFindRelatedCodePrompt({
      anchor: { id: 'uc-2', type: 'usecase', x: 0, y: 0, title: 'test', body: '' },
      codebaseId: 'backend',
    });
    expect(p.userPrompt).toContain('backend');
    expect(p.systemPrompt).toContain('codebaseId');
  });
});

describe('findRelatedCodeAgent.validateInput', () => {
  let projectDir: string;
  let codebaseDir: string;
  let store: FileSystemProjectStore;

  beforeEach(async () => {
    projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tally-frc-'));
    codebaseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tally-frc-code-'));
    store = new FileSystemProjectStore(projectDir);
    await fs.mkdir(path.join(projectDir, '.tally', 'nodes'), { recursive: true });
    await store.saveProjectMeta({
      id: 'proj-frc',
      name: 'FRC',
      codebases: [{ id: 'main', label: 'Main', path: codebaseDir }],
      mcpServers: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  });

  afterEach(async () => {
    await fs.rm(projectDir, { recursive: true, force: true });
    await fs.rm(codebaseDir, { recursive: true, force: true });
  });

  it('usecase ノードで ok + cwd が返る', async () => {
    const uc = await store.addNode({ type: 'usecase', x: 0, y: 0, title: 'uc', body: 'b' });
    const r = await findRelatedCodeAgent.validateInput({ store, projectDir }, { nodeId: uc.id });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.anchor?.id).toBe(uc.id);
      expect(r.cwd).toBe(path.resolve(projectDir, codebaseDir));
    }
  });

  it('requirement / userstory も許可される', async () => {
    const req = await store.addNode({ type: 'requirement', x: 0, y: 0, title: 'r', body: '' });
    const story = await store.addNode({ type: 'userstory', x: 0, y: 0, title: 's', body: '' });
    const r1 = await findRelatedCodeAgent.validateInput({ store, projectDir }, { nodeId: req.id });
    const r2 = await findRelatedCodeAgent.validateInput(
      { store, projectDir },
      { nodeId: story.id },
    );
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
  });

  it('対象外 type (question) は bad_request', async () => {
    const q = await store.addNode({ type: 'question', x: 0, y: 0, title: 'q', body: '' });
    const r = await findRelatedCodeAgent.validateInput({ store, projectDir }, { nodeId: q.id });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('bad_request');
  });

  it('不在 nodeId は not_found', async () => {
    const r = await findRelatedCodeAgent.validateInput(
      { store, projectDir },
      { nodeId: 'uc-missing' },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('not_found');
  });

  it('codebasePath 未設定は bad_request', async () => {
    // codebases が空の場合は primary が存在しないので bad_request になる。
    await store.saveProjectMeta({
      id: 'proj-frc',
      name: 'FRC',
      codebases: [],
      mcpServers: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const uc = await store.addNode({ type: 'usecase', x: 0, y: 0, title: 'uc', body: 'b' });
    const r = await findRelatedCodeAgent.validateInput({ store, projectDir }, { nodeId: uc.id });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('bad_request');
  });

  it('codebasePath がファイル (非ディレクトリ) なら bad_request', async () => {
    const filePath = path.join(projectDir, 'not-a-dir.txt');
    await fs.writeFile(filePath, 'x');
    await store.saveProjectMeta({
      id: 'proj-frc',
      name: 'FRC',
      codebases: [{ id: 'main', label: 'Main', path: filePath }],
      mcpServers: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const uc = await store.addNode({ type: 'usecase', x: 0, y: 0, title: 'uc', body: 'b' });
    const r = await findRelatedCodeAgent.validateInput({ store, projectDir }, { nodeId: uc.id });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('bad_request');
  });

  it('codebasePath 解決先が存在しない場合は not_found', async () => {
    await store.saveProjectMeta({
      id: 'proj-frc',
      name: 'FRC',
      codebases: [{ id: 'main', label: 'Main', path: '../nonexistent-xyz' }],
      mcpServers: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const uc = await store.addNode({ type: 'usecase', x: 0, y: 0, title: 'uc', body: 'b' });
    const r = await findRelatedCodeAgent.validateInput({ store, projectDir }, { nodeId: uc.id });
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
