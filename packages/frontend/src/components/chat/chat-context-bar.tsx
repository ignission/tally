'use client';

import { NODE_META, type Node, type NodeType } from '@tally/core';
import { useState } from 'react';

import { useCanvasStore } from '@/lib/store';

// issue #11: Chat に「@メンション」のように添付するノードを操作するバー。
// ChatInput の上に並ぶ。役割は 3 つ:
//  1) 添付済みノードを chip として並べ、x で個別解除
//  2) 「+ ノードを追加」ボタンでピッカーを開き、キャンバスのノードを type 別にまとめて選ぶ
//  3) 選択中ノード (canvas で 1 つ選んでいる時) を一発で添付するショートカット
//
// 永続化はしない (store 側で管理、スレッド切替で自動クリア)。
export function ChatContextBar() {
  const nodes = useCanvasStore((s) => s.nodes);
  const selected = useCanvasStore((s) => s.selected);
  const ids = useCanvasStore((s) => s.chatContextNodeIds);
  const addCtx = useCanvasStore((s) => s.addChatContextNode);
  const removeCtx = useCanvasStore((s) => s.removeChatContextNode);
  const clearCtx = useCanvasStore((s) => s.clearChatContext);

  const [pickerOpen, setPickerOpen] = useState(false);

  // 削除済みノードを参照している場合は表示から除外する (送信時にも store でフィルタ済み)。
  const attached = ids.map((id) => nodes[id]).filter((n): n is Node => Boolean(n));

  const selectedNodeId = selected?.kind === 'node' ? selected.id : null;
  const canAttachSelected = selectedNodeId != null && !ids.includes(selectedNodeId);

  // pickerOpen の状態に応じてトグルボタンの aria-label を切り替え、SR でも開閉が伝わるようにする。
  const pickerToggleLabel = pickerOpen
    ? 'コンテキスト追加ピッカーを閉じる'
    : 'コンテキストにノードを追加';

  return (
    <div style={WRAP_STYLE} data-testid="chat-context-bar">
      <div style={ROW_STYLE}>
        <span style={LABEL_STYLE}>コンテキスト</span>
        {attached.map((n) => (
          <ChatContextChip key={n.id} node={n} onRemove={() => removeCtx(n.id)} />
        ))}
        {attached.length === 0 && <span style={EMPTY_STYLE}>未添付</span>}
      </div>
      <div style={ROW_STYLE}>
        <button
          type="button"
          style={BUTTON_STYLE}
          onClick={() => setPickerOpen((v) => !v)}
          aria-expanded={pickerOpen}
          aria-label={pickerToggleLabel}
        >
          {pickerOpen ? '× 閉じる' : '+ ノードを追加'}
        </button>
        {canAttachSelected && selectedNodeId && (
          <button
            type="button"
            style={BUTTON_STYLE}
            onClick={() => addCtx(selectedNodeId)}
            aria-label="選択中のノードを添付"
          >
            ＠選択中ノードを追加
          </button>
        )}
        {attached.length > 0 && (
          <button
            type="button"
            style={SECONDARY_BUTTON_STYLE}
            onClick={() => clearCtx()}
            aria-label="コンテキストをすべて解除"
          >
            すべて解除
          </button>
        )}
      </div>
      {pickerOpen && <ChatContextPicker onClose={() => setPickerOpen(false)} />}
    </div>
  );
}

interface ChipProps {
  node: Node;
  onRemove: () => void;
}

// 1 個のコンテキストノードを示す chip。type の色をボーダーに反映する。
function ChatContextChip({ node, onRemove }: ChipProps) {
  const meta = NODE_META[node.type];
  const label = node.title.trim().length > 0 ? node.title : '(無題)';
  const truncated = label.length > 24 ? `${label.slice(0, 24)}…` : label;
  return (
    <span
      style={{
        ...CHIP_STYLE,
        borderColor: meta.accent,
      }}
      title={`${meta.label}: ${label}`}
      data-testid="chat-context-chip"
    >
      <span style={{ color: meta.color, fontSize: 10 }}>{meta.icon}</span>
      <span>{truncated}</span>
      <button
        type="button"
        style={CHIP_REMOVE_STYLE}
        onClick={onRemove}
        aria-label={`${meta.label}「${label}」を解除`}
      >
        ×
      </button>
    </span>
  );
}

interface PickerProps {
  onClose: () => void;
}

