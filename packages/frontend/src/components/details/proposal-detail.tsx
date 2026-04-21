'use client';

import { useState } from 'react';

import type { AdoptableType, ProposalNode } from '@tally/core';

import { useCanvasStore } from '@/lib/store';

const ADOPTABLE_TYPES = [
  'requirement',
  'usecase',
  'userstory',
  'question',
  'coderef',
  'issue',
] as const satisfies readonly AdoptableType[];

// ProposalNodeSchema.adoptAs は z.enum(NODE_TYPES).optional() なので 'proposal' も
// 通ってしまう。AdoptableType = Exclude<NodeType,'proposal'> の select 選択肢には
// 存在しないため、ランタイムで弾いて userstory にフォールバックする。
function isAdoptable(v: unknown): v is AdoptableType {
  return typeof v === 'string' && (ADOPTABLE_TYPES as readonly string[]).includes(v);
}

// proposal ノード専用の詳細ペイン。採用ボタンで transmuteNode API を叩き、
// 成功すると DetailSheet は新 type 向けの詳細に自動で切り替わる (同じ id が別 type になるため)。
export function ProposalDetail({ node }: { node: ProposalNode }) {
  const adoptProposal = useCanvasStore((s) => s.adoptProposal);
  const initial: AdoptableType = isAdoptable(node.adoptAs) ? node.adoptAs : 'userstory';
  const [adoptAs, setAdoptAs] = useState<AdoptableType>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onAdopt = async () => {
    setBusy(true);
    setError(null);
    try {
      // proposal ノードに保持されている type 固有属性を additional として採用時に引き継ぐ。
      // 既知キー (id / type / 座標 / title / body / adoptAs / sourceAgentId) を取り除いた残りを渡す。
      const {
        id: _id,
        type: _type,
        x: _x,
        y: _y,
        title: _title,
        body: _body,
        adoptAs: _adoptAs,
        sourceAgentId: _sourceAgentId,
        ...rest
      } = node as unknown as Record<string, unknown>;
      const additional = Object.keys(rest).length > 0 ? rest : undefined;
      await adoptProposal(node.id, adoptAs, additional);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 16 }}>
      <div style={{ fontSize: 11, color: '#8b949e' }}>採用</div>
      <label
        htmlFor={`proposal-adopt-as-${node.id}`}
        style={{ fontSize: 12, display: 'flex', flexDirection: 'column', gap: 4 }}
      >
        <span>採用先</span>
        <select
          id={`proposal-adopt-as-${node.id}`}
          value={adoptAs}
          onChange={(e) => setAdoptAs(e.target.value as AdoptableType)}
          style={SELECT_STYLE}
        >
          {ADOPTABLE_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </label>
      <button type="button" disabled={busy} onClick={onAdopt} style={ADOPT_BUTTON_STYLE}>
        {busy ? '採用中…' : '採用する'}
      </button>
      {error && <div style={{ color: '#f85149', fontSize: 11 }}>{error}</div>}
    </div>
  );
}

const SELECT_STYLE = {
  background: '#0d1117',
  border: '1px solid #30363d',
  color: '#e6edf3',
  borderRadius: 6,
  padding: '4px 8px',
  fontSize: 12,
} as const;

const ADOPT_BUTTON_STYLE = {
  background: '#238636',
  color: '#fff',
  border: '1px solid #2ea043',
  borderRadius: 6,
  padding: '8px 12px',
  fontSize: 12,
  cursor: 'pointer',
  width: '100%',
} as const;
