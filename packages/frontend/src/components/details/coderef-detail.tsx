'use client';

import { useId } from 'react';

import type { CodeRefNode } from '@tally/core';

import { useCanvasStore } from '@/lib/store';

export function CodeRefDetail({ node }: { node: CodeRefNode }) {
  const patchNode = useCanvasStore((s) => s.patchNode);
  const set = (patch: Partial<Omit<CodeRefNode, 'id' | 'type'>>) =>
    patchNode<'coderef'>(node.id, patch).catch(console.error);

  const fileId = useId();
  const startId = useId();
  const endId = useId();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 16 }}>
      <div style={LABEL_COL}>
        <label htmlFor={fileId} style={LABEL}>
          ファイルパス
        </label>
        <input
          id={fileId}
          defaultValue={node.filePath ?? ''}
          onBlur={(e) => {
            const v = e.target.value;
            set(v === '' ? { filePath: undefined } : { filePath: v });
          }}
          placeholder="src/foo.ts"
          style={INPUT_STYLE}
        />
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <div style={{ ...LABEL_COL, flex: 1 }}>
          <label htmlFor={startId} style={LABEL}>
            開始行
          </label>
          <input
            id={startId}
            type="number"
            min={0}
            defaultValue={node.startLine ?? ''}
            onBlur={(e) => {
              const v = e.target.value;
              set(v === '' ? { startLine: undefined } : { startLine: Number(v) });
            }}
            style={INPUT_STYLE}
          />
        </div>
        <div style={{ ...LABEL_COL, flex: 1 }}>
          <label htmlFor={endId} style={LABEL}>
            終了行
          </label>
          <input
            id={endId}
            type="number"
            min={0}
            defaultValue={node.endLine ?? ''}
            onBlur={(e) => {
              const v = e.target.value;
              set(v === '' ? { endLine: undefined } : { endLine: Number(v) });
            }}
            style={INPUT_STYLE}
          />
        </div>
      </div>
    </div>
  );
}

const LABEL = { fontSize: 11, color: '#8b949e' } as const;
const LABEL_COL = { display: 'flex', flexDirection: 'column', gap: 4 } as const;
const INPUT_STYLE = {
  background: '#0d1117',
  border: '1px solid #30363d',
  color: '#e6edf3',
  borderRadius: 6,
  padding: '6px 8px',
  fontSize: 13,
} as const;
