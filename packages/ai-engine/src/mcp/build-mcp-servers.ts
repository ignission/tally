import type { McpServerConfig } from '@tally/core';

// SDK の mcpServers は Record<string, McpServerConfig> を受ける (sdk.d.ts:1386 参照)。
// chat-runner / agent-runner が共通で使える shape にする。
//
// 認証方式:
// - bearer (Server/DC): Authorization: Bearer <token>
// - basic (Cloud): Authorization: Basic <base64(email:token)>
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

function requireEnv(varName: string, contextId: string): string {
  const v = process.env[varName];
  if (v === undefined || v === '') {
    throw new Error(`MCP 設定 "${contextId}" の env var "${varName}" が未設定または空です`);
  }
  return v;
}

function buildAuthHeader(auth: McpServerConfig['auth'], contextId: string): string {
  if (auth.scheme === 'bearer') {
    const token = requireEnv(auth.tokenEnvVar, contextId);
    return `Bearer ${token}`;
  }
  // basic
  const email = requireEnv(auth.emailEnvVar, contextId);
  const token = requireEnv(auth.tokenEnvVar, contextId);
  const b64 = Buffer.from(`${email}:${token}`).toString('base64');
  return `Basic ${b64}`;
}

// SDK 設定と allowedTools を組み立てる。env 未設定は throw。
// 呼び出し元 (chat-runner / agent-runner) は runUserTurn の都度これを呼ぶ
// → env 変更がホットリロードされる。
export function buildMcpServers(input: BuildMcpServersInput): BuildMcpServersResult {
  const { tallyMcp, configs } = input;

  const mcpServers: Record<string, unknown> = { tally: tallyMcp };
  const allowedTools: string[] = ['mcp__tally__*'];

  for (const cfg of configs) {
    const authHeader = buildAuthHeader(cfg.auth, cfg.id);
    mcpServers[cfg.id] = {
      type: 'http' as const,
      url: cfg.url,
      headers: { Authorization: authHeader },
    };
    allowedTools.push(`mcp__${cfg.id}__*`);
  }

  return { mcpServers, allowedTools };
}
