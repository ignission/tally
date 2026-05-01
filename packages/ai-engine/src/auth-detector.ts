// 外部 MCP の OAuth 2.1 認証フローを検出するヘルパ。
// chat-runner が SDK から流れてくる tool_use / tool_result を walk しながら
// authenticate / complete_authentication をパターンで識別し、
// auth_request ブロックに変換する判断材料を提供する。

const AUTH_TOOL_NAME_RE = /^mcp__([a-z][a-z0-9-]{0,31})__(authenticate|complete_authentication)$/;

export interface AuthToolNameMatch {
  mcpServerId: string;
  kind: 'authenticate' | 'complete_authentication';
}

// `mcp__<id>__authenticate` / `mcp__<id>__complete_authentication` を分解する。
// id 部は McpServerIdRegex (core schema 側) と整合: 先頭英小文字 + 英小文字/数字/ハイフン、32 字以内。
export function parseAuthToolName(name: string): AuthToolNameMatch | null {
  const m = name.match(AUTH_TOOL_NAME_RE);
  if (!m) return null;
  return { mcpServerId: m[1] ?? '', kind: m[2] as 'authenticate' | 'complete_authentication' };
}

// authenticate tool_result.output に含まれる OAuth 認可エンドポイントの URL を抽出する。
// SDK の典型的な出力例:
//   "Ask the user to open this URL ... https://mcp.atlassian.com/v1/authorize?..."
// URL は折り返されている (`\<改行>` でエスケープされていることもある) ので
// 復元してから正規表現を当てる。
export function extractAuthUrl(output: string): string | null {
  // SDK が 80 桁折返しで `\<改行 + 連続空白>` を入れる場合がある。これを潰す。
  const unfolded = output.replace(/\\\n\s*/g, '');
  // 最初に見つかった https://...?...&... を採用。query string を含むものに限定して
  // 単なる説明用の URL (https://example.com 等) を引かないようにする。
  const urlRe = /https:\/\/[^\s)"'<>]+\?[^\s)"'<>]+/;
  const m = unfolded.match(urlRe);
  if (!m) return null;
  // 自然文末尾の句読点 / 閉じ括弧が URL に紛れるのを除く。
  // 例: "...state=xyz." / "...state=xyz)" → 末尾の `.` `)` を落とす。
  return m[0].replace(/[).,;:!?]+$/u, '');
}
