import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useCanvasStore } from '@/lib/store';

import { FindRelatedCodeButton } from './find-related-code-button';

const node = { id: 'uc-1', type: 'usecase' as const, x: 0, y: 0, title: 't', body: 'b' };

const baseMeta = {
  id: 'proj-1',
  name: 'P',
  codebases: [] as { id: string; label: string; path: string }[],
  createdAt: '2026-04-18T00:00:00Z',
  updatedAt: '2026-04-18T00:00:00Z',
  nodes: [node],
  edges: [],
};

function hydrate(codebases: { id: string; label: string; path: string }[]) {
  useCanvasStore.getState().hydrate({ ...baseMeta, codebases });
}

describe('FindRelatedCodeButton', () => {
  beforeEach(() => {
    useCanvasStore.getState().reset();
  });

  it('codebases が 0 件なら disabled + title', () => {
    hydrate([]);
    render(<FindRelatedCodeButton node={node} />);
    const btn = screen.getByRole('button', { name: /関連コード/ });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('title', 'コードベースを追加してください');
  });

  it('codebases が 1 件なら enabled でそれを使う', () => {
    hydrate([{ id: 'w', label: 'W', path: '/w' }]);
    render(<FindRelatedCodeButton node={node} />);
    expect(screen.getByRole('button', { name: /関連コード/ })).toBeEnabled();
    expect(screen.queryByLabelText('対象コードベース')).not.toBeInTheDocument();
  });

  it('codebases が 2 件以上なら select が表示される', () => {
    hydrate([
      { id: 'web', label: 'Web', path: '/w' },
      { id: 'api', label: 'API', path: '/a' },
    ]);
    render(<FindRelatedCodeButton node={node} />);
    expect(screen.getByLabelText('対象コードベース')).toBeInTheDocument();
  });

  it('click で startFindRelatedCode(nodeId, codebaseId) が呼ばれる', () => {
    hydrate([{ id: 'w', label: 'W', path: '/w' }]);
    const start = vi.fn(async () => {});
    useCanvasStore.setState({ startFindRelatedCode: start } as never);
    render(<FindRelatedCodeButton node={node} />);
    fireEvent.click(screen.getByRole('button', { name: /関連コード/ }));
    expect(start).toHaveBeenCalledWith('uc-1', 'w');
  });

  it('label が「関連コードを探す」 (codebase 設定済み時)', () => {
    hydrate([{ id: 'w', label: 'W', path: '/w' }]);
    render(<FindRelatedCodeButton node={node} />);
    expect(screen.getByRole('button').textContent).toBe('関連コードを探す');
  });
});
