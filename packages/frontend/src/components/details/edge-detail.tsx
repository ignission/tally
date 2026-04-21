'use client';

import { useId } from 'react';

import type { Edge, EdgeType } from '@tally/core';
import { EDGE_META, EDGE_TYPES } from '@tally/core';

import { useCanvasStore } from '@/lib/store';

// エッジ詳細シート: from→to の経路表示、種別変更、削除操作。
// 種別変更は楽観更新済 (store)。サーバ応答で id が付け替わるが store が selected を追従するので
// この画面としては `edge.id` を渡し続けるだけでよい。
export function EdgeDetail({ edge }: { edge: Edge }) {
  const changeEdgeType = useCanvasStore((s) => s.changeEdgeType);
  const removeEdge = useCanvasStore((s) => s.removeEdge);
  const typeId = useId();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 16 }}>
      <div style={{ fontSize: 11, color: '#8b949e' }}>
        {edge.from} → {edge.to}
      </div>
      <label htmlFor={typeId} style={LABEL_STYLE}>
        種別
      </label>
      <select
        id={typeId}
        value={edge.type}
        onChange={(e) => changeEdgeType(edge.id, e.target.value as EdgeType).catch(console.error)}
        style={SELECT_STYLE}
      >
        {EDGE_TYPES.map((t) => (
          <option key={t} value={t}>
            {EDGE_META[t].label} ({t})
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={() => removeEdge(edge.id).catch(console.error)}
        style={DANGER_BUTTON_STYLE}
      >
        エッジを削除
      </button>
    </div>
  );
}

const LABEL_STYLE = { fontSize: 11, color: '#8b949e', letterSpacing: 0.5 } as const;

const SELECT_STYLE = {
  background: '#0d1117',
  border: '1px solid #30363d',
  color: '#e6edf3',
  borderRadius: 6,
  padding: '6px 8px',
  fontSize: 13,
} as const;

const DANGER_BUTTON_STYLE = {
  background: '#2f1720',
  color: '#f85149',
  border: '1px solid #5c1e28',
  borderRadius: 6,
  padding: '8px 12px',
  fontSize: 12,
  cursor: 'pointer',
  marginTop: 20,
} as const;
