import { describe, expect, it } from 'vitest';

import { extractAuthUrl, parseAuthToolName } from './auth-detector';

describe('parseAuthToolName', () => {
  it('mcp__atlassian__authenticate を分解', () => {
    expect(parseAuthToolName('mcp__atlassian__authenticate')).toEqual({
      mcpServerId: 'atlassian',
      kind: 'authenticate',
    });
  });

  it('mcp__atlassian__complete_authentication を分解', () => {
    expect(parseAuthToolName('mcp__atlassian__complete_authentication')).toEqual({
      mcpServerId: 'atlassian',
      kind: 'complete_authentication',
    });
  });

  it('別 id でも動く (jira-cloud 等のハイフン許容)', () => {
    expect(parseAuthToolName('mcp__jira-cloud__authenticate')).toEqual({
      mcpServerId: 'jira-cloud',
      kind: 'authenticate',
    });
  });

  it('Tally 内部 MCP は match しない', () => {
    expect(parseAuthToolName('mcp__tally__create_node')).toBeNull();
  });

  it('別ツール名 (read_issue など) は match しない', () => {
    expect(parseAuthToolName('mcp__atlassian__read_issue')).toBeNull();
  });

  it('id が大文字を含むと reject', () => {
    expect(parseAuthToolName('mcp__Atlassian__authenticate')).toBeNull();
  });
});

describe('extractAuthUrl', () => {
  it('SDK 標準 output 形式から URL を抽出', () => {
    const out = `Ask the user to open this URL in their browser to authorize the atlassian MCP server:

https://mcp.atlassian.com/v1/authorize?response_type=code&client_id=abc&state=xyz

Once they complete the flow, the server's tools will become available automatically.`;
    expect(extractAuthUrl(out)).toBe(
      'https://mcp.atlassian.com/v1/authorize?response_type=code&client_id=abc&state=xyz',
    );
  });

  it('折り返し (`\\\\\\n` + 空白) も復元してから抽出', () => {
    const out =
      'Ask the user: https://mcp.atlassian.com/v1/authorize?response_type=code&cli\\\n  ent_id=abc&state=xyz_done';
    expect(extractAuthUrl(out)).toBe(
      'https://mcp.atlassian.com/v1/authorize?response_type=code&client_id=abc&state=xyz_done',
    );
  });

  it('クエリ文字列なしの URL は無視 (説明用 https://example.com 等)', () => {
    expect(extractAuthUrl('See https://example.com for more info')).toBeNull();
  });

  it('URL が無ければ null', () => {
    expect(extractAuthUrl('no url here')).toBeNull();
  });
});
