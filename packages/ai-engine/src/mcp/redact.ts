// SDK に渡す mcpServers 設定 (Authorization header) をログに出す前の安全な形に変換する。
// プロセスメモリには PAT が残るが、ログ出力経路では "***" にする。
// 元オブジェクトは破壊せず、shallow copy で返す (mcpServers と該当 server / headers のみ複製)。
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
