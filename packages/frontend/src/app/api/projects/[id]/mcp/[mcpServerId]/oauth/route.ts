// ADR-0011 PR-E3b: 外部 MCP サーバの OAuth 2.1 フローを Tally から開始するための
// Route Handler。OAuthFlowOrchestrator (PR-E3a) の薄いラッパー。
//
// メソッド対応:
// - POST   ... /oauth   → flow を start (authorizationUrl を返す)
// - GET    ... /oauth   → 現在の flow status (未開始なら 404)
// - DELETE ... /oauth   → 進行中 flow を中止 (= UI の「やり直し」)
//
// project は path param `id`、mcp server は `mcpServerId` で identify する。
// orchestrator の singleton state は Next の dev/prod の同一プロセスで共有される。
//
// 戻り値の failureMessage は orchestrator 側で固定文字列に正規化済み。

import { clearOAuthFlow, getOAuthFlowStatus, startOAuthFlow } from '@tally/ai-engine';
import { OAUTH_REGISTRY, type OAuthKind } from '@tally/core';
import { FileSystemProjectStore, listProjects } from '@tally/storage';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ id: string; mcpServerId: string }>;
}

interface ResolvedTarget {
  projectDir: string;
  clientId: string;
  scopes: readonly string[] | undefined;
  kind: OAuthKind;
}

// project + mcpServer を解決し、OAuth に必要な値を取り出す。
// project が無い / mcpServer が無い / oauth 未設定 / kind が registry に無い、の各ケースで
// 個別に 404/400 を返す (UI に「何が原因か」が分かるよう error code を変えてある)。
async function resolveTarget(
  projectId: string,
  mcpServerId: string,
): Promise<{ ok: true; target: ResolvedTarget } | { ok: false; status: number; error: string }> {
  const list = await listProjects();
  const projectDir = list.find((p) => p.id === projectId)?.path;
  if (!projectDir) {
    return { ok: false, status: 404, error: `project not found: ${projectId}` };
  }
  const store = new FileSystemProjectStore(projectDir);
  const meta = await store.getProjectMeta();
  if (!meta) {
    return { ok: false, status: 404, error: `project meta missing: ${projectId}` };
  }
  const server = meta.mcpServers.find((s) => s.id === mcpServerId);
  if (!server) {
    return {
      ok: false,
      status: 404,
      error: `mcp server not found: ${mcpServerId}`,
    };
  }
  // ADR-0011 PR-E4: oauth は schema 上 required なので server.oauth は必ず存在する。
  // YAML 不整合 (手動編集等) は getProjectMeta() の zod parse が落として meta=null になり、
  // この経路に到達する前に上の 404 で弾かれる。
  // kind は schema 上 'atlassian' literal だが registry lookup は将来の kind 追加に備えて
  // 共通の経路を残す。registry に無ければ 400。
  const kind = server.kind as OAuthKind;
  if (!(kind in OAUTH_REGISTRY)) {
    return {
      ok: false,
      status: 400,
      error: `unsupported oauth kind: ${kind}`,
    };
  }
  return {
    ok: true,
    target: {
      projectDir,
      clientId: server.oauth.clientId,
      scopes: server.oauth.scopes,
      kind,
    },
  };
}

export async function POST(_req: Request, ctx: RouteContext): Promise<NextResponse> {
  const { id, mcpServerId } = await ctx.params;
  const r = await resolveTarget(id, mcpServerId);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  try {
    const provider = OAUTH_REGISTRY[r.target.kind];
    const result = await startOAuthFlow({
      projectId: id,
      mcpServerId,
      provider,
      clientId: r.target.clientId,
      ...(r.target.scopes !== undefined ? { scopes: r.target.scopes } : {}),
      projectDir: r.target.projectDir,
    });
    return NextResponse.json({ authorizationUrl: result.authorizationUrl });
  } catch (err) {
    // already in progress や preempted 系は 409 Conflict、そのほかは 500 にする。
    // err.message を UI に直接出すと内部詳細が漏れるので、メッセージは server log に残し、
    // UI には固定文言を返す。
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[api/oauth] start failed (id=${id}, mcp=${mcpServerId}): ${message}`);
    if (/already in progress|preempted/.test(message)) {
      return NextResponse.json({ error: 'oauth flow already in progress' }, { status: 409 });
    }
    return NextResponse.json({ error: 'failed to start oauth flow' }, { status: 500 });
  }
}

export async function GET(_req: Request, ctx: RouteContext): Promise<NextResponse> {
  const { id, mcpServerId } = await ctx.params;
  // status は project lookup を行わない: 未開始の状態を返したいだけなので fast path。
  // composite key (projectId + mcpServerId) でクロスプロジェクト汚染を防ぐ。
  const status = getOAuthFlowStatus(id, mcpServerId);
  if (!status) return NextResponse.json({ error: 'oauth flow not started' }, { status: 404 });
  return NextResponse.json(status);
}

export async function DELETE(_req: Request, ctx: RouteContext): Promise<NextResponse> {
  const { id, mcpServerId } = await ctx.params;
  clearOAuthFlow(id, mcpServerId);
  return NextResponse.json({ ok: true });
}
