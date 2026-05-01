'use client';

import type { ChatBlock } from '@tally/core';
import { useState } from 'react';

import { useCanvasStore } from '@/lib/store';

type AuthRequestBlock = Extract<ChatBlock, { type: 'auth_request' }>;

// callback URL が「http://localhost:XXXXX/callback?code=...&state=...」形式かを軽く検査。
// SDK が立てた一時 callback 鯖は agent turn 終了で死ぬので、ユーザーがアドレスバーから
// コピーして貼ることを想定。host は loopback (localhost / 127.0.0.1 / ::1) のみ通す。
// schema.ts (McpServerConfigSchema.url) と loopback 判定を揃えており、IPv6 優先環境で
// SDK が `http://[::1]:XXXXX/callback?...` を返した場合にも認証フローが進むようにする。
function isLikelyCallbackUrl(s: string): boolean {
  try {
    const u = new URL(s.trim());
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    // URL 内資格情報 (user:pass@host) は誤って貼り付けると chat 履歴に永続化される
    // (sendChatMessage 経由で残る) ため、ここで弾く。schema.ts の url validator と整合。
    if (u.username || u.password) return false;
    const host = u.hostname;
    if (host !== 'localhost' && host !== '127.0.0.1' && host !== '::1' && host !== '[::1]') {
      return false;
    }
    return u.searchParams.has('code') && u.searchParams.has('state');
  } catch {
    return false;
  }
}

// 外部 MCP の OAuth 2.1 認証要求ブロック。
// 「Atlassian で認証」ボタン (新規タブ) と callback URL paste 入力欄を 1 等地でまとめる。
// 設計意図: SDK が tool 出力した auth URL をプレーンテキスト中に紛れさせると、
// ・URL がクリックできない / 同タブ遷移で session を壊す
// ・redirect 先 localhost:XXXXX が即死しているのにユーザーが原因を特定できない
// という UX が破綻するため、専用カードで「やるべきこと」を 2 ステップに分けて提示する。
export function AuthRequestCard({ block }: { block: AuthRequestBlock }) {
  const sendOAuthCallback = useCanvasStore((s) => s.sendOAuthCallback);
  const [callbackUrl, setCallbackUrl] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const isPending = block.status === 'pending';
  const isCompleted = block.status === 'completed';
  const isFailed = block.status === 'failed';

  const onAuthClick = () => {
    if (!isPending) return;
    window.open(block.authUrl, '_blank', 'noopener,noreferrer');
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = callbackUrl.trim();
    if (!trimmed || !isLikelyCallbackUrl(trimmed)) return;
    setSubmitting(true);
    try {
      // 構造化 WS message で送信。自然文 user_message と異なり、サーバ側で
      // mcpServerId が確定するので AI が別 server の complete_authentication を
      // 呼ぶ事故を排除できる (PR-B CR Major)。
      sendOAuthCallback(block.mcpServerId, trimmed);
      setCallbackUrl('');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={CARD_STYLE}>
      <div style={HEADER_STYLE}>
        🔐 <span style={LABEL_STYLE}>{block.mcpServerLabel} 認証</span>
        <span style={badgeStyle(block.status)}>{statusLabel(block.status)}</span>
      </div>

      {isPending && (
        <>
          <div style={DESC_STYLE}>
            下のボタンで {block.mcpServerLabel} の認証ページを別タブで開いて承認してください。
            <br />
            <strong>承認後にブラウザが「接続できません」を表示しても問題ありません。</strong>
            <br />
            アドレスバーの URL (例: <code>http://localhost:XXXXX/callback?code=...</code>) を
            コピーして、下の入力欄に貼り付け「認証完了」を押してください。
          </div>
          <button type="button" onClick={onAuthClick} style={AUTH_BUTTON_STYLE}>
            🔓 {block.mcpServerLabel} で認証 (新規タブ)
          </button>
          <form onSubmit={onSubmit} style={FORM_STYLE}>
            <input
              type="text"
              value={callbackUrl}
              onChange={(e) => setCallbackUrl(e.target.value)}
              placeholder="http://localhost:XXXXX/callback?code=...&state=..."
              style={INPUT_STYLE}
              disabled={submitting}
              aria-label="callback URL"
            />
            <button
              type="submit"
              disabled={submitting || !isLikelyCallbackUrl(callbackUrl)}
              style={SUBMIT_BUTTON_STYLE}
            >
              {submitting ? '送信中...' : '認証完了'}
            </button>
          </form>
        </>
      )}

      {isCompleted && (
        <div style={COMPLETED_DESC_STYLE}>
          ✅ 認証完了。{block.mcpServerLabel} のツールが利用可能になりました。
        </div>
      )}

      {isFailed && (
        <div style={FAILED_DESC_STYLE}>
          ❌ 認証に失敗しました。
          {block.failureMessage ? (
            <pre style={FAILURE_PRE_STYLE}>{block.failureMessage}</pre>
          ) : null}
          <br />
          再度 AI に認証を要求してください (例: 「もう一度認証して」)。
        </div>
      )}
    </div>
  );
}

function statusLabel(status: AuthRequestBlock['status']): string {
  if (status === 'pending') return '未認証';
  if (status === 'completed') return '認証済';
  return '失敗';
}

function badgeStyle(status: AuthRequestBlock['status']) {
  if (status === 'completed') {
    return { ...BADGE_BASE_STYLE, background: '#23863633', color: '#7ee787' };
  }
  if (status === 'failed') {
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
const COMPLETED_DESC_STYLE = { fontSize: 12, color: '#7ee787' };
const FAILED_DESC_STYLE = { fontSize: 11, color: '#ffa198', lineHeight: 1.5 };
const FAILURE_PRE_STYLE = {
  background: '#0d1117',
  border: '1px solid #30363d',
  borderRadius: 4,
  padding: 6,
  fontSize: 10,
  fontFamily: 'ui-monospace, SFMono-Regular, monospace',
  color: '#ffa198',
  marginTop: 4,
  whiteSpace: 'pre-wrap' as const,
};
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
const FORM_STYLE = { display: 'flex', gap: 6 };
const INPUT_STYLE = {
  flex: 1,
  background: '#0d1117',
  border: '1px solid #30363d',
  borderRadius: 4,
  padding: '6px 8px',
  fontSize: 11,
  fontFamily: 'ui-monospace, SFMono-Regular, monospace',
  color: '#e6edf3',
};
const SUBMIT_BUTTON_STYLE = {
  background: '#238636',
  color: '#fff',
  border: '1px solid #2ea043',
  borderRadius: 6,
  padding: '4px 10px',
  fontSize: 11,
  cursor: 'pointer',
};
