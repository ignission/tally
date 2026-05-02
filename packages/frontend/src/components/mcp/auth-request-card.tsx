'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { useCanvasStore } from '@/lib/store';

// ADR-0011 PR-E4: 外部 MCP の OAuth 2.1 認証要求カード。
// PR-E3b で paste UX を廃して Route Handler 駆動の 1 ステップ化、PR-E4 で chat 文脈を
// 完全に外して project settings の MCP server 行に再配置した。prop は
// `{ mcpServerId, mcpServerLabel }` だけを受け取り、ChatBlock 型には依存しない。
//
// 状態は orchestrator の Route Handler (POST/GET/DELETE /api/projects/<pid>/mcp/<mid>/oauth)
// から polling で取得する。マウント時に GET で rehydrate するので、別の場所で start した
// flow の続きを表示することもできる (codex Major 対応の rehydrate effect)。
//
// 状態遷移:
//   idle      ボタン未押下。
//   starting  POST 中 (短い)。
//   pending   authorize URL を別タブで開いた後、polling 中。
//   completed 成功。Atlassian tools が利用可能。
//   failed    失敗。orchestrator から返ってきた固定 failureMessage を表示。
//
// API errors は固定文言で UI に出す (orchestrator 側で詳細は server log に分離済み)。

const POLL_INTERVAL_MS = 2000;

interface ApiStatus {
  status: 'pending' | 'completed' | 'failed';
  authorizationUrl: string;
  failureMessage?: string;
}

type CardState =
  | { kind: 'idle' }
  | { kind: 'starting' }
  | { kind: 'pending'; authorizationUrl: string }
  | { kind: 'completed' }
  | { kind: 'failed'; message: string };

export interface AuthRequestCardProps {
  mcpServerId: string;
  mcpServerLabel: string;
}

export function AuthRequestCard({ mcpServerId, mcpServerLabel }: AuthRequestCardProps) {
  const projectId = useCanvasStore((s) => s.projectId);
  const [cardState, setCardState] = useState<CardState>({ kind: 'idle' });
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const baseUrl = projectId
    ? `/api/projects/${encodeURIComponent(projectId)}/mcp/${encodeURIComponent(mcpServerId)}/oauth`
    : null;

  // codex Major 対応: マウント時に orchestrator の現状を取りに行き、cardState を
  // rehydrate する。チャットスレッドの再表示や router 遷移でカードがリマウントされた際、
  // orchestrator が pending / completed の状態を持っているのに UI が idle に戻ってしまうと、
  // ユーザーが「認証」を再押下 → POST が 409 になり詰まる、という UX バグを防ぐ。
  // baseUrl が無い (projectId 未設定) ケースは何もしない。
  useEffect(() => {
    if (!baseUrl) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(baseUrl, { method: 'GET', cache: 'no-store' });
        if (cancelled) return;
        if (res.status === 404) {
          // orchestrator 未開始。idle のままで良い。
          return;
        }
        if (!res.ok) {
          // 取得失敗だが card はまだ操作可能 (idle のまま)。失敗にはしない。
          return;
        }
        const body = (await res.json()) as ApiStatus;
        if (cancelled) return;
        if (body.status === 'pending') {
          setCardState({ kind: 'pending', authorizationUrl: body.authorizationUrl });
        } else if (body.status === 'completed') {
          setCardState({ kind: 'completed' });
        } else if (body.status === 'failed') {
          setCardState({
            kind: 'failed',
            message: body.failureMessage ?? 'OAuth flow failed',
          });
        }
      } catch {
        // 初期 hydrate で失敗しても idle のまま (操作可能)。
      }
    })();
    return () => {
      cancelled = true;
    };
    // baseUrl 変化のみで再実行する。block.mcpServerId / projectId が変わったケースを拾う。
  }, [baseUrl]);

  // pending 中は POLL_INTERVAL_MS ごとに status を取りに行く。setInterval ではなく
  // setTimeout の self-rescheduling で「fetch 完了を待ってから次の timer を立てる」形にし、
  // 遅い fetch が重なるのを避ける。
  useEffect(() => {
    if (cardState.kind !== 'pending' || !baseUrl) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch(baseUrl, { method: 'GET', cache: 'no-store' });
        if (cancelled) return;
        if (res.status === 404) {
          // orchestrator から消えていた (DELETE 等)。idle に戻す。
          setCardState({ kind: 'idle' });
          return;
        }
        if (!res.ok) {
          // 予期しない 5xx。failure として表示するが retry は idle 経由で可能。
          setCardState({ kind: 'failed', message: 'OAuth status の取得に失敗しました' });
          return;
        }
        const body = (await res.json()) as ApiStatus;
        if (cancelled) return;
        if (body.status === 'completed') {
          setCardState({ kind: 'completed' });
          return;
        }
        if (body.status === 'failed') {
          setCardState({
            kind: 'failed',
            message: body.failureMessage ?? 'OAuth flow failed',
          });
          return;
        }
        // まだ pending。次回 tick を予約。
        pollTimerRef.current = setTimeout(tick, POLL_INTERVAL_MS);
      } catch {
        if (cancelled) return;
        // 一時的なネットワーク失敗は再試行ではなく failure 表示にする (UI を確定させる)。
        setCardState({ kind: 'failed', message: 'OAuth status の取得に失敗しました' });
      }
    };
    pollTimerRef.current = setTimeout(tick, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    };
  }, [cardState.kind, baseUrl]);

  const onAuthClick = useCallback(async () => {
    if (!baseUrl) return;
    setCardState({ kind: 'starting' });
    try {
      const res = await fetch(baseUrl, { method: 'POST' });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setCardState({
          kind: 'failed',
          message: body.error ?? `OAuth start に失敗しました (HTTP ${res.status})`,
        });
        return;
      }
      const body = (await res.json()) as { authorizationUrl: string };
      // 別タブで認可画面を開く。orchestrator の loopback が自動で callback を受け、
      // polling が completed を検知する。
      window.open(body.authorizationUrl, '_blank', 'noopener,noreferrer');
      setCardState({ kind: 'pending', authorizationUrl: body.authorizationUrl });
    } catch {
      setCardState({ kind: 'failed', message: 'OAuth start に失敗しました' });
    }
  }, [baseUrl]);

  const onRetryClick = useCallback(async () => {
    if (!baseUrl) return;
    // 既存 pending を一度 clear してから再 start (UI 上の「やり直す」)。
    await fetch(baseUrl, { method: 'DELETE' }).catch(() => undefined);
    setCardState({ kind: 'idle' });
  }, [baseUrl]);

  const showStartButton = cardState.kind === 'idle' || cardState.kind === 'starting';
  const showPendingHint = cardState.kind === 'pending';
  const isCompleted = cardState.kind === 'completed';
  const isFailed = cardState.kind === 'failed';

  return (
    <div style={CARD_STYLE}>
      <div style={HEADER_STYLE}>
        🔐 <span style={LABEL_STYLE}>{mcpServerLabel} 認証</span>
        <span style={badgeStyle(cardState)}>{statusLabel(cardState)}</span>
      </div>

      {showStartButton && (
        <>
          <div style={DESC_STYLE}>
            下のボタンで {mcpServerLabel} の認証ページを別タブで開いて承認してください。
            <br />
            承認が完了すると自動で連携が有効になります (paste 不要)。
          </div>
          <button
            type="button"
            onClick={onAuthClick}
            disabled={cardState.kind === 'starting' || !projectId}
            style={AUTH_BUTTON_STYLE}
          >
            {cardState.kind === 'starting' ? '開始中...' : `🔓 ${mcpServerLabel} で認証 (新規タブ)`}
          </button>
          {!projectId && <div style={WARN_STYLE}>プロジェクトが開かれていません。</div>}
        </>
      )}

      {showPendingHint && (
        <div style={DESC_STYLE}>
          別タブで承認を進めてください。完了すると自動で反映されます。
          <br />
          <a
            href={cardState.authorizationUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={LINK_STYLE}
          >
            認証画面を再度開く
          </a>
        </div>
      )}

      {isCompleted && (
        <div style={COMPLETED_DESC_STYLE}>
          ✅ 認証完了。{mcpServerLabel} のツールが利用可能になりました。
        </div>
      )}

      {isFailed && (
        <div style={FAILED_DESC_STYLE}>
          ❌ {cardState.message}
          <br />
          <button type="button" onClick={onRetryClick} style={RETRY_BUTTON_STYLE}>
            やり直す
          </button>
        </div>
      )}
    </div>
  );
}

