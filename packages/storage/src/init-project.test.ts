import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initProject } from './init-project';
import { listProjects } from './registry';

let tallyHome: string;
let workspace: string;
const orig = { ...process.env };

beforeEach(async () => {
  tallyHome = await fs.mkdtemp(path.join(os.tmpdir(), 'tally-home-'));
  workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'tally-ws-'));
  process.env.TALLY_HOME = tallyHome;
});
afterEach(async () => {
  process.env = { ...orig };
  await fs.rm(tallyHome, { recursive: true, force: true });
  await fs.rm(workspace, { recursive: true, force: true });
});

describe('initProject', () => {
  it('空 projectDir に project.yaml / nodes / edges を作り registry に登録', async () => {
    const projectDir = path.join(workspace, 'new-proj');
    const result = await initProject({
      projectDir,
      name: 'new proj',
      codebases: [],
    });
    expect(result.id).toMatch(/^proj-/);
    expect(result.projectDir).toBe(projectDir);
    expect((await fs.stat(path.join(projectDir, 'project.yaml'))).isFile()).toBe(true);
    expect((await fs.stat(path.join(projectDir, 'nodes'))).isDirectory()).toBe(true);
    expect((await fs.stat(path.join(projectDir, 'edges', 'edges.yaml'))).isFile()).toBe(true);
    const reg = await listProjects();
    expect(reg.map((p) => p.id)).toContain(result.id);
  });

  it('codebases を受け取って保存', async () => {
    const projectDir = path.join(workspace, 'with-cb');
    const codebases = [{ id: 'web', label: 'Web', path: '/w' }];
    await initProject({ projectDir, name: 'x', codebases });
    const raw = await fs.readFile(path.join(projectDir, 'project.yaml'), 'utf8');
    expect(raw).toContain('web');
    expect(raw).toContain('/w');
  });

  it('codebases 0 件でも成功する', async () => {
    const projectDir = path.join(workspace, 'no-cb');
    await expect(initProject({ projectDir, name: 'x', codebases: [] })).resolves.toBeDefined();
  });

  it('既存の project.yaml を含む dir は拒否', async () => {
    const projectDir = path.join(workspace, 'existing');
    await fs.mkdir(projectDir);
    await fs.writeFile(path.join(projectDir, 'project.yaml'), 'id: old\n');
    await expect(
      initProject({ projectDir, name: 'x', codebases: [] }),
    ).rejects.toThrow(/既存の project\.yaml/);
  });

  it('非空の dir で project.yaml 無しは拒否', async () => {
    const projectDir = path.join(workspace, 'dirty');
    await fs.mkdir(projectDir);
    await fs.writeFile(path.join(projectDir, 'random.txt'), 'x');
    await expect(
      initProject({ projectDir, name: 'x', codebases: [] }),
    ).rejects.toThrow(/空ではありません/);
  });

  it('存在しないパスでも親ディレクトリが存在すれば成功', async () => {
    const projectDir = path.join(workspace, 'fresh');
    await initProject({ projectDir, name: 'x', codebases: [] });
    expect((await fs.stat(projectDir)).isDirectory()).toBe(true);
  });

  it('親ディレクトリが存在しないパスは拒否', async () => {
    const projectDir = path.join(workspace, 'missing-parent', 'sub');
    await expect(
      initProject({ projectDir, name: 'x', codebases: [] }),
    ).rejects.toThrow(/親ディレクトリ/);
  });

  it('name が空は拒否', async () => {
    await expect(
      initProject({ projectDir: path.join(workspace, 'p'), name: '  ', codebases: [] }),
    ).rejects.toThrow(/name/);
  });
});
