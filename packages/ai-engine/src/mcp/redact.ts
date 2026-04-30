// SDK に渡す mcpServers 設定 (Authorization header) をログに出す前の安全な形に変換する。
// プロセスメモリには PAT が残るが、ログ出力経路では "***" にする。
// 元オブジェクトは破壊せず、shallow copy で返す (mcpServers と該当 server / headers のみ複製)。
//
// 注意:
// - Authorization header の検出は **canonical な "Authorization" のみ** (case-sensitive)。
//   Claude Agent SDK は McpHttpServerConfig.headers を canonical 表記で吐くため十分。
//   将来 SDK 仕様変更で "authorization" 等の表記が混在する場合は本関数を更新する。
// - 現状は Authorization のみ redact 対象。Cookie / X-API-Key / Proxy-Authorization 等は対応外。
//   MVP の MCP HTTP transport では Authorization 以外の credential header を使わないため。
export function redactMcpSecrets(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;

  const obj = value as Record<string, unknown>;
  if (!obj.mcpServers || typeof obj.mcpServers !== 'object' || Array.isArray(obj.mcpServers)) {
    return value;
  }

  const servers = obj.mcpServers as Record<string, unknown>;
  const redactedServers: Record<string, unknown> = {};

  for (const [name, cfg] of Object.entries(servers)) {
    if (cfg && typeof cfg === 'object' && !Array.isArray(cfg) && 'headers' in cfg) {
      const src = cfg as { headers?: unknown };
      const headers = src.headers;
      if (
        headers &&
        typeof headers === 'object' &&
        !Array.isArray(headers) &&
        'Authorization' in headers
      ) {
        redactedServers[name] = {
          ...(cfg as Record<string, unknown>),
          headers: {
            ...(headers as Record<string, unknown>),
            Authorization: '***',
          },
        };
        continue;
      }
    }
    redactedServers[name] = cfg;
  }

  return { ...obj, mcpServers: redactedServers };
}
