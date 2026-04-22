import type { NodeMeta } from '@tally/core';
import { Handle, Position } from '@xyflow/react';
import type { CSSProperties, ReactNode } from 'react';

export interface NodeCardProps {
  meta: NodeMeta;
  title: string;
  body: string;
  /** 破線枠にする (論点の未決定・AI 提案)。 */
  dashed?: boolean;
  /** 枠強度をやや落として「確定済みだが履歴」的に表示する。現状は論点の決定済みで使用。 */
  faded?: boolean;
  /** ヘッダーと枠線の色を meta とは別の型色で上書きする。
   *  proposal ノードが adoptAs ヒントの型色を使うために導入。 */
  accentOverride?: { color: string; accent: string; label: string; icon: string };
  badge?: ReactNode;
  footer?: ReactNode;
}

const BASE_STYLE: CSSProperties = {
  width: 260,
  padding: '12px 14px',
  borderRadius: 10,
  background: '#161b22',
  color: '#e6edf3',
  fontFamily: "system-ui, -apple-system, 'Segoe UI', 'Hiragino Sans', 'Yu Gothic UI', sans-serif",
  fontSize: 13,
  lineHeight: 1.45,
  boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
  whiteSpace: 'pre-wrap',
};

// React Flow のカスタムノード用共通レイアウト。型固有のバッジやフッターだけ差分で渡す。
export function NodeCard({
  meta,
  title,
  body,
  dashed,
  faded,
  accentOverride,
  badge,
  footer,
}: NodeCardProps) {
  const borderWidth = dashed ? 2 : 2;
  const borderStyle = dashed ? 'dashed' : 'solid';
  // accentOverride があれば型色を上書き (proposal 側で adoptAs ヒントの色を渡す)。
  const effectiveColor = accentOverride?.color ?? meta.color;
  const effectiveAccent = accentOverride?.accent ?? meta.accent;
  const borderColor = faded ? effectiveAccent : effectiveColor;
  const opacity = faded ? 0.75 : 1;

  const headerLabel = accentOverride?.label ?? meta.label;
  const headerIcon = accentOverride?.icon ?? meta.icon;

  return (
    <div
      style={{
        ...BASE_STYLE,
        border: `${borderWidth}px ${borderStyle} ${borderColor}`,
        opacity,
      }}
    >
      <Handle type="target" position={Position.Left} style={{ background: effectiveColor }} />
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          marginBottom: 6,
          fontSize: 11,
          color: effectiveAccent,
          fontWeight: 600,
          letterSpacing: 0.5,
        }}
      >
        <span aria-hidden="true">{headerIcon}</span>
        <span>{headerLabel}</span>
        {badge}
      </div>
      <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>{title}</div>
      {body && <div style={{ color: '#c8d1da' }}>{body}</div>}
      {footer && <div style={{ marginTop: 8 }}>{footer}</div>}
      <Handle type="source" position={Position.Right} style={{ background: effectiveColor }} />
    </div>
  );
}

export function NodeBadge({
  children,
  tone = 'default',
  bgColor,
}: {
  children: ReactNode;
  tone?: 'default' | 'info' | 'success';
  /** tone を上書きする任意色 (型ヒント提案などの semantic color 用)。 */
  bgColor?: string;
}) {
  const palette: Record<'default' | 'info' | 'success', string> = {
    default: '#30363d',
    info: '#1f6feb',
    success: '#238636',
  };
  return (
    <span
      style={{
        marginLeft: 'auto',
        fontSize: 10,
        padding: '2px 6px',
        borderRadius: 999,
        background: bgColor ?? palette[tone],
        color: '#fff',
        fontWeight: 600,
        letterSpacing: 0.5,
      }}
    >
      {children}
    </span>
  );
}
