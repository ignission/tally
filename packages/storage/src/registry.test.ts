import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  loadRegistry,
  resolveRegistryPath,
  resolveTallyHome,
  saveRegistry,
} from './registry';

describe('resolveTallyHome', () => {
  const orig = { ...process.env };
  afterEach(() => {
    process.env = { ...orig };
  });

  it('TALLY_HOME が最優先', () => {
    process.env.TALLY_HOME = '/override';
    expect(resolveTallyHome()).toBe('/override');
  });

  it('TALLY_HOME 未設定 + XDG_DATA_HOME あり → <XDG_DATA_HOME>/tally', () => {
    delete process.env.TALLY_HOME;
    process.env.XDG_DATA_HOME = '/xdg';
    expect(resolveTallyHome()).toBe('/xdg/tally');
  });

  it('両方未設定 → ~/.local/share/tally', () => {
    delete process.env.TALLY_HOME;
    delete process.env.XDG_DATA_HOME;
    expect(resolveTallyHome()).toBe(path.join(os.homedir(), '.local', 'share', 'tally'));
  });
});

describe('registry load/save', () => {
  let dir: string;
  const orig = { ...process.env };

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tally-reg-'));
    process.env.TALLY_HOME = dir;
  });

  afterEach(async () => {
    process.env = { ...orig };
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('resolveRegistryPath は <TALLY_HOME>/registry.yaml', () => {
    expect(resolveRegistryPath()).toBe(path.join(dir, 'registry.yaml'));
  });

  it('ファイルが無ければ空 Registry を返す', async () => {
    const reg = await loadRegistry();
    expect(reg).toEqual({ version: 1, projects: [] });
  });

  it('save → load ラウンドトリップ', async () => {
    const reg = {
      version: 1 as const,
      projects: [
        { id: 'proj-a', path: '/x/y', lastOpenedAt: '2026-04-21T00:00:00Z' },
      ],
    };
    await saveRegistry(reg);
    expect(await loadRegistry()).toEqual(reg);
  });

  it('壊れた YAML は例外', async () => {
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'registry.yaml'), '::not yaml::', 'utf8');
    await expect(loadRegistry()).rejects.toThrow();
  });
});
