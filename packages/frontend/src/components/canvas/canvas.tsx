'use client';

import {
  Background,
  Controls,
  MiniMap,
  type NodeChange,
  type OnConnect,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  type Edge as RFEdge,
  type Node as RFNode,
  useReactFlow,
} from '@xyflow/react';
import { useMemo, useState } from 'react';

import '@xyflow/react/dist/style.css';

import { useCanvasStore } from '@/lib/store';

import { BulkAdoptDialog } from '../dialog/bulk-adopt-dialog';
import { MermaidExportDialog } from '../dialog/mermaid-export-dialog';
import { edgeTypes } from '../edges/typed-edge';
import { nodeTypes } from '../nodes';

// Phase 3: ドラッグで位置変更、ハンドルドラッグで接続、選択でストア同期。
export function Canvas() {
  const nodes = useCanvasStore((s) => s.nodes);
  const edges = useCanvasStore((s) => s.edges);
  const moveNode = useCanvasStore((s) => s.moveNode);
  const connectEdge = useCanvasStore((s) => s.connectEdge);
  const select = useCanvasStore((s) => s.select);
  const autoLayout = useCanvasStore((s) => s.autoLayout);

  const rfNodes = useMemo<RFNode[]>(
    () =>
      Object.values(nodes).map((node) => ({
        id: node.id,
        type: node.type,
        position: { x: node.x, y: node.y },
        data: { node },
        draggable: true,
        selectable: true,
      })),
    [nodes],
  );

  const rfEdges = useMemo<RFEdge[]>(
    () =>
      Object.values(edges).map((edge) => ({
        id: edge.id,
        source: edge.from,
        target: edge.to,
        type: 'typed',
        data: { edgeType: edge.type },
      })),
    [edges],
  );

  const onConnect: OnConnect = (conn) => {
    if (!conn.source || !conn.target) return;
    // デフォルト種別は `trace` (未定義の関連)。詳細シートで変更可能。
    connectEdge(conn.source, conn.target, 'trace').catch((err) => {
      console.error('edge connect failed', err);
    });
  };

  // drag 中の座標は React Flow 内部状態で保持し、drag 終了時に onNodeDragStop でストア反映する。
  const onNodesChange = (_changes: NodeChange[]) => {
    // no-op
  };

  return (
    <ReactFlowProvider>
      <div style={{ width: '100%', height: '100%', background: '#0d1117' }}>
        <CanvasInner
          rfNodes={rfNodes}
          rfEdges={rfEdges}
          onConnect={onConnect}
          onNodesChange={onNodesChange}
          moveNode={moveNode}
          select={select}
          autoLayout={autoLayout}
        />
      </div>
    </ReactFlowProvider>
  );
}

function CanvasInner(props: {
  rfNodes: RFNode[];
  rfEdges: RFEdge[];
  onConnect: OnConnect;
  onNodesChange: (changes: NodeChange[]) => void;
  moveNode: (id: string, x: number, y: number) => Promise<void>;
  select: (target: { kind: 'node'; id: string } | { kind: 'edge'; id: string } | null) => void;
  autoLayout: (direction?: 'TB' | 'LR') => Promise<void>;
}) {
  const { fitView } = useReactFlow();
  const [aligning, setAligning] = useState<null | 'TB' | 'LR'>(null);
  const [bulkAdoptOpen, setBulkAdoptOpen] = useState(false);
  const [mermaidOpen, setMermaidOpen] = useState(false);
  const proposalCount = useCanvasStore(
    (s) => Object.values(s.nodes).filter((n) => n.type === 'proposal' && !!n.adoptAs).length,
  );

  const handleAutoLayout = async (direction: 'TB' | 'LR') => {
    if (aligning) return;
    setAligning(direction);
    try {
      await props.autoLayout(direction);
      // レイアウト反映後、全体が収まるようにビューをリセット。
      requestAnimationFrame(() => {
        fitView({ padding: 0.2, duration: 300 });
      });
    } catch (err) {
      console.error('autoLayout failed', err);
    } finally {
      setAligning(null);
    }
  };

  return (
    <ReactFlow
      nodes={props.rfNodes}
      edges={props.rfEdges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      fitView
      nodesDraggable
      nodesConnectable
      elementsSelectable
      proOptions={{ hideAttribution: true }}
      onNodesChange={props.onNodesChange}
      onNodeDragStop={(_evt, node) => {
        props
          .moveNode(node.id, node.position.x, node.position.y)
          .catch((err) => console.error('moveNode failed', err));
      }}
      onConnect={props.onConnect}
      onNodeClick={(_evt, node) => props.select({ kind: 'node', id: node.id })}
      onEdgeClick={(_evt, edge) => props.select({ kind: 'edge', id: edge.id })}
      onPaneClick={() => props.select(null)}
    >
      <Background color="#30363d" gap={24} />
      <Controls
        style={{ background: '#161b22', border: '1px solid #30363d' }}
        showInteractive={false}
      />
      <MiniMap
        pannable
        zoomable
        nodeColor={(n) => {
          const node = (n.data as { node?: { type: string } }).node;
          return node ? (MINIMAP_COLORS[node.type] ?? '#8b949e') : '#8b949e';
        }}
        maskColor="rgba(13,17,23,0.7)"
        style={{ background: '#161b22', border: '1px solid #30363d' }}
      />
      <Panel position="top-right">
        <div
          style={{
            display: 'flex',
            gap: 4,
            background: '#161b22',
            border: '1px solid #30363d',
            borderRadius: 6,
            padding: 4,
          }}
        >
          {proposalCount > 0 && (
            <button
              type="button"
              onClick={() => setBulkAdoptOpen(true)}
              title="AI 提案をまとめて採用"
              style={{
                ...alignButtonStyle(false),
                color: '#a070c8',
                borderColor: '#a070c8',
              }}
            >
              ✦ 提案一括採用 ({proposalCount})
            </button>
          )}
          <button
            type="button"
            onClick={() => setMermaidOpen(true)}
            title="現在のグラフを Mermaid テキストで書き出す"
            style={alignButtonStyle(false)}
          >
            🗺 Mermaid
          </button>
          <button
            type="button"
            onClick={() => handleAutoLayout('LR')}
            disabled={aligning !== null}
            title="左から右に整列 (階層)"
            style={alignButtonStyle(aligning === 'LR')}
          >
            {aligning === 'LR' ? '整列中…' : '↦ 横整列'}
          </button>
          <button
            type="button"
            onClick={() => handleAutoLayout('TB')}
            disabled={aligning !== null}
            title="上から下に整列 (階層)"
            style={alignButtonStyle(aligning === 'TB')}
          >
            {aligning === 'TB' ? '整列中…' : '↧ 縦整列'}
          </button>
        </div>
      </Panel>
      <BulkAdoptDialog open={bulkAdoptOpen} onClose={() => setBulkAdoptOpen(false)} />
      <MermaidExportDialog open={mermaidOpen} onClose={() => setMermaidOpen(false)} />
    </ReactFlow>
  );
}

function alignButtonStyle(active: boolean): React.CSSProperties {
  return {
    background: active ? '#2d333b' : 'transparent',
    color: '#c9d1d9',
    border: '1px solid transparent',
    borderRadius: 4,
    padding: '4px 10px',
    fontSize: 12,
    cursor: 'pointer',
    lineHeight: 1.4,
  };
}

const MINIMAP_COLORS: Record<string, string> = {
  requirement: '#5b8def',
  usecase: '#4caf7a',
  userstory: '#3fb8c9',
  question: '#e07a4a',
  coderef: '#8b8b8b',
  issue: '#d9a441',
  proposal: '#a070c8',
};
