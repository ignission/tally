import { afterEach, describe, expect, it } from 'vitest';

import { buildMcpServers } from './build-mcp-servers';

describe('buildMcpServers', () => {
  const ORIGINAL_ENV = { ...process.env };
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('mcpServers 空配列 → external 無し、allowedTools は tally のみ', () => {
    const result = buildMcpServers({ tallyMcp: { type: 'sdk' } as unknown, configs: [] });
    expect(Object.keys(result.mcpServers)).toEqual(['tally']);
    expect(result.allowedTools).toEqual(['mcp__tally__*']);
  });

  it('Bearer (Server/DC) → Authorization: Bearer <token>', () => {
    process.env.JIRA_PAT = 'secret-xyz';
    const result = buildMcpServers({
      tallyMcp: { type: 'sdk' } as unknown,
      configs: [
        {
          id: 'atlassian-dc',
          name: 'A',
          kind: 'atlassian',
          url: 'https://jira.test/mcp',
          auth: { type: 'pat', scheme: 'bearer', tokenEnvVar: 'JIRA_PAT' },
          options: { maxChildIssues: 30, maxCommentsPerIssue: 5 },
        },
      ],
    });
    const atlassian = result.mcpServers['atlassian-dc'] as {
      type: string;
      url: string;
      headers: Record<string, string>;
    };
    expect(atlassian.type).toBe('http');
    expect(atlassian.url).toBe('https://jira.test/mcp');
    expect(atlassian.headers.Authorization).toBe('Bearer secret-xyz');
    expect(result.allowedTools).toContain('mcp__tally__*');
    expect(result.allowedTools).toContain('mcp__atlassian-dc__*');
  });

  it('Basic (Cloud) → Authorization: Basic <base64(email:token)>', () => {
    process.env.ATLASSIAN_EMAIL = 'user@example.com';
    process.env.ATLASSIAN_API_TOKEN = 'api-token-xyz';
    const result = buildMcpServers({
      tallyMcp: { type: 'sdk' } as unknown,
      configs: [
        {
          id: 'atlassian-cloud',
          name: 'A',
          kind: 'atlassian',
          url: 'https://x.test/mcp',
          auth: {
            type: 'pat',
            scheme: 'basic',
            emailEnvVar: 'ATLASSIAN_EMAIL',
            tokenEnvVar: 'ATLASSIAN_API_TOKEN',
          },
          options: { maxChildIssues: 30, maxCommentsPerIssue: 5 },
        },
      ],
    });
    const atlassian = result.mcpServers['atlassian-cloud'] as {
      headers: Record<string, string>;
    };
    const expected = Buffer.from('user@example.com:api-token-xyz').toString('base64');
    expect(atlassian.headers.Authorization).toBe(`Basic ${expected}`);
  });

  it('Bearer の tokenEnvVar 未設定 → throw', () => {
    delete process.env.JIRA_PAT;
    expect(() =>
      buildMcpServers({
        tallyMcp: { type: 'sdk' } as unknown,
        configs: [
          {
            id: 'a',
            name: 'A',
            kind: 'atlassian',
            url: 'https://x.test/mcp',
            auth: { type: 'pat', scheme: 'bearer', tokenEnvVar: 'JIRA_PAT' },
            options: { maxChildIssues: 30, maxCommentsPerIssue: 5 },
          },
        ],
      }),
    ).toThrowError(/JIRA_PAT/);
  });

  it('Basic の emailEnvVar 未設定 → throw', () => {
    delete process.env.ATLASSIAN_EMAIL;
    process.env.ATLASSIAN_API_TOKEN = 'x';
    expect(() =>
      buildMcpServers({
        tallyMcp: { type: 'sdk' } as unknown,
        configs: [
          {
            id: 'a',
            name: 'A',
            kind: 'atlassian',
            url: 'https://x.test/mcp',
            auth: {
              type: 'pat',
              scheme: 'basic',
              emailEnvVar: 'ATLASSIAN_EMAIL',
              tokenEnvVar: 'ATLASSIAN_API_TOKEN',
            },
            options: { maxChildIssues: 30, maxCommentsPerIssue: 5 },
          },
        ],
      }),
    ).toThrowError(/ATLASSIAN_EMAIL/);
  });

  it('Basic の tokenEnvVar 未設定 → throw', () => {
    process.env.ATLASSIAN_EMAIL = 'user@example.com';
    delete process.env.ATLASSIAN_API_TOKEN;
    expect(() =>
      buildMcpServers({
        tallyMcp: { type: 'sdk' } as unknown,
        configs: [
          {
            id: 'a',
            name: 'A',
            kind: 'atlassian',
            url: 'https://x.test/mcp',
            auth: {
              type: 'pat',
              scheme: 'basic',
              emailEnvVar: 'ATLASSIAN_EMAIL',
              tokenEnvVar: 'ATLASSIAN_API_TOKEN',
            },
            options: { maxChildIssues: 30, maxCommentsPerIssue: 5 },
          },
        ],
      }),
    ).toThrowError(/ATLASSIAN_API_TOKEN/);
  });

  it('env 値が空文字でも → throw (= 未設定と同じ扱い)', () => {
    process.env.JIRA_PAT = '';
    expect(() =>
      buildMcpServers({
        tallyMcp: { type: 'sdk' } as unknown,
        configs: [
          {
            id: 'a',
            name: 'A',
            kind: 'atlassian',
            url: 'https://x.test/mcp',
            auth: { type: 'pat', scheme: 'bearer', tokenEnvVar: 'JIRA_PAT' },
            options: { maxChildIssues: 30, maxCommentsPerIssue: 5 },
          },
        ],
      }),
    ).toThrowError(/JIRA_PAT/);
  });

  it('複数の config を合成 → 各々が独立に build される', () => {
    process.env.JIRA_PAT = 's1';
    process.env.OTHER_TOKEN = 's2';
    const result = buildMcpServers({
      tallyMcp: { type: 'sdk' } as unknown,
      configs: [
        {
          id: 'first',
          name: 'F',
          kind: 'atlassian',
          url: 'https://a.test/mcp',
          auth: { type: 'pat', scheme: 'bearer', tokenEnvVar: 'JIRA_PAT' },
          options: { maxChildIssues: 30, maxCommentsPerIssue: 5 },
        },
        {
          id: 'second',
          name: 'S',
          kind: 'atlassian',
          url: 'https://b.test/mcp',
          auth: { type: 'pat', scheme: 'bearer', tokenEnvVar: 'OTHER_TOKEN' },
          options: { maxChildIssues: 30, maxCommentsPerIssue: 5 },
        },
      ],
    });
    expect(Object.keys(result.mcpServers)).toEqual(['tally', 'first', 'second']);
    const first = result.mcpServers.first as { headers: Record<string, string> };
    const second = result.mcpServers.second as { headers: Record<string, string> };
    expect(first.headers.Authorization).toBe('Bearer s1');
    expect(second.headers.Authorization).toBe('Bearer s2');
    expect(result.allowedTools).toEqual(['mcp__tally__*', 'mcp__first__*', 'mcp__second__*']);
  });
});
