import type { McpServerConfig } from '@tally/core';
import type { OAuthStore } from '@tally/storage';

// SDK の mcpServers は Record<string, McpServerConfig> を受ける (sdk.d.ts:1386 参照)。
// chat-runner / agent-runner が共通で使える shape にする。
//
// ADR-0011 PR-E4: OAuth 2.1 token は Tally プロセスが管理する。各外部 MCP server に対し
// FileSystemOAuthStore.read(mcpServerId) で token を取得し、SDK の mcpServers config の
// `headers: { Authorization: 'Bearer <token>' }` として注入する。token が無い (未認証)
// 場合は header 無しで construct する → MCP server 側が 401 を返し、UI 側は AuthRequestCard
// (project settings) 経由で認証フローを走らせる想定。
//
// allowedTools は wildcard `mcp__<id>__*` (Spike 0b 確認済、Claude Code 2.1.117+ サポート)。
export interface BuildMcpServersInput {
  // createSdkMcpServer で組み立てた Tally MCP。ここでは opaque。
  tallyMcp: unknown;
  // プロジェクト設定 project.mcpServers[]。
  configs: McpServerConfig[];
  // 各 mcpServerId に対し read(id) で token を引いて header に注入する。
  oauthStore: OAuthStore;
}

export interface BuildMcpServersResult {
  mcpServers: Record<string, unknown>;
  allowedTools: string[];
}

// SDK 設定と allowedTools を組み立てる。
export async function buildMcpServers(input: BuildMcpServersInput): Promise<BuildMcpServersResult> {
  const { tallyMcp, configs, oauthStore } = input;

  const mcpServers: Record<string, unknown> = { tally: tallyMcp };
  const allowedTools: string[] = ['mcp__tally__*'];

  const now = Date.now();
  for (const cfg of configs) {
    const token = await oauthStore.read(cfg.id);
    // codex Major 対応: expiresAt が過去なら token は null 扱い。期限切れを注入すると
    // MCP サーバーが 401 を返し、AI ループの tool_result に紛れて UI には認証問題が
    // 通知されないため。期限切れ検知時は header 無しで構築 → MCP 側 401 → UI 側は
    // project settings の AuthRequestCard で再認証を促す (PR-E5 で refresh 自動化予定)。
    const expired = token?.expiresAt !== undefined && Date.parse(token.expiresAt) <= now;
    const usable = token && !expired ? token : null;
    const headers: Record<string, string> = {};
    if (usable) headers.Authorization = `${usable.tokenType} ${usable.accessToken}`;
    mcpServers[cfg.id] = {
      type: 'http' as const,
      url: cfg.url,
      ...(Object.keys(headers).length > 0 ? { headers } : {}),
    };
    allowedTools.push(`mcp__${cfg.id}__*`);
  }

  return { mcpServers, allowedTools };
}