// type 別グルーピングのピッカー。表示順は NODE_TYPES の宣言順 (proposal は最後)。
function ChatContextPicker({ onClose }: PickerProps) {
  const nodes = useCanvasStore((s) => s.nodes);
  const ids = useCanvasStore((s) => s.chatContextNodeIds);
  const addCtx = useCanvasStore((s) => s.addChatContextNode);

  // NODE_META のキー順 (= 宣言順) で 1 パスに直接 groups を組む。
  // 2 段階 (Map 構築 → 再走査) を避け、空グループはここで除外する。
  const orderedTypes = Object.keys(NODE_META) as NodeType[];
  const groups = orderedTypes
    .map((type) => ({
      type,
      items: Object.values(nodes).filter((n) => n.type === type),
    }))
    .filter((g) => g.items.length > 0);
  const isEmpty = groups.length === 0;

  if (isEmpty) {
    return (
      <div style={PICKER_STYLE} role="dialog" aria-label="コンテキストに追加するノードを選択">
        <p style={PICKER_EMPTY_STYLE}>キャンバスにノードがありません。</p>
        <div style={PICKER_FOOTER_STYLE}>
          <button type="button" style={SECONDARY_BUTTON_STYLE} onClick={onClose}>
            閉じる
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={PICKER_STYLE} role="dialog" aria-label="コンテキストに追加するノードを選択">
      {groups.map(({ type, items }) => {
        const meta = NODE_META[type];
        return (
          <div key={type} style={PICKER_GROUP_STYLE}>
            <div style={{ ...PICKER_GROUP_HEADER_STYLE, color: meta.color }}>
              {meta.icon} {meta.label} ({items.length})
            </div>
            <div style={PICKER_LIST_STYLE}>
              {items.map((n) => {
                const already = ids.includes(n.id);
                const label = n.title.trim().length > 0 ? n.title : '(無題)';
                const truncated = label.length > 36 ? `${label.slice(0, 36)}…` : label;
                return (
                  <button
                    key={n.id}
                    type="button"
                    disabled={already}
                    onClick={() => addCtx(n.id)}
                    style={{
                      ...PICKER_ITEM_STYLE,
                      opacity: already ? 0.4 : 1,
                      cursor: already ? 'default' : 'pointer',
                    }}
                    title={label}
                  >
                    {truncated} {already ? '(添付済)' : ''}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
      <div style={PICKER_FOOTER_STYLE}>
        <button type="button" style={SECONDARY_BUTTON_STYLE} onClick={onClose}>
          閉じる
        </button>
      </div>
    </div>
  );
}

// ---- styles ----
const WRAP_STYLE = {
  display: 'flex',
  flexDirection: 'column' as const,
  gap: 4,
  padding: '4px 4px 0 4px',
};
const ROW_STYLE = {
  display: 'flex',
  flexWrap: 'wrap' as const,
  alignItems: 'center',
  gap: 6,
};
const LABEL_STYLE = {
  fontSize: 11,
  color: '#8b949e',
  marginRight: 2,
};
const EMPTY_STYLE = {
  fontSize: 11,
  color: '#6e7681',
  fontStyle: 'italic' as const,
};
const CHIP_STYLE = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  border: '1px solid #30363d',
  borderRadius: 12,
  padding: '2px 6px',
  fontSize: 11,
  background: '#161b22',
  color: '#e6edf3',
  maxWidth: 220,
};
const CHIP_REMOVE_STYLE = {
  background: 'transparent',
  border: 'none',
  color: '#8b949e',
  cursor: 'pointer',
  fontSize: 12,
  padding: 0,
  lineHeight: 1,
};
const BUTTON_STYLE = {
  background: '#21262d',
  color: '#e6edf3',
  border: '1px solid #30363d',
  borderRadius: 6,
  padding: '2px 8px',
  fontSize: 11,
  cursor: 'pointer',
};
const SECONDARY_BUTTON_STYLE = {
  ...BUTTON_STYLE,
  color: '#8b949e',
};
const PICKER_STYLE = {
  border: '1px solid #30363d',
  background: '#0d1117',
  borderRadius: 6,
  padding: 6,
  marginTop: 2,
  maxHeight: 240,
  overflow: 'auto' as const,
};
const PICKER_EMPTY_STYLE = {
  fontSize: 11,
  color: '#8b949e',
  margin: 0,
  padding: 4,
};
const PICKER_GROUP_STYLE = {
  marginBottom: 6,
};
const PICKER_GROUP_HEADER_STYLE = {
  fontSize: 11,
  fontWeight: 600 as const,
  marginBottom: 2,
};
const PICKER_LIST_STYLE = {
  display: 'flex',
  flexDirection: 'column' as const,
  gap: 2,
};
const PICKER_ITEM_STYLE = {
  background: 'transparent',
  border: '1px solid transparent',
  color: '#e6edf3',
  textAlign: 'left' as const,
  fontSize: 11,
  padding: '2px 6px',
  borderRadius: 4,
};
const PICKER_FOOTER_STYLE = {
  display: 'flex',
  justifyContent: 'flex-end',
  marginTop: 4,
};
