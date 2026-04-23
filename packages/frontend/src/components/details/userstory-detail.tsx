'use client';

import type { UserStoryNode, UserStoryTask } from '@tally/core';
import { nanoid } from 'nanoid';
import { useId, useState } from 'react';

import { AnalyzeImpactButton } from '@/components/ai-actions/analyze-impact-button';
import { ExtractQuestionsButton } from '@/components/ai-actions/extract-questions-button';
import { FindRelatedCodeButton } from '@/components/ai-actions/find-related-code-button';
import { TextInput } from '@/components/ui/text-input';
import { useCanvasStore } from '@/lib/store';

// AcceptanceCriterion と UserStoryTask はどちらも {id, text, done} の同形。
type CheckItem = UserStoryTask;

export function UserStoryDetail({ node }: { node: UserStoryNode }) {
  const patchNode = useCanvasStore((s) => s.patchNode);
  const set = (patch: Partial<Omit<UserStoryNode, 'id' | 'type'>>) =>
    patchNode<'userstory'>(node.id, patch).catch(console.error);
  const pointsId = useId();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 16 }}>
      <div>
        <Heading>受け入れ基準</Heading>
        <CheckList
          items={node.acceptanceCriteria ?? []}
          onChange={(items) => set({ acceptanceCriteria: items })}
        />
      </div>
      <div>
        <Heading>タスク</Heading>
        <CheckList items={node.tasks ?? []} onChange={(items) => set({ tasks: items })} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <label htmlFor={pointsId} style={{ fontSize: 11, color: '#8b949e' }}>
          ストーリーポイント
        </label>
        <input
          id={pointsId}
          type="number"
          min={1}
          step={1}
          defaultValue={node.points ?? ''}
          onBlur={(e) => {
            const v = e.target.value;
            set(v === '' ? { points: undefined } : { points: Number(v) });
          }}
          style={INPUT_STYLE}
        />
      </div>
      <div style={{ fontSize: 11, color: '#8b949e', marginTop: 8 }}>AI アクション</div>
      <FindRelatedCodeButton node={node} />
      <AnalyzeImpactButton node={node} />
      <ExtractQuestionsButton node={node} />
    </div>
  );
}

function CheckList({
  items,
  onChange,
}: {
  items: CheckItem[];
  onChange: (items: CheckItem[]) => void;
}) {
  const [draft, setDraft] = useState('');
  const add = () => {
    const text = draft.trim();
    if (!text) return;
    onChange([...items, { id: `ci-${nanoid(8)}`, text, done: false }]);
    setDraft('');
  };
  return (
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
      {items.map((it) => (
        <li key={it.id} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input
            type="checkbox"
            checked={it.done}
            onChange={(e) =>
              onChange(items.map((x) => (x.id === it.id ? { ...x, done: e.target.checked } : x)))
            }
          />
          <TextInput
            defaultValue={it.text}
            onBlur={(e) => {
              const nextText = e.target.value;
              if (nextText !== it.text) {
                onChange(items.map((x) => (x.id === it.id ? { ...x, text: nextText } : x)));
              }
            }}
            style={{ ...INPUT_STYLE, flex: 1 }}
          />
          <button
            type="button"
            onClick={() => onChange(items.filter((x) => x.id !== it.id))}
            style={DELETE_BUTTON_STYLE}
            aria-label="削除"
          >
            ×
          </button>
        </li>
      ))}
      <li style={{ display: 'flex', gap: 6, marginTop: 6 }}>
        <TextInput
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') add();
          }}
          placeholder="新しい項目..."
          style={{ ...INPUT_STYLE, flex: 1 }}
        />
        <button type="button" onClick={add} style={ADD_BUTTON_STYLE}>
          追加
        </button>
      </li>
    </ul>
  );
}

function Heading({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 11, color: '#8b949e', letterSpacing: 0.5, marginBottom: 6 }}>
      {children}
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
