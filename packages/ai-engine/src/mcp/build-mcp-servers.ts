import type { McpServerConfig } from '@tally/core';

// SDK の mcpServers は Record<string, McpServerConfig> を受ける (sdk.d.ts:1386 参照)。
// chat-runner / agent-runner が共通で使える shape にする。
//
// 認証方針 (Premise 9 撤回後):
// MCP プロトコルの OAuth 2.1 を採用し、Tally は credentials を一切扱わない。
// - 401 を受けたら Claude Agent SDK が WWW-Authenticate から OAuth metadata を取り、
//   ブラウザ経由 (or device flow) で auth、token 管理は SDK 側で完結する。
// - ここでは Authorization header を組み立てない。url のみを SDK に渡す。
// - PAT 認証の MCP server (sooperset 等) を使う場合は、その server 自身が起動時 env で
//   credentials を持つ前提 (Tally は header passthrough しない)。
//
// allowedTools は wildcard `mcp__<id>__*` (Spike 0b 確認済、Claude Code 2.1.117+ サポート)。
export interface BuildMcpServersInput {
  // createSdkMcpServer で組み立てた Tally MCP。ここでは opaque。
  tallyMcp: unknown;
  // プロジェクト設定 project.mcpServers[]。
  configs: McpServerConfig[];
}

export interface BuildMcpServersResult {
  mcpServers: Record<string, unknown>;
  allowedTools: string[];
}

// SDK 設定と allowedTools を組み立てる。
// 認証は MCP 側 (SDK の OAuth 2.1 / MCP server 自身) に委譲しており、Tally は touch しない。
export function buildMcpServers(input: BuildMcpServersInput): BuildMcpServersResult {
  const { tallyMcp, configs } = input;

  const mcpServers: Record<string, unknown> = { tally: tallyMcp };
  const allowedTools: string[] = ['mcp__tally__*'];

  for (const cfg of configs) {
    mcpServers[cfg.id] = {
      type: 'http' as const,
      url: cfg.url,
    };
    allowedTools.push(`mcp__${cfg.id}__*`);
  }

  return { mcpServers, allowedTools };
}
