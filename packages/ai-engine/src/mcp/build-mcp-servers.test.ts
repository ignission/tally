import { describe, expect, it } from 'vitest';

import { buildMcpServers } from './build-mcp-servers';

describe('buildMcpServers', () => {
  it('mcpServers 空配列 → external 無し、allowedTools は tally のみ', () => {
    const result = buildMcpServers({ tallyMcp: { type: 'sdk' } as unknown, configs: [] });
    expect(Object.keys(result.mcpServers)).toEqual(['tally']);
    expect(result.allowedTools).toEqual(['mcp__tally__*']);
  });

  it('atlassian 1 個 → HTTP config (url のみ、Authorization header なし) + allowedTools', () => {
    const result = buildMcpServers({
      tallyMcp: { type: 'sdk' } as unknown,
      configs: [
        {
          id: 'atlassian',
          name: 'Atlassian',
          kind: 'atlassian',
          url: 'https://mcp.atlassian.example/v1/mcp',
          options: { maxChildIssues: 30, maxCommentsPerIssue: 5 },
        },
      ],
    });
    const atlassian = result.mcpServers.atlassian as {
      type: string;
      url: string;
      headers?: unknown;
    };
    expect(atlassian.type).toBe('http');
    expect(atlassian.url).toBe('https://mcp.atlassian.example/v1/mcp');
    // OAuth 2.1 採用: Tally は Authorization header を組み立てない
    expect(atlassian.headers).toBeUndefined();
    expect(result.allowedTools).toContain('mcp__tally__*');
    expect(result.allowedTools).toContain('mcp__atlassian__*');
  });

  it('複数の config を合成 → 各々が独立に build される', () => {
    const result = buildMcpServers({
      tallyMcp: { type: 'sdk' } as unknown,
      configs: [
        {
          id: 'first',
          name: 'F',
          kind: 'atlassian',
          url: 'https://a.test/mcp',
          options: { maxChildIssues: 30, maxCommentsPerIssue: 5 },
        },
        {
          id: 'second',
          name: 'S',
          kind: 'atlassian',
          url: 'https://b.test/mcp',
          options: { maxChildIssues: 30, maxCommentsPerIssue: 5 },
        },
      ],
    });
    expect(Object.keys(result.mcpServers)).toEqual(['tally', 'first', 'second']);
    const first = result.mcpServers.first as { url: string; headers?: unknown };
    const second = result.mcpServers.second as { url: string; headers?: unknown };
    expect(first.url).toBe('https://a.test/mcp');
    expect(second.url).toBe('https://b.test/mcp');
    expect(first.headers).toBeUndefined();
    expect(second.headers).toBeUndefined();
    expect(result.allowedTools).toEqual(['mcp__tally__*', 'mcp__first__*', 'mcp__second__*']);
  });
});
