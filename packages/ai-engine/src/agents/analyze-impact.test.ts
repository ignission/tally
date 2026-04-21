import type { Node } from '@tally/core';
import { describe, expect, it } from 'vitest';

import { analyzeImpactAgent, buildAnalyzeImpactPrompt } from './analyze-impact';

const anchor: Node = {
  id: 'uc-1',
  type: 'usecase',
  x: 0,
  y: 0,
  title: '招待メール送信',
  body: 'ユーザーが仲間を招待する UC',
};

describe('buildAnalyzeImpactPrompt', () => {
  it('issue が主役であることを明示する', () => {
    const { systemPrompt } = buildAnalyzeImpactPrompt({ anchor });
    expect(systemPrompt).toContain('主役');
    expect(systemPrompt).toContain('issue proposal');
  });

  it('coderef 重複禁止の指示を含む', () => {
    const { systemPrompt } = buildAnalyzeImpactPrompt({ anchor });
    expect(systemPrompt).toContain('find_related');
    expect(systemPrompt).toContain('再作成しない');
  });

  it('出力規約として coderef / issue 両方を記述', () => {
    const { systemPrompt } = buildAnalyzeImpactPrompt({ anchor });
    expect(systemPrompt).toContain('adoptAs="coderef"');
    expect(systemPrompt).toContain('adoptAs="issue"');
    expect(systemPrompt).toContain('summary');
    expect(systemPrompt).toContain('impact');
  });

  it('Edit / Write / Bash を禁止する', () => {
    const { systemPrompt } = buildAnalyzeImpactPrompt({ anchor });
    expect(systemPrompt).toContain('Edit / Write / Bash は使わない');
  });

  it('個数目安 0〜5 件と 0 件許容を明示', () => {
    const { systemPrompt } = buildAnalyzeImpactPrompt({ anchor });
    expect(systemPrompt).toContain('0〜5 件');
    expect(systemPrompt).toContain('0 件でも可');
  });

  it('user プロンプトに anchor の id / type / title / body を含む', () => {
    const { userPrompt } = buildAnalyzeImpactPrompt({ anchor });
    expect(userPrompt).toContain('uc-1');
    expect(userPrompt).toContain('usecase');
    expect(userPrompt).toContain('招待メール送信');
    expect(userPrompt).toContain('ユーザーが仲間を招待する UC');
  });
});

describe('analyzeImpactAgent definition', () => {
  it('name = analyze-impact', () => {
    expect(analyzeImpactAgent.name).toBe('analyze-impact');
  });

  it('inputSchema が nodeId 必須', () => {
    const r = analyzeImpactAgent.inputSchema.safeParse({});
    expect(r.success).toBe(false);
  });

  it('allowedTools が find-related-code と同一 (Read/Glob/Grep + 4 tally MCP)', () => {
    expect(analyzeImpactAgent.allowedTools).toEqual(
      expect.arrayContaining([
        'mcp__tally__create_node',
        'mcp__tally__create_edge',
        'mcp__tally__find_related',
        'mcp__tally__list_by_type',
        'Read',
        'Glob',
        'Grep',
      ]),
    );
    expect(analyzeImpactAgent.allowedTools).toHaveLength(7);
  });
});
