'use client';

import type { Node } from '@tally/core';
import { useState } from 'react';

import { useCanvasStore } from '@/lib/store';

import { ChatTab } from '../chat/chat-tab';
import { ConfirmDialog } from '../dialog/confirm-dialog';
import { CodeRefDetail } from './coderef-detail';
import { CommonFields } from './common-fields';
import { EdgeDetail } from './edge-detail';
import { ProposalDetail } from './proposal-detail';
import { QuestionDetail } from './question-detail';
import { RequirementDetail } from './requirement-detail';
import { UseCaseDetail } from './usecase-detail';
import { UserStoryDetail } from './userstory-detail';

type Tab = 'detail' | 'chat';

// 右サイドバー。Detail タブは選択ノード/エッジの詳細、Chat タブは対話パネル。
// タブ状態はローカル useState。プロジェクト遷移時は親コンポーネントの unmount で reset される想定。
export function DetailSheet() {
  const [tab, setTab] = useState<Tab>('detail');

  return (
    <aside style={SHEET_STYLE}>
      <div style={TABS_STYLE} role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'detail'}
          onClick={() => setTab('detail')}
          style={tabButtonStyle(tab === 'detail')}
        >
          Detail
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'chat'}
          onClick={() => setTab('chat')}
          style={tabButtonStyle(tab === 'chat')}
        >
          Chat
        </button>
      </div>
      <div style={TAB_CONTENT_STYLE}>{tab === 'detail' ? <DetailContent /> : <ChatTab />}</div>
    </aside>
  );
}

function DetailContent() {
  const selected = useCanvasStore((s) => s.selected);
  const nodes = useCanvasStore((s) => s.nodes);
  const edges = useCanvasStore((s) => s.edges);

  if (!selected) return <Empty />;
  if (selected.kind === 'node') {
    const node = nodes[selected.id];
    if (!node) return <Empty />;
    return <NodeDetailPanel key={node.id} node={node} />;
  }
  const edge = edges[selected.id];
  return (
    <>
      <Header label="エッジ" />
      {edge ? <EdgeDetail key={edge.id} edge={edge} /> : <Empty />}
    </>
  );
}

// ノード詳細を削除ボタン + 確認ダイアログと合わせて担当する。
// 呼び出し側で key={node.id} を指定して再マウントし、
// ノード切替時に confirming 状態が前ノード分としてリークしないようにしている。
function NodeDetailPanel({ node }: { node: Node }) {
  const removeNode = useCanvasStore((s) => s.removeNode);
  const [confirming, setConfirming] = useState(false);

  return (
    <>
      <Header label={`ノード: ${node.type}`} />
      {/* key={node.id} で選択切替時に再マウントし、フォーム内部 state を resync する。 */}
      <CommonFields key={node.id} node={node} />
      {/* discriminated union で絞り込まれるので個別 Detail 側の node 型は安全。 */}
      {node.type === 'requirement' && <RequirementDetail key={node.id} node={node} />}
      {node.type === 'usecase' && <UseCaseDetail key={node.id} node={node} />}
      {node.type === 'userstory' && <UserStoryDetail key={node.id} node={node} />}
      {node.type === 'question' && <QuestionDetail key={node.id} node={node} />}
      {node.type === 'coderef' && <CodeRefDetail key={node.id} node={node} />}
      {node.type === 'proposal' && <ProposalDetail key={node.id} node={node} />}
      <button type="button" onClick={() => setConfirming(true)} style={DANGER_BUTTON_STYLE}>
        ノードを削除
      </button>
      <ConfirmDialog
        open={confirming}
        title="このノードを削除しますか？"
        body="接続されているエッジも同時に削除されます。"
        onClose={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false);
          removeNode(node.id).catch(console.error);
        }}
      />
    </>
  );
}

function Header({ label }: { label: string }) {
  return (
    <div style={{ fontSize: 11, color: '#8b949e', letterSpacing: 1, marginBottom: 12 }}>
      {label.toUpperCase()}
    </div>
  );
}

function Empty() {
  return (
    <div style={{ color: '#6e7681', fontSize: 12, marginTop: 16 }}>
      ノードまたはエッジを選択してください。
    </div>
  );
}

const SHEET_STYLE = {
  width: 360,
  height: '100%',
  borderLeft: '1px solid #30363d',
  background: '#0d1117',
  color: '#e6edf3',
  display: 'flex',
  flexDirection: 'column' as const,
};

const TABS_STYLE = {
  display: 'flex',
  gap: 4,
  borderBottom: '1px solid #30363d',
  padding: '8px 8px 0 8px',
};

function tabButtonStyle(active: boolean) {
  return {
    background: active ? '#21262d' : 'transparent',
    color: active ? '#e6edf3' : '#8b949e',
    borderTop: '1px solid',
    borderLeft: '1px solid',
    borderRight: '1px solid',
    borderTopColor: active ? '#30363d' : 'transparent',
    borderLeftColor: active ? '#30363d' : 'transparent',
    borderRightColor: active ? '#30363d' : 'transparent',
    borderBottom: 'none',
    borderRadius: '6px 6px 0 0',
    padding: '6px 14px',
    fontSize: 12,
    cursor: 'pointer',
    fontWeight: active ? 600 : 400,
  };
}

const TAB_CONTENT_STYLE = {
  flex: 1,
  padding: 16,
  overflow: 'auto' as const,
  minHeight: 0,
};

const DANGER_BUTTON_STYLE = {
  background: '#2f1720',
  color: '#f85149',
  border: '1px solid #5c1e28',
  borderRadius: 6,
  padding: '8px 12px',
  fontSize: 12,
  cursor: 'pointer',
  marginTop: 24,
  width: '100%',
};
