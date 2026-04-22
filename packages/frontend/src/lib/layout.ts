import type { Edge, Node } from '@tally/core';
import dagre from 'dagre';

// dagre 用の既定ノードサイズ。NodeCard の width=260 に合わせ、高さは本文込みの平均値。
// 実寸とズレても衝突回避の余白として機能する。
const DEFAULT_NODE_WIDTH = 280;
const DEFAULT_NODE_HEIGHT = 180;

export type LayoutDirection = 'TB' | 'LR';

export interface LayoutedPosition {
  id: string;
  x: number;
  y: number;
}

// ノード群とエッジ群から dagre で階層レイアウトを算出し、新しい座標のみ返す。
// 呼び出し側は既存座標と比較して、変化したノードだけ moveNode で永続化する。
// 既定 LR: NodeCard のハンドルが Left/Right にあり、横方向に流す方が曲線が素直になる。
export function computeLayout(
  nodes: Node[],
  edges: Edge[],
  direction: LayoutDirection = 'LR',
): LayoutedPosition[] {
  if (nodes.length === 0) return [];

  const g = new dagre.graphlib.Graph();
  g.setGraph({
    rankdir: direction,
    // tight-tree は親子を近づけ、交差が減りやすい。network-simplex は均等化寄り。
    ranker: 'tight-tree',
    // edgesep を大きめに取ってエッジ間の間隔を確保し、直線の束になるのを防ぐ。
    nodesep: 80,
    edgesep: 30,
    ranksep: 120,
    marginx: 40,
    marginy: 40,
    acyclicer: 'greedy',
  });
  g.setDefaultEdgeLabel(() => ({}));

  for (const node of nodes) {
    g.setNode(node.id, { width: DEFAULT_NODE_WIDTH, height: DEFAULT_NODE_HEIGHT });
  }

  // 非存在ノード参照のエッジは握り潰す。YAML 破損時の fallback。
  const nodeIds = new Set(nodes.map((n) => n.id));
  for (const edge of edges) {
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) continue;
    g.setEdge(edge.from, edge.to);
  }

  dagre.layout(g);

  return nodes.map((node) => {
    const pos = g.node(node.id);
    // dagre は中心座標を返すので、左上座標へ変換。
    return {
      id: node.id,
      x: pos.x - DEFAULT_NODE_WIDTH / 2,
      y: pos.y - DEFAULT_NODE_HEIGHT / 2,
    };
  });
}
