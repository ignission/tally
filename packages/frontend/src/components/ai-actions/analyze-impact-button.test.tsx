import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useCanvasStore } from '@/lib/store';

import { AnalyzeImpactButton } from './analyze-impact-button';

const node = { id: 'uc-1', type: 'usecase' as const, x: 0, y: 0, title: 't', body: 'b' };

const baseMeta = {
  id: 'proj-1',
  name: 'P',
  codebases: [] as { id: string; label: string; path: string }[],
  mcpServers: [],
  createdAt: '2026-04-18T00:00:00Z',
  updatedAt: '2026-04-18T00:00:00Z',
  nodes: [node],
  edges: [],
};

function hydrateWithLinks(
  codebases: { id: string; label: string; path: string }[],
  linkedNodes: Array<Record<string, unknown>>,
  edges: Array<Record<string, unknown>>,
) {
  useCanvasStore.getState().hydrate({
    ...baseMeta,
    codebases,
    nodes: [node, ...linkedNodes] as never,
    edges: edges as never,
  });
}

describe('AnalyzeImpactButton', () => {
  beforeEach(() => {
    useCanvasStore.getState().reset();
  });

  it('codebases が 0 件なら disabled + title', () => {
    hydrateWithLinks([], [], []);
    render(<AnalyzeImpactButton node={node} />);
    const btn = screen.getByRole('button', { name: /影響を分析する/ });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('title', 'コードベースを追加してください');
  });

  it('codebases が 1 件なら enabled でそれを使う', () => {
    hydrateWithLinks([{ id: 'w', label: 'W', path: '/w' }], [], []);
    render(<AnalyzeImpactButton node={node} />);
    expect(screen.getByRole('button', { name: /影響を分析する/ })).toBeEnabled();
    expect(screen.queryByLabelText('対象コードベース')).not.toBeInTheDocument();
  });

  it('codebases が 2 件以上なら select が表示される', () => {
    hydrateWithLinks(
      [
        { id: 'web', label: 'Web', path: '/w' },
        { id: 'api', label: 'API', path: '/a' },
      ],
      [],
      [],
    );
    render(<AnalyzeImpactButton node={node} />);
    expect(screen.getByLabelText('対象コードベース')).toBeInTheDocument();
  });

  it('click で startAnalyzeImpact(nodeId, codebaseId) が呼ばれる', () => {
    hydrateWithLinks([{ id: 'w', label: 'W', path: '/w' }], [], []);
    const start = vi.fn(async () => {});
    useCanvasStore.setState({ startAnalyzeImpact: start } as never);
    render(<AnalyzeImpactButton node={node} />);
    fireEvent.click(screen.getByRole('button', { name: /影響を分析する/ }));
    expect(start).toHaveBeenCalledWith('uc-1', 'w');
  });

  it('anchor に紐づく coderef が 0 件なら tooltip に「まず『関連コードを探す』」を含む', () => {
    hydrateWithLinks([{ id: 'w', label: 'W', path: '/w' }], [], []);
    render(<AnalyzeImpactButton node={node} />);
    expect(screen.getByRole('button').getAttribute('title')).toContain('関連コードを探す');
  });

  it('anchor に紐づく proposal(adoptAs=coderef) があれば通常 tooltip', () => {
    hydrateWithLinks(
      [{ id: 'w', label: 'W', path: '/w' }],
      [{ id: 'cref-1', type: 'proposal', adoptAs: 'coderef', x: 0, y: 0, title: 't', body: '' }],
      [{ id: 'e-1', from: 'uc-1', to: 'cref-1', type: 'derive' }],
    );
    render(<AnalyzeImpactButton node={node} />);
    expect(screen.getByRole('button').getAttribute('title')).toContain('変更が必要');
  });

  it('anchor に紐づく coderef ノード (正規) があれば通常 tooltip', () => {
    hydrateWithLinks(
      [{ id: 'w', label: 'W', path: '/w' }],
      [{ id: 'cref-2', type: 'coderef', x: 0, y: 0, title: '', body: '' }],
      [{ id: 'e-2', from: 'uc-1', to: 'cref-2', type: 'derive' }],
    );
    render(<AnalyzeImpactButton node={node} />);
    expect(screen.getByRole('button').getAttribute('title')).toContain('変更が必要');
  });

  it('label が「影響を分析する」 (codebase 設定済み時)', () => {
    hydrateWithLinks([{ id: 'w', label: 'W', path: '/w' }], [], []);
    render(<AnalyzeImpactButton node={node} />);
    expect(screen.getByRole('button').textContent).toBe('影響を分析する');
  });
});
