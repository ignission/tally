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

describe('ExtractQuestionsButton', () => {
  beforeEach(() => {
    useCanvasStore.getState().reset();
  });

  it('「論点を抽出」ラベルを表示する', () => {
    render(<ExtractQuestionsButton node={anchor} />);
    expect(screen.getByRole('button', { name: /論点を抽出/ })).toBeDefined();
  });

  it('クリックで store.startExtractQuestions を呼ぶ', () => {
    const spy = vi.fn().mockResolvedValue(undefined);
    useCanvasStore.setState({ startExtractQuestions: spy } as never);
    render(<ExtractQuestionsButton node={anchor} />);
    fireEvent.click(screen.getByRole('button', { name: /論点を抽出/ }));
    expect(spy).toHaveBeenCalledWith('uc-1');
  });
});
