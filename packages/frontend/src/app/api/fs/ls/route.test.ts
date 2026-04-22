import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GET } from './route';

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tally-fs-'));
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

function req(pathParam?: string): Request {
  const url = new URL('http://localhost/api/fs/ls');
  if (pathParam !== undefined) url.searchParams.set('path', pathParam);
  return new Request(url);
}

describe('GET /api/fs/ls', () => {
  it('ディレクトリのみを返し、ファイルは含めない', async () => {
    await fs.mkdir(path.join(dir, 'subA'));
    await fs.mkdir(path.join(dir, '.hidden'));
    await fs.writeFile(path.join(dir, 'file.txt'), 'x');
    const res = await GET(req(dir));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      entries: { name: string; isHidden: boolean; hasProjectYaml: boolean }[];
    };
    const names = body.entries.map((e) => e.name).sort();
    expect(names).toEqual(['.hidden', 'subA']);
    const hidden = body.entries.find((e) => e.name === '.hidden');
    expect(hidden?.isHidden).toBe(true);
  });

  it('子に project.yaml があれば hasProjectYaml: true', async () => {
    const sub = path.join(dir, 'proj');
    await fs.mkdir(sub);
    await fs.writeFile(path.join(sub, 'project.yaml'), 'id: x');
    const res = await GET(req(dir));
    const body = (await res.json()) as {
      entries: { name: string; hasProjectYaml: boolean }[];
    };
    expect(body.entries.find((e) => e.name === 'proj')?.hasProjectYaml).toBe(true);
  });

  it('dir 自身が project.yaml を含むなら containsProjectYaml: true', async () => {
    await fs.writeFile(path.join(dir, 'project.yaml'), 'id: x');
    const res = await GET(req(dir));
    const body = (await res.json()) as { containsProjectYaml: boolean };
    expect(body.containsProjectYaml).toBe(true);
  });

  it('parent は 1 階層上', async () => {
    const sub = path.join(dir, 'a', 'b');
    await fs.mkdir(sub, { recursive: true });
    const res = await GET(req(sub));
    const body = (await res.json()) as { parent: string };
    expect(body.parent).toBe(path.join(dir, 'a'));
  });

  it('parent がシステムルートなら null', async () => {
    const res = await GET(req('/'));
    const body = (await res.json()) as { parent: string | null };
    expect(body.parent).toBeNull();
  });

  it('path が相対パスは 400', async () => {
    const res = await GET(req('relative/path'));
    expect(res.status).toBe(400);
  });

  it('path が未指定なら HOME にフォールバック', async () => {
    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { path: string };
    expect(body.path).toBe(os.homedir());
  });

  it('path 不在は 404', async () => {
    const res = await GET(req(path.join(dir, 'does-not-exist')));
    expect(res.status).toBe(404);
  });

  it('.. を含む path は path.resolve で正規化して処理', async () => {
    const sub = path.join(dir, 'a');
    await fs.mkdir(sub);
    const weird = `${sub}/../a`;
    const res = await GET(req(weird));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { path: string };
    expect(body.path).toBe(path.resolve(weird));
  });

  it('シンボリックリンクのディレクトリが entries に含まれる', async () => {
    const target = path.join(dir, 'real-dir');
    const link = path.join(dir, 'link-dir');
    await fs.mkdir(target);
    await fs.symlink(target, link);
    const res = await GET(req(dir));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { entries: { name: string }[] };
    const names = body.entries.map((e) => e.name).sort();
    expect(names).toContain('link-dir');
    expect(names).toContain('real-dir');
  });

  it('project.yaml という名前のディレクトリは hasProjectYaml: false になる', async () => {
    const sub = path.join(dir, 'proj');
    await fs.mkdir(sub);
    // ファイルではなくディレクトリとして project.yaml を作る
    await fs.mkdir(path.join(sub, 'project.yaml'));
    const res = await GET(req(dir));
    const body = (await res.json()) as { entries: { name: string; hasProjectYaml: boolean }[] };
    expect(body.entries.find((e) => e.name === 'proj')?.hasProjectYaml).toBe(false);
  });

  it('現在ディレクトリに project.yaml という名前のディレクトリがあっても containsProjectYaml: false', async () => {
    await fs.mkdir(path.join(dir, 'project.yaml'));
    const res = await GET(req(dir));
    const body = (await res.json()) as { containsProjectYaml: boolean };
    expect(body.containsProjectYaml).toBe(false);
  });
});