function statusLabel(state: CardState): string {
  if (state.kind === 'completed') return '認証済';
  if (state.kind === 'failed') return '失敗';
  if (state.kind === 'pending') return '承認待ち';
  if (state.kind === 'starting') return '開始中';
  return '未認証';
}

function badgeStyle(state: CardState) {
  if (state.kind === 'completed') {
    return { ...BADGE_BASE_STYLE, background: '#23863633', color: '#7ee787' };
  }
  if (state.kind === 'failed') {
    return { ...BADGE_BASE_STYLE, background: '#f8514933', color: '#ffa198' };
  }
  return { ...BADGE_BASE_STYLE, background: '#bf8700aa', color: '#ffd33d' };
}

const CARD_STYLE = {
  background: '#1a1f2e',
  border: '1px solid #58a6ff',
  borderRadius: 6,
  padding: 10,
  display: 'flex',
  flexDirection: 'column' as const,
  gap: 8,
  width: '100%',
};
const HEADER_STYLE = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  fontSize: 13,
  color: '#e6edf3',
};
const LABEL_STYLE = { flex: 1, fontWeight: 600 };
const BADGE_BASE_STYLE = { fontSize: 10, padding: '1px 6px', borderRadius: 4 };
const DESC_STYLE = { fontSize: 11, color: '#c8d1da', lineHeight: 1.5 };
const WARN_STYLE = { fontSize: 11, color: '#ffa198' };
const COMPLETED_DESC_STYLE = { fontSize: 12, color: '#7ee787' };
const FAILED_DESC_STYLE = { fontSize: 11, color: '#ffa198', lineHeight: 1.5 };
const AUTH_BUTTON_STYLE = {
  background: '#1f6feb',
  color: '#fff',
  border: '1px solid #388bfd',
  borderRadius: 6,
  padding: '8px 12px',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
};
const RETRY_BUTTON_STYLE = {
  background: '#30363d',
  color: '#e6edf3',
  border: '1px solid #484f58',
  borderRadius: 4,
  padding: '4px 10px',
  fontSize: 11,
  cursor: 'pointer',
  marginTop: 4,
};
const LINK_STYLE = { color: '#58a6ff', textDecoration: 'underline' };
