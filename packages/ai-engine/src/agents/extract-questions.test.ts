import type { ProjectStore } from '@tally/storage';
import { describe, expect, it, vi } from 'vitest';

import { buildExtractQuestionsPrompt, extractQuestionsAgent } from './extract-questions';

describe('buildExtractQuestionsPrompt', () => {
  const anchor = {
    id: 'uc-1',
    type: 'usecase' as const,
    x: 0,
    y: 0,
    title: '招待を送る',
    body: 'メンバーがチームに招待メールを送信する',
  };

  it('役割と出力規約を含む system prompt を返す', () => {
    const { systemPrompt } = buildExtractQuestionsPrompt({ anchor });
    expect(systemPrompt).toContain('論点抽出アシスタント');
    expect(systemPrompt).toContain('未決定');
    expect(systemPrompt).toContain('options');
    expect(systemPrompt).toContain('2〜4');
    expect(systemPrompt).toContain('adoptAs="question"');
    expect(systemPrompt).toContain('type="derive"');
  });

  it('対象ノードの id / type / title / body を user prompt に埋め込む', () => {
    const { userPrompt } = buildExtractQuestionsPrompt({ anchor });
    expect(userPrompt).toContain('uc-1');
    expect(userPrompt).toContain('usecase');
    expect(userPrompt).toContain('招待を送る');
    expect(userPrompt).toContain('メンバーがチームに招待');
  });

  it('コード探索系の用語を含まない (Glob/Grep/Read を使わないエージェント)', () => {
    const { systemPrompt } = buildExtractQuestionsPrompt({ anchor });
    expect(systemPrompt).not.toMatch(/Glob/);
    expect(systemPrompt).not.toMatch(/Grep/);
  });
});

describe('extractQuestionsAgent', () => {
  it('名前とツール許可リストが仕様通り', () => {
    expect(extractQuestionsAgent.name).toBe('extract-questions');
    expect(extractQuestionsAgent.allowedTools).toEqual([
      'mcp__tally__create_node',
      'mcp__tally__create_edge',
      'mcp__tally__find_related',
      'mcp__tally__list_by_type',
    ]);
    // built-in (Glob / Grep / Read / Bash / Edit / Write) は含まない
    for (const t of extractQuestionsAgent.allowedTools) {
      expect(t.startsWith('mcp__')).toBe(true);
    }
  });

  it('inputSchema は nodeId: string を要求する', () => {
    expect(extractQuestionsAgent.inputSchema.safeParse({ nodeId: 'uc-1' }).success).toBe(true);
    expect(extractQuestionsAgent.inputSchema.safeParse({ nodeId: '' }).success).toBe(false);
    expect(extractQuestionsAgent.inputSchema.safeParse({}).success).toBe(false);
  });

  it('validateInput は requireCodebasePath=false で codebasePath 無しでも通す', async () => {
    const node = { id: 'uc-1', type: 'usecase', x: 0, y: 0, title: '', body: '' };
    const store = {
      getNode: vi.fn().mockResolvedValue(node),
      getProjectMeta: vi
        .fn()
        .mockResolvedValue({ id: 'p', name: 'x', createdAt: '', updatedAt: '' }),
    } as unknown as ProjectStore;
    const r = await extractQuestionsAgent.validateInput(
      { store, projectDir: '/ws' },
      { nodeId: 'uc-1' },
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.anchor).toEqual(node);
      expect(r.cwd).toBeUndefined();
    }
  });

  it('issue / coderef anchor は弾く (3 型以外)', async () => {
    const node = { id: 'i-1', type: 'issue', x: 0, y: 0, title: '', body: '' };
    const store = {
      getNode: vi.fn().mockResolvedValue(node),
      getProjectMeta: vi.fn().mockResolvedValue(null),
    } as unknown as ProjectStore;
    const r = await extractQuestionsAgent.validateInput(
      { store, projectDir: '/ws' },
      { nodeId: 'i-1' },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('bad_request');
  });
});
