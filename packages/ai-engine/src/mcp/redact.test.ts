import { describe, expect, it } from 'vitest';

import { redactMcpSecrets } from './redact';

describe('redactMcpSecrets', () => {
  it('Authorization header を "***" に置換', () => {
    const input = {
      mcpServers: {
        atlassian: {
          type: 'http',
          url: 'https://x.test/mcp',
          headers: { Authorization: 'Bearer abc-123' },
        },
      },
    };
    const out = redactMcpSecrets(input) as {
      mcpServers: { atlassian: { headers: Record<string, string> } };
    };
    expect(out.mcpServers.atlassian.headers.Authorization).toBe('***');
    // 元オブジェクトは破壊しない (immutable)
    expect(input.mcpServers.atlassian.headers.Authorization).toBe('Bearer abc-123');
  });

  it('Basic auth (Basic xxx) も同じく redact', () => {
    const input = {
      mcpServers: {
        cloud: {
          type: 'http',
          url: 'https://x.test/mcp',
          headers: { Authorization: 'Basic dXNlcjpwYXNz' },
        },
      },
    };
    const out = redactMcpSecrets(input) as {
      mcpServers: { cloud: { headers: Record<string, string> } };
    };
    expect(out.mcpServers.cloud.headers.Authorization).toBe('***');
  });

  it('他の header は保持', () => {
    const out = redactMcpSecrets({
      mcpServers: {
        atlassian: {
          type: 'http',
          url: 'https://x.test/mcp',
          headers: { Authorization: 'Bearer secret', 'X-Other': 'keep' },
        },
      },
    }) as {
      mcpServers: { atlassian: { url: string; headers: Record<string, string> } };
    };
    expect(out.mcpServers.atlassian.url).toBe('https://x.test/mcp');
    expect(out.mcpServers.atlassian.headers['X-Other']).toBe('keep');
    expect(out.mcpServers.atlassian.headers.Authorization).toBe('***');
  });

  it('mcpServers 不在ならそのまま返す', () => {
    const input = { foo: 'bar' };
    expect(redactMcpSecrets(input)).toEqual(input);
  });

  it('mcpServers 内に headers が無いサーバ (SDK type 等) は触らない', () => {
    const sdkServer = { type: 'sdk', name: 'tally' };
    const input = {
      mcpServers: { tally: sdkServer },
    };
    const out = redactMcpSecrets(input) as { mcpServers: Record<string, unknown> };
    expect(out.mcpServers.tally).toEqual(sdkServer);
  });

  it('複数サーバが混在しても各々を独立に処理', () => {
    const input = {
      mcpServers: {
        tally: { type: 'sdk', name: 'tally' },
        atlassian: {
          type: 'http',
          url: 'https://x.test/mcp',
          headers: { Authorization: 'Bearer xyz' },
        },
      },
    };
    const out = redactMcpSecrets(input) as {
      mcpServers: {
        tally: { type: string };
        atlassian: { type: string; headers?: Record<string, string> };
      };
    };
    expect(out.mcpServers.tally.type).toBe('sdk');
    expect(out.mcpServers.atlassian.headers?.Authorization).toBe('***');
  });

  it('non-object input (primitive / null / array) はそのまま返す', () => {
    expect(redactMcpSecrets(null)).toBe(null);
    expect(redactMcpSecrets(undefined)).toBe(undefined);
    expect(redactMcpSecrets(42)).toBe(42);
    expect(redactMcpSecrets('string')).toBe('string');
    expect(redactMcpSecrets([1, 2, 3])).toEqual([1, 2, 3]);
  });
});
