'use client';

import type { AgentEvent } from '@tally/ai-engine';

import { useCanvasStore } from '@/lib/store';

// 実行中の AI エージェントの進捗 (thinking / tool_use / node_created 等) を
// 時系列に並べる右下の固定パネル。runningAgent が null のときは描画しない。
export function AgentProgressPanel() {
  const running = useCanvasStore((s) => s.runningAgent);
  if (!running) return null;
  return (
    <aside style={PANEL_STYLE}>
      <div style={HEADER_STYLE}>{running.agent}</div>
      <ul style={LIST_STYLE}>
        {running.events.map((e, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: events は append-only で並び替えなし、安定キーに一意な id も無い。
          <li key={i} style={ROW_STYLE}>
            {formatEvent(e)}
          </li>
        ))}
      </ul>
    </aside>
  );
}

// AgentEvent を 1 行テキストに落とす。MVP は素通しで、巨大 input の省略は行わない。
function formatEvent(e: AgentEvent): string {
  switch (e.type) {
    case 'start':
      return `▶ start ${e.agent}`;
    case 'thinking':
      return e.text;
    case 'tool_use':
      return `🛠  ${e.name} ${JSON.stringify(e.input)}`;
    case 'tool_result':
      return `← ${e.id} ${e.ok ? 'ok' : 'NG'}`;
    case 'node_created':
      return `✓ node ${e.node.id}`;
    case 'edge_created':
      return `✓ edge ${e.edge.id}`;
    case 'done':
      return `✅ done: ${e.summary}`;
    case 'error':
      return `❌ ${e.code}: ${e.message}`;
  }
}

// DetailSheet (右側 340px) の左隣に出す overlay。fixed 配置のため親のレイアウトに影響しない。
const PANEL_STYLE = {
  position: 'fixed' as const,
  right: 340,
  bottom: 0,
  width: 360,
  maxHeight: '50vh',
  background: '#0d1117',
  color: '#e6edf3',
  border: '1px solid #30363d',
  overflowY: 'auto' as const,
  fontSize: 12,
};
const HEADER_STYLE = {
  padding: '6px 10px',
  fontSize: 11,
  color: '#8b949e',
  borderBottom: '1px solid #30363d',
};
const LIST_STYLE = { listStyle: 'none', margin: 0, padding: 0 };
const ROW_STYLE = { padding: '4px 10px', borderBottom: '1px solid #161b22' };
