'use client';

import { nanoid } from 'nanoid';
import { useState } from 'react';

import type { QuestionNode, QuestionOption } from '@tally/core';

import { useCanvasStore } from '@/lib/store';

export function QuestionDetail({ node }: { node: QuestionNode }) {
  const patchNode = useCanvasStore((s) => s.patchNode);
  const set = (patch: Partial<Omit<QuestionNode, 'id' | 'type'>>) =>
    patchNode<'question'>(node.id, patch).catch(console.error);
  const [draft, setDraft] = useState('');

  const options = node.options ?? [];

  const addOption = () => {
    const text = draft.trim();
    if (!text) return;
    set({ options: [...options, { id: `opt-${nanoid(8)}`, text, selected: false }] });
    setDraft('');
  };
  const decide = (id: string) => {
    // options[].selected と decision を 1 操作で同期させる (単一の真実)。
    const nextOptions = options.map((o) => ({ ...o, selected: o.id === id }));
    set({ options: nextOptions, decision: id });
  };
  const undecide = () => {
    const nextOptions = options.map((o) => ({ ...o, selected: false }));
    set({ options: nextOptions, decision: null });
  };
  const remove = (id: string) => {
    const nextOptions = options.filter((o) => o.id !== id);
    set({
      options: nextOptions,
      decision: node.decision === id ? null : (node.decision ?? null),
    });
  };
  const editText = (id: string, text: string) => {
    set({ options: options.map((o) => (o.id === id ? { ...o, text } : o)) });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 16 }}>
      <div style={{ fontSize: 11, color: '#8b949e' }}>選択肢</div>
      <ul
        style={{
          listStyle: 'none',
          padding: 0,
          margin: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
        }}
      >
        {options.map((opt: QuestionOption) => {
          const isDecided = node.decision === opt.id;
          return (
            <li key={opt.id} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <button
                type="button"
                onClick={() => (isDecided ? undecide() : decide(opt.id))}
                title={isDecided ? '決定を解除' : 'この選択肢に決定'}
                style={{
                  ...PICK_STYLE,
                  background: isDecided ? '#238636' : '#21262d',
                  color: isDecided ? '#fff' : '#8b949e',
                }}
              >
                {isDecided ? '✓' : '○'}
              </button>
              <input
                defaultValue={opt.text}
                onBlur={(e) => {
                  if (e.target.value !== opt.text) editText(opt.id, e.target.value);
                }}
                style={{ ...INPUT_STYLE, flex: 1 }}
              />
              <button
                type="button"
                onClick={() => remove(opt.id)}
                aria-label="削除"
                style={DELETE_BUTTON_STYLE}
              >
                ×
              </button>
            </li>
          );
        })}
        <li style={{ display: 'flex', gap: 6, marginTop: 6 }}>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') addOption();
            }}
            placeholder="新しい選択肢..."
            style={{ ...INPUT_STYLE, flex: 1 }}
          />
          <button type="button" onClick={addOption} style={ADD_BUTTON_STYLE}>
            追加
          </button>
        </li>
      </ul>
    </div>
  );
}

const INPUT_STYLE = {
  background: '#0d1117',
  border: '1px solid #30363d',
  color: '#e6edf3',
  borderRadius: 6,
  padding: '4px 8px',
  fontSize: 12,
} as const;
const PICK_STYLE = {
  border: '1px solid #30363d',
  borderRadius: 999,
  width: 24,
  height: 24,
  fontSize: 12,
  cursor: 'pointer',
} as const;
const ADD_BUTTON_STYLE = {
  background: '#21262d',
  color: '#e6edf3',
  border: '1px solid #30363d',
  borderRadius: 6,
  padding: '4px 10px',
  fontSize: 12,
  cursor: 'pointer',
} as const;
const DELETE_BUTTON_STYLE = {
  background: 'transparent',
  color: '#8b949e',
  border: 'none',
  fontSize: 16,
  cursor: 'pointer',
  padding: '0 4px',
} as const;
