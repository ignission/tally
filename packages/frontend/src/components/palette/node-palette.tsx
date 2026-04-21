'use client';

import { NODE_META, NODE_TYPES } from '@tally/core';
import type { NodeType } from '@tally/core';

import { useCanvasStore } from '@/lib/store';

// 新規ノードの配置位置は既存ノード群の右横に並べる簡易ロジックとする。
// ビューポート中央に置くには useReactFlow が必要だが、
// Phase 3 の目的は編集操作の成立であり、見た目最適化は Phase 8 以降でよい。
function computeNextPosition(nodes: Record<string, { x: number; y: number }>): {
  x: number;
  y: number;
} {
  const values = Object.values(nodes);
  if (values.length === 0) return { x: 120, y: 120 };
  const maxX = Math.max(...values.map((n) => n.x));
  const avgY = values.reduce((sum, n) => sum + n.y, 0) / values.length;
  return { x: maxX + 320, y: avgY };
}

export function NodePalette() {
  const addNodeFromPalette = useCanvasStore((s) => s.addNodeFromPalette);
  const nodes = useCanvasStore((s) => s.nodes);

  const add = async (type: NodeType) => {
    const { x, y } = computeNextPosition(nodes);
    try {
      await addNodeFromPalette(type, x, y);
    } catch (err) {
      console.error('addNodeFromPalette failed', err);
    }
  };

  return (
    <aside style={PALETTE_STYLE}>
      <div style={{ fontSize: 11, color: '#8b949e', letterSpacing: 1, marginBottom: 12 }}>NEW</div>
      {NODE_TYPES.map((t) => {
        const meta = NODE_META[t];
        return (
          <button
            key={t}
            type="button"
            onClick={() => add(t)}
            style={{
              ...BUTTON_STYLE,
              borderColor: meta.color,
              color: meta.color,
            }}
          >
            <span style={{ marginRight: 6 }}>{meta.icon}</span>
            {meta.label}
          </button>
        );
      })}
    </aside>
  );
}

const PALETTE_STYLE = {
  width: 140,
  height: '100%',
  padding: 12,
  borderRight: '1px solid #30363d',
  background: '#0d1117',
  display: 'flex',
  flexDirection: 'column' as const,
  gap: 8,
};

const BUTTON_STYLE = {
  background: '#161b22',
  border: '1px solid',
  borderRadius: 8,
  padding: '8px 10px',
  fontSize: 12,
  textAlign: 'left' as const,
  cursor: 'pointer',
};
