import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { atomicWriteFile, readYaml, writeYaml, YamlValidationError } from './yaml';

async function mkTmp(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'tally-yaml-test-'));
}

async function rmrf(p: string): Promise<void> {
  await fs.rm(p, { recursive: true, force: true });
}

describe('yaml I/O', () => {
  let workspace: string;

  beforeEach(async () => {
    workspace = await mkTmp();
  });

  afterEach(async () => {
    await rmrf(workspace);
  });

  describe('readYaml', () => {
    it('存在しないファイルは null を返す', async () => {
      const result = await readYaml(
        path.join(workspace, 'missing.yaml'),
        z.object({ id: z.string() }),
      );
      expect(result).toBeNull();
    });

    it('ISO8601 文字列は Date に変換せず string のまま読む', async () => {
      const filePath = path.join(workspace, 'ts.yaml');
      await fs.writeFile(filePath, 'ts: "2026-04-01T00:00:00Z"\n', 'utf8');
      const result = await readYaml(filePath, z.object({ ts: z.string() }));
      expect(result?.ts).toBe('2026-04-01T00:00:00Z');
    });

    it('Zod 検証失敗時は YamlValidationError を投げる', async () => {
      const filePath = path.join(workspace, 'bad.yaml');
      await fs.writeFile(filePath, 'id: 123\n', 'utf8');
      await expect(readYaml(filePath, z.object({ id: z.string() }))).rejects.toBeInstanceOf(
        YamlValidationError,
      );
    });
  });

  describe('writeYaml コメント保存', () => {
    it('既存ファイルの top-level key 前コメントを保存する', async () => {
      const filePath = path.join(workspace, 'meta.yaml');
      const original = `# ファイルの説明
id: proj-xyz
name: Test Project

# 下は作成日時
createdAt: "2026-04-01T00:00:00Z"
updatedAt: "2026-04-01T00:00:00Z"
`;
      await fs.writeFile(filePath, original, 'utf8');

      await writeYaml(filePath, {
        id: 'proj-xyz',
        name: 'Test Project (edited)',
        createdAt: '2026-04-01T00:00:00Z',
        updatedAt: '2026-04-02T00:00:00Z',
      });

      const result = await fs.readFile(filePath, 'utf8');
      expect(result).toContain('# ファイルの説明');
      expect(result).toContain('# 下は作成日時');
      expect(result).toContain('Test Project (edited)');
      expect(result).toContain('2026-04-02T00:00:00Z');
    });

    it('既存ファイルのキー順を維持する', async () => {
      const filePath = path.join(workspace, 'order.yaml');
      const original = `name: A
id: proj-1
createdAt: "2026-04-01T00:00:00Z"
`;
      await fs.writeFile(filePath, original, 'utf8');

      // JS オブジェクトは違う順で渡す
      await writeYaml(filePath, {
        id: 'proj-1',
        createdAt: '2026-04-01T00:00:00Z',
        name: 'A (new)',
      });

      const result = await fs.readFile(filePath, 'utf8');
      // 元の順 (name, id, createdAt) を維持
      const nameIdx = result.indexOf('name:');
      const idIdx = result.indexOf('id:');
      const createdIdx = result.indexOf('createdAt:');
      expect(nameIdx).toBeLessThan(idIdx);
      expect(idIdx).toBeLessThan(createdIdx);
      expect(result).toContain('A (new)');
    });

    it('data にない key は削除、data にあるが存在しない key は末尾追加', async () => {
      const filePath = path.join(workspace, 'diff.yaml');
      const original = `# header
id: proj-1
legacy: should-be-removed
name: old
`;
      await fs.writeFile(filePath, original, 'utf8');

      await writeYaml(filePath, {
        id: 'proj-1',
        name: 'new',
        description: 'added',
      });

      const result = await fs.readFile(filePath, 'utf8');
      expect(result).toContain('# header');
      expect(result).not.toContain('legacy:');
      expect(result).toContain('description: added');
    });

    it('新規ファイルは既存 Document 無しで単純書き込み', async () => {
      const filePath = path.join(workspace, 'new.yaml');
      await writeYaml(filePath, { id: 'x', value: 1 });
      const result = await fs.readFile(filePath, 'utf8');
      expect(result).toContain('id: x');
      expect(result).toContain('value: 1');
    });

    it('親ディレクトリが無ければ作る', async () => {
      const filePath = path.join(workspace, 'nested', 'deep', 'file.yaml');
      await writeYaml(filePath, { id: 'x' });
      const result = await fs.readFile(filePath, 'utf8');
      expect(result).toContain('id: x');
    });

    it('配列を含むデータでも書き込める (top-level が object でない場合は stringify)', async () => {
      const filePath = path.join(workspace, 'arr.yaml');
      await writeYaml(filePath, [1, 2, 3]);
      const result = await fs.readFile(filePath, 'utf8');
      expect(result).toContain('- 1');
      expect(result).toContain('- 2');
    });
  });

  describe('writeYaml flow→block 強制', () => {
    // regression: 空配列 (`messages: []`) を初回書き込みすると yaml lib は flow style で
    // 出力する。次回書き込み時、既存 seq が flow=true のまま map を追加すると
    // 「フロー集約の中にブロック scalar」が混在し再パースが破綻していた (chat YAML 破損)。
    it('id 配列に複数行 string を含む要素を追加しても再パース可能な YAML が出る', async () => {
      const filePath = path.join(workspace, 'messages.yaml');
      // Step 1: 空配列で初回書き込み (yaml lib が `messages: []` flow style で書き出す)
      await writeYaml(filePath, {
        id: 'thread-1',
        messages: [],
      });
      // Step 2: 複数行 string を含む要素を追加
      await writeYaml(filePath, {
        id: 'thread-1',
        messages: [
          {
            id: 'msg-1',
            text: 'line one\n\nline two\n\nline three',
          },
        ],
      });
      // 再パースできれば fix 成立
      const re = await readYaml(
        filePath,
        z.object({
          id: z.string(),
          messages: z.array(z.object({ id: z.string(), text: z.string() })),
        }),
      );
      expect(re?.messages).toHaveLength(1);
      expect(re?.messages[0]?.text).toBe('line one\n\nline two\n\nline three');
      // 出力は block style (`- id: msg-1`) になっているべき
      const raw = await fs.readFile(filePath, 'utf8');
      expect(raw).toContain('- id: msg-1');
      expect(raw).not.toMatch(/messages:\s*\[/);
    });
  });

  describe('writeYaml + readYaml 往復', () => {
    it('書いて読み直せば元のデータと一致する', async () => {
      const filePath = path.join(workspace, 'roundtrip.yaml');
      const data = {
        id: 'proj-1',
        name: 'テスト',
        createdAt: '2026-04-01T00:00:00Z',
      };
      await writeYaml(filePath, data);
      const result = await readYaml(
        filePath,
        z.object({
          id: z.string(),
          name: z.string(),
          createdAt: z.string(),
        }),
      );
      expect(result).toEqual(data);
    });
  });

  describe('atomicWriteFile', () => {
    it('temp → rename で書き込み、既存を上書きする', async () => {
      const target = path.join(workspace, 'a.txt');
      await fs.writeFile(target, 'old');
      await atomicWriteFile(target, 'new');
      expect(await fs.readFile(target, 'utf8')).toBe('new');
      // 同じディレクトリに .tmp が残っていない
      const entries = await fs.readdir(workspace);
      expect(entries.filter((e) => e.endsWith('.tmp'))).toHaveLength(0);
    });

    it('親ディレクトリが無ければエラー', async () => {
      const target = path.join(workspace, 'nope', 'a.txt');
      await expect(atomicWriteFile(target, 'x')).rejects.toThrow();
    });
  });
});
