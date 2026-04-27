import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useCanvasStore } from '@/lib/store';

import { UseCaseDetail } from './usecase-detail';

describe('UseCaseDetail', () => {
  it('ストーリー分解ボタンで startDecompose が呼ばれる', () => {
    const startDecompose = vi.fn(async () => {});
    useCanvasStore.setState({ startDecompose, runningAgent: null } as never);
    render(
      <UseCaseDetail node={{ id: 'uc-1', type: 'usecase', x: 0, y: 0, title: 't', body: 'b' }} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /ストーリー分解/ }));
    expect(startDecompose).toHaveBeenCalledWith('uc-1');
  });

  it('runningAgent が非 null だとボタンが disabled', () => {
    useCanvasStore.setState({
      startDecompose: vi.fn(),
      runningAgent: {
        agent: 'decompose-to-stories',
        inputNodeId: 'uc-1',
        events: [],
      },
    } as never);
    render(
      <UseCaseDetail node={{ id: 'uc-1', type: 'usecase', x: 0, y: 0, title: 't', body: 'b' }} />,
    );
    // busy 時は全ボタンが disabled になる（ストーリー分解 + 関連コード）。
    const buttons = screen.getAllByRole('button') as HTMLButtonElement[];
    expect(buttons.every((b) => b.disabled)).toBe(true);
  });

  it('関連コードボタンが描画される', () => {
    useCanvasStore.getState().hydrate({
      id: 'proj-1',
      name: 'P',
      codebases: [{ id: 'backend', label: 'Backend', path: '../backend' }],
      mcpServers: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      nodes: [{ id: 'uc-1', type: 'usecase', x: 0, y: 0, title: '', body: '' }],
      edges: [],
    });
    render(
      <UseCaseDetail node={{ id: 'uc-1', type: 'usecase', x: 0, y: 0, title: '', body: '' }} />,
    );
    const btn = screen.getByRole('button', { name: /関連コード/ }) as HTMLButtonElement;
    expect(btn).toBeTruthy();
  });

  it('影響分析ボタンが描画される', () => {
    useCanvasStore.getState().reset();
    useCanvasStore.getState().hydrate({
      id: 'proj-1',
      name: 'P',
      codebases: [{ id: 'backend', label: 'Backend', path: '../backend' }],
      mcpServers: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      nodes: [{ id: 'uc-1', type: 'usecase', x: 0, y: 0, title: '', body: '' }],
      edges: [],
    });
    render(
      <UseCaseDetail node={{ id: 'uc-1', type: 'usecase', x: 0, y: 0, title: '', body: '' }} />,
    );
    const btn = screen.getByRole('button', { name: /影響を分析する/ }) as HTMLButtonElement;
    expect(btn).toBeTruthy();
  });

  it('ExtractQuestionsButton を表示する (3 つ目の AI アクション)', () => {
    useCanvasStore.getState().reset();
    render(
      <UseCaseDetail node={{ id: 'uc-1', type: 'usecase', x: 0, y: 0, title: 't', body: 'b' }} />,
    );
    expect(screen.getByRole('button', { name: /論点を抽出/ })).toBeDefined();
  });
});
