'use client';

import type {
  QualityCategory,
  RequirementKind,
  RequirementNode,
  RequirementPriority,
} from '@tally/core';

import { QUALITY_CATEGORIES, REQUIREMENT_KINDS, REQUIREMENT_PRIORITIES } from '@tally/core';
import { useId } from 'react';

import { AnalyzeImpactButton } from '@/components/ai-actions/analyze-impact-button';
import { ExtractQuestionsButton } from '@/components/ai-actions/extract-questions-button';
import { FindRelatedCodeButton } from '@/components/ai-actions/find-related-code-button';
import { useCanvasStore } from '@/lib/store';

export function RequirementDetail({ node }: { node: RequirementNode }) {
  const patchNode = useCanvasStore((s) => s.patchNode);
  // exactOptionalPropertyTypes が有効なので、空選択時は key ごと省いた patch を渡す。
  const set = (patch: Partial<Omit<RequirementNode, 'id' | 'type'>>) =>
    patchNode<'requirement'>(node.id, patch).catch(console.error);

  const kindId = useId();
  const priorityId = useId();
  const qualityId = useId();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 16 }}>
      <div style={FIELD_STYLE}>
        <label htmlFor={kindId} style={LABEL_STYLE}>
          種別
        </label>
        <select
          id={kindId}
          value={node.kind ?? ''}
          onChange={(e) => {
            const v = e.target.value as RequirementKind | '';
            set(v === '' ? { kind: undefined } : { kind: v });
          }}
          style={SELECT_STYLE}
        >
          <option value="">未指定</option>
          {REQUIREMENT_KINDS.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
      </div>
      <div style={FIELD_STYLE}>
        <label htmlFor={priorityId} style={LABEL_STYLE}>
          優先度
        </label>
        <select
          id={priorityId}
          value={node.priority ?? ''}
          onChange={(e) => {
            const v = e.target.value as RequirementPriority | '';
            set(v === '' ? { priority: undefined } : { priority: v });
          }}
          style={SELECT_STYLE}
        >
          <option value="">未指定</option>
          {REQUIREMENT_PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </div>
      <div style={FIELD_STYLE}>
        <label htmlFor={qualityId} style={LABEL_STYLE}>
          品質カテゴリ (ISO 25010)
        </label>
        <select
          id={qualityId}
          value={node.qualityCategory ?? ''}
          onChange={(e) => {
            const v = e.target.value as QualityCategory | '';
            set(v === '' ? { qualityCategory: undefined } : { qualityCategory: v });
          }}
          style={SELECT_STYLE}
        >
          <option value="">未指定</option>
          {QUALITY_CATEGORIES.map((q) => (
            <option key={q} value={q}>
              {q}
            </option>
          ))}
        </select>
      </div>
      <div style={{ fontSize: 11, color: '#8b949e', marginTop: 8 }}>AI アクション</div>
      <FindRelatedCodeButton node={node} />
      <AnalyzeImpactButton node={node} />
      <ExtractQuestionsButton node={node} />
    </div>
  );
}

const FIELD_STYLE = { display: 'flex', flexDirection: 'column', gap: 4 } as const;
const LABEL_STYLE = { fontSize: 11, color: '#8b949e' } as const;
const SELECT_STYLE = {
  background: '#0d1117',
  border: '1px solid #30363d',
  color: '#e6edf3',
  borderRadius: 6,
  padding: '6px 8px',
  fontSize: 13,
} as const;
