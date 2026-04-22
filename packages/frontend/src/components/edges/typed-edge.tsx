import type { EdgeType } from '@tally/core';
import { EDGE_META } from '@tally/core';
import {
  BaseEdge,
  EdgeLabelRenderer,
  type EdgeProps,
  type EdgeTypes,
  getSmoothStepPath,
} from '@xyflow/react';

import { useCanvasStore } from '@/lib/store';

type TypedEdgeData = {
  edgeType: EdgeType;
};

// エッジ種別ごとの SVG dash・色を EDGE_META から引く。
// 選択中ノードに接続しないエッジは低透明度にして、注目エッジを浮き立たせる。
export function TypedEdge(props: EdgeProps & { data?: TypedEdgeData }) {
  const {
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    data,
    id,
    source,
    target,
    selected,
  } = props;
  const edgeType: EdgeType = data?.edgeType ?? 'trace';
  const meta = EDGE_META[edgeType];

  const selectedTarget = useCanvasStore((s) => s.selected);
  // ノード選択時、そのノードに接続しないエッジは淡色化する。
  // 自エッジ選択時は強調。未選択時は通常表示。
  const nodeFocus = selectedTarget?.kind === 'node' ? selectedTarget.id : null;
  const isIncident = nodeFocus !== null && (source === nodeFocus || target === nodeFocus);
  const dimmed = nodeFocus !== null && !isIncident;

  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    borderRadius: 8,
  });

  const strokeWidth = selected || isIncident ? 2.5 : 1.5;
  const opacity = dimmed ? 0.18 : 1;

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        style={{
          stroke: meta.color,
          strokeWidth,
          strokeDasharray: meta.dash,
          opacity,
        }}
      />
      <EdgeLabelRenderer>
        <div
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            background: '#0d1117',
            color: meta.color,
            border: `1px solid ${meta.color}`,
            borderRadius: 999,
            padding: '1px 6px',
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: 0.5,
            pointerEvents: 'none',
            opacity,
          }}
        >
          {meta.label}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

export const edgeTypes: EdgeTypes = {
  typed: TypedEdge,
};
