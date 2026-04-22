import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useCanvasStore } from '@/lib/store';

import { ExtractQuestionsButton } from './extract-questions-button';

const anchor = {
  id: 'uc-1',
  type: 'usecase' as const,
  x: 0,
  y: 0,
  title: '',
  body: '',
};

const baseMeta = {
  id: 'proj-1',
  name: 'P',
  codebases: [] as { id: string; label: string; path: string }[],
  createdAt: '2026-04-18T00:00:00Z',
  updatedAt: '2026-04-18T00:00:00Z',
  nodes: [anchor],
  edges: [],
};

describe('ExtractQuestionsButton', () => {
  beforeEach(() => {
    useCanvasStore.getState().reset();
  });

  it('「論点を抽出」ラベルを表示する', () => {
    useCanvasStore.getState().hydrate(baseMeta);
    render(<ExtractQuestionsButton node={anchor} />);
    expect(screen.getByRole('button', { name: /論点を抽出/ })).toBeDefined();
  });

  it('クリックで store.startExtractQuestions を呼ぶ', () => {
    useCanvasStore.getState().hydrate(baseMeta);
    const spy = vi.fn().mockResolvedValue(undefined);
    useCanvasStore.setState({ startExtractQuestions: spy } as never);
    render(<ExtractQuestionsButton node={anchor} />);
    fireEvent.click(screen.getByRole('button', { name: /論点を抽出/ }));
    expect(spy).toHaveBeenCalledWith('uc-1');
  });

  // codebase 不要なので 0 件でも disabled にならない
  it('codebases が 0 件でも enabled', () => {
    useCanvasStore.getState().hydrate({ ...baseMeta, codebases: [] });
    render(<ExtractQuestionsButton node={anchor} />);
    expect(screen.getByRole('button', { name: /論点を抽出/ })).toBeEnabled();
  });
});
