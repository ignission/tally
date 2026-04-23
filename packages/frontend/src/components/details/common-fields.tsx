'use client';

import type { Node } from '@tally/core';
import { useId, useState } from 'react';

import { TextArea } from '@/components/ui/text-area';
import { TextInput } from '@/components/ui/text-input';
import { useCanvasStore } from '@/lib/store';

// 選択ノード切替時の resync は親側で `key={node.id}` による再マウントに委ねる。
// これにより effect を持たずに initial state を `useState(node.title)` で賄える。
export function CommonFields({ node }: { node: Node }) {
  const patchNode = useCanvasStore((s) => s.patchNode);
  const [title, setTitle] = useState(node.title);
  const [body, setBody] = useState(node.body);
  const titleId = useId();
  const bodyId = useId();

  const commitTitle = () => {
    if (title !== node.title) patchNode(node.id, { title }).catch(console.error);
  };
  const commitBody = () => {
    if (body !== node.body) patchNode(node.id, { body }).catch(console.error);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <label htmlFor={titleId} style={LABEL_STYLE}>
        タイトル
      </label>
      <TextInput
        id={titleId}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={commitTitle}
        style={INPUT_STYLE}
      />
      <label htmlFor={bodyId} style={LABEL_STYLE}>
        本文
      </label>
      <TextArea
        id={bodyId}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onBlur={commitBody}
        rows={6}
        style={{ ...INPUT_STYLE, resize: 'vertical' }}
      />
    </div>
  );
}

const LABEL_STYLE = { fontSize: 11, color: '#8b949e', letterSpacing: 0.5 } as const;
const INPUT_STYLE = {
  background: '#0d1117',
  border: '1px solid #30363d',
  color: '#e6edf3',
  borderRadius: 6,
  padding: '6px 8px',
  fontSize: 13,
  fontFamily: 'inherit',
} as const;
