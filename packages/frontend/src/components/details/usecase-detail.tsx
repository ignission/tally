'use client';

import type { UseCaseNode } from '@tally/core';

import { AnalyzeImpactButton } from '@/components/ai-actions/analyze-impact-button';
import { ExtractQuestionsButton } from '@/components/ai-actions/extract-questions-button';
import { FindRelatedCodeButton } from '@/components/ai-actions/find-related-code-button';
import { useCanvasStore } from '@/lib/store';

// UC ノード専用の詳細ペイン。AI アクションを 2 つ提供: ストーリー分解 / 関連コード探索。
// 同時実行は runningAgent で排他制御する。
export function UseCaseDetail({ node }: { node: UseCaseNode }) {
  const startDecompose = useCanvasStore((s) => s.startDecompose);
  const running = useCanvasStore((s) => s.runningAgent);
  const busy = running !== null;

  const onDecompose = () => {
    startDecompose(node.id).catch(console.error);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 16 }}>
      <div style={{ fontSize: 11, color: '#8b949e' }}>AI アクション</div>
      <button
        type="button"
        disabled={busy}
        onClick={onDecompose}
        style={{ ...BUTTON_STYLE, cursor: busy ? 'not-allowed' : 'pointer' }}
      >
        {busy ? '実行中…' : 'ストーリー分解'}
      </button>
      <FindRelatedCodeButton node={node} />
      <AnalyzeImpactButton node={node} />
      <ExtractQuestionsButton node={node} />
    </div>
  );
}

const BUTTON_STYLE = {
  background: '#1f6feb',
  color: '#fff',
  border: '1px solid #388bfd',
  borderRadius: 6,
  padding: '8px 12px',
  fontSize: 12,
  width: '100%',
} as const;
