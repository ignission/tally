import {
  type McpOAuthToken,
  type McpServerConfig,
  OAUTH_REGISTRY,
  type OAuthKind,
} from '@tally/core';
import type { OAuthStore } from '@tally/storage';

import { refreshAccessToken } from '../oauth/oauth-client';

// SDK の mcpServers は Record<string, McpServerConfig> を受ける (sdk.d.ts:1386 参照)。
// chat-runner / agent-runner が共通で使える shape にする。
//
// ADR-0011 PR-E4: OAuth 2.1 token は Tally プロセスが管理する。各外部 MCP server に対し
// FileSystemOAuthStore.read(mcpServerId) で token を取得し、SDK の mcpServers config の
// `headers: { Authorization: 'Bearer <token>' }` として注入する。token が無い (未認証)
// 場合は header 無しで construct する → MCP server 側が 401 を返し、UI 側は AuthRequestCard
// (project settings) 経由で認証フローを走らせる想定。
//
// PR-E5: expiry が近い (REFRESH_BUFFER_MS 以内) または既に過去なら、refresh_token があれば
// transparent に refresh して store に書き戻す。refresh 失敗 (refresh_token 失効等) や
// refresh_token が無い場合は token null 扱いで header を付けない → MCP 側 401 → UI 再認証。
//
// allowedTools は wildcard `mcp__<id>__*` (Spike 0b 確認済、Claude Code 2.1.117+ サポート)。

// expiresAt - now が このバッファ以内なら refresh を試行する。5 分の余裕を見ておけば
// 通信遅延 + tool 呼び出し中の expiry を防げる。短すぎると毎ターン refresh する羽目になる。
const REFRESH_BUFFER_MS = 5 * 60 * 1000;

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

  for (const cfg of configs) {
    const usable = await loadUsableToken(cfg, oauthStore);
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

// 1 server 分の token を取得し、必要なら refresh する。
// 戻り値:
// - 有効な token (期限内 or refresh 成功) → 注入用に返す
// - null → header 無しで構築 (= MCP 側 401 → UI 再認証)
async function loadUsableToken(
  cfg: McpServerConfig,
  oauthStore: OAuthStore,
): Promise<McpOAuthToken | null> {
  const token = await oauthStore.read(cfg.id);
  if (!token) return null;

  const now = Date.now();
  const expiresAtMs = token.expiresAt !== undefined ? Date.parse(token.expiresAt) : undefined;
  const expiresSoon = expiresAtMs !== undefined && expiresAtMs - now <= REFRESH_BUFFER_MS;
  const expired = expiresAtMs !== undefined && expiresAtMs <= now;

  // expiresAt 不明 (provider が expires_in を返さなかった) は注入してみる: MCP 側 401 で
  // 検知することになるが、不明なら盲目的に短期間 refresh するより素朴な方が予測しやすい。
  if (!expiresSoon) return token;

  // refresh_token が無いなら refresh 不能。token が完全に過去なら null 返し (header 無し)、
  // まだ有効期限内 (expiresSoon だが expired ではない) ならそのまま注入して 1 回使う。
  if (!token.refreshToken) {
    return expired ? null : token;
  }

  // kind が registry に無い provider は refresh 経路を持たないので fallback する。
  const kind = cfg.kind as OAuthKind;
  const provider = OAUTH_REGISTRY[kind];
  if (!provider) {
    return expired ? null : token;
  }

  try {
    const refreshed = await refreshAccessToken({
      provider,
      clientId: cfg.oauth.clientId,
      refreshToken: token.refreshToken,
    });
    // CR Major 対応 (codex): expires_in は token endpoint レスポンス受領時を起点に計算する。
    // refresh の HTTP ラウンドトリップ後に Date.now() を取り直さないと、最初の `now` から
    // 数秒早く期限切れに見える (バッファに収まる範囲だが、厳密性のため再取得)。
    const issuedAt = Date.now();
    const acquiredAt = new Date(issuedAt).toISOString();
    const newExpiresAt =
      refreshed.expiresIn !== undefined
        ? new Date(issuedAt + refreshed.expiresIn * 1000).toISOString()
        : undefined;
    const scopesParsed = refreshed.scope?.split(/\s+/).filter(Boolean);
    // 一部 provider は refresh 時に新 refresh_token を返さない (rotate 無し)。その場合は
    // 旧 refresh_token をそのまま保持する (RFC 6749 §6 互換)。
    const newRefresh = refreshed.refreshToken ?? token.refreshToken;
    const updated: McpOAuthToken = {
      mcpServerId: cfg.id,
      accessToken: refreshed.accessToken,
      refreshToken: newRefresh,
      acquiredAt,
      ...(newExpiresAt !== undefined ? { expiresAt: newExpiresAt } : {}),
      ...(scopesParsed && scopesParsed.length > 0
        ? { scopes: scopesParsed }
        : token.scopes
          ? { scopes: token.scopes }
          : {}),
      tokenType: refreshed.tokenType,
    };
    // CR Major 対応 (codex): 同一プロジェクトで chat-runner と agent-runner が
    // 並走したときに refresh が二重発火する race がある。MVP は単一ユーザー前提
    // なので last-write-wins で許容しているが、将来 multi-tenant 化するときは
    // refresh 中の他 caller を直列化する mutex が必要 (FileSystemOAuthStore 自体は
    // tmp→rename でアトミック書き込み)。
    await oauthStore.write(updated);
    return updated;
  } catch (err) {
    // refresh 失敗 (refresh_token 失効 / revoked / network 失敗 等)。詳細は server log。
    // 過去 token は捨てる方針: 注入すると MCP 401 → AI tool 失敗で UX が悪い。null 返しで
    // header 無し → MCP 401 (直接) → UI 側 AuthRequestCard で再認証を促す。
    console.warn(
      `[build-mcp-servers] token refresh failed for ${cfg.id}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return expired ? null : token;
  }
}
