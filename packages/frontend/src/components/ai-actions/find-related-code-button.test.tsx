import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useCanvasStore } from '@/lib/store';

import { FindRelatedCodeButton } from './find-related-code-button';

const node = { id: 'uc-1', type: 'usecase' as const, x: 0, y: 0, title: 't', body: 'b' };

function hydrate(codebasePath?: string) {
  useCanvasStore.getState().hydrate({
    id: 'proj-1',
    name: 'P',
    ...(codebasePath !== undefined ? { codebasePath } : {}),
    createdAt: '2026-04-18T00:00:00Z',
    updatedAt: '2026-04-18T00:00:00Z',
    nodes: [node],
    edges: [],
  });
}

describe('FindRelatedCodeButton wiring', () => {
  beforeEach(() => {
    useCanvasStore.getState().reset();
  });

  it('click で startFindRelatedCode(nodeId) が呼ばれる', () => {
    hydrate('../backend');
    const start = vi.fn(async () => {});
    useCanvasStore.setState({ startFindRelatedCode: start } as never);
    render(<FindRelatedCodeButton node={node} />);
    fireEvent.click(screen.getByRole('button', { name: /関連コード/ }));
    expect(start).toHaveBeenCalledWith('uc-1');
  });

  it('label が「関連コードを探す」 (codebase 設定済み時)', () => {
    hydrate('../backend');
    render(<FindRelatedCodeButton node={node} />);
    expect(screen.getByRole('button').textContent).toBe('関連コードを探す');
  });
});
