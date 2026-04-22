import { promises as fs } from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { ProjectStore } from '@tally/storage';
import { describe, expect, it } from 'vitest';

import { buildIngestDocumentPrompt, ingestDocumentAgent } from './ingest-document';

const pasteInput = {
  source: 'paste',
  text: '招待機能を追加する。メンバーがメールで招待を送る。',
} as const;
const docsDirInput = { source: 'docs-dir', dirPath: 'docs' } as const;

describe('buildIngestDocumentPrompt (paste モード)', () => {
  it('役割と出力規約を含む system prompt を返す', () => {
    const { systemPrompt } = buildIngestDocumentPrompt({ input: pasteInput });
    expect(systemPrompt).toContain('要求書取り込みアシスタント');
    expect(systemPrompt).toContain('requirement');
    expect(systemPrompt).toContain('usecase');
    expect(systemPrompt).toContain('satisfy');
    expect(systemPrompt).toContain('adoptAs="requirement"');
    expect(systemPrompt).toContain('adoptAs="usecase"');
  });

  it('user prompt に元テキストが埋め込まれる', () => {
    const { userPrompt } = buildIngestDocumentPrompt({ input: pasteInput });
    expect(userPrompt).toContain('招待機能を追加する');
  });

  it('paste モードは Glob/Read への言及を含まない', () => {
    const { systemPrompt } = buildIngestDocumentPrompt({ input: pasteInput });
    expect(systemPrompt).not.toMatch(/Glob/);
    expect(systemPrompt).not.toMatch(/Read/);
  });
});

describe('buildIngestDocumentPrompt (docs-dir モード)', () => {
  it('Glob / Read 使用手順 + dirPath を含む system prompt', () => {
    const { systemPrompt } = buildIngestDocumentPrompt({ input: docsDirInput });
    expect(systemPrompt).toContain('Glob');
    expect(systemPrompt).toContain('Read');
    expect(systemPrompt).toContain('Markdown');
    expect(systemPrompt).toContain('satisfy');
  });

  it('user prompt に dirPath が入る', () => {
    const { userPrompt } = buildIngestDocumentPrompt({ input: docsDirInput });
    expect(userPrompt).toContain('docs');
  });
});

describe('ingestDocumentAgent', () => {
  it('allowedTools が MCP 4 個 + Read / Glob', () => {
    expect(ingestDocumentAgent.name).toBe('ingest-document');
    expect(ingestDocumentAgent.allowedTools).toEqual([
      'mcp__tally__create_node',
      'mcp__tally__create_edge',
      'mcp__tally__find_related',
      'mcp__tally__list_by_type',
      'Read',
      'Glob',
    ]);
  });

  it('inputSchema discriminated union: paste / docs-dir のみ受理', () => {
    expect(ingestDocumentAgent.inputSchema.safeParse(pasteInput).success).toBe(true);
    expect(ingestDocumentAgent.inputSchema.safeParse(docsDirInput).success).toBe(true);
    expect(ingestDocumentAgent.inputSchema.safeParse({ source: 'file', text: 'x' }).success).toBe(
      false,
    );
    expect(ingestDocumentAgent.inputSchema.safeParse({ source: 'paste', text: '' }).success).toBe(
      false,
    );
    expect(
      ingestDocumentAgent.inputSchema.safeParse({ source: 'docs-dir', dirPath: '' }).success,
    ).toBe(false);
    expect(
      ingestDocumentAgent.inputSchema.safeParse({ source: 'paste', text: 'x'.repeat(50_001) })
        .success,
    ).toBe(false);
  });

  it('validateInput paste: 無条件で ok / cwd は無し', async () => {
    const r = await ingestDocumentAgent.validateInput(
      { store: {} as never, projectDir: '/ws' },
      pasteInput,
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.anchor).toBeUndefined();
      expect(r.cwd).toBeUndefined();
    }
  });

  it('validateInput docs-dir: ディレクトリが存在し projectDir 配下なら ok + cwd', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'tally-docs-dir-'));
    await fs.mkdir(path.join(root, 'docs'), { recursive: true });
    const r = await ingestDocumentAgent.validateInput(
      { store: {} as never, projectDir: root },
      docsDirInput,
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.cwd).toBe(root);
    rmSync(root, { recursive: true, force: true });
  });

  it('validateInput docs-dir: 存在しないディレクトリは not_found', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'tally-docs-dir-'));
    const r = await ingestDocumentAgent.validateInput({ store: {} as never, projectDir: root }, {
      source: 'docs-dir',
      dirPath: 'missing',
    } as const);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('not_found');
    rmSync(root, { recursive: true, force: true });
  });

  it('validateInput docs-dir: projectDir 外 (..) は bad_request', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'tally-docs-dir-'));
    const r = await ingestDocumentAgent.validateInput({ store: {} as never, projectDir: root }, {
      source: 'docs-dir',
      dirPath: '../escape',
    } as const);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('bad_request');
    rmSync(root, { recursive: true, force: true });
  });

  it('validateInput docs-dir: ファイルを指定したら bad_request', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'tally-docs-dir-'));
    await fs.writeFile(path.join(root, 'f.md'), 'x');
    const r = await ingestDocumentAgent.validateInput({ store: {} as never, projectDir: root }, {
      source: 'docs-dir',
      dirPath: 'f.md',
    } as const);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('bad_request');
    rmSync(root, { recursive: true, force: true });
  });
});
