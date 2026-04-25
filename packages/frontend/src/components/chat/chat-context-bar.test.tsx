import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { useCanvasStore } from '@/lib/store';

import { ChatContextBar } from './chat-context-bar';

// issue #11: コンテキストバーは store の chatContextNodeIds を可視化し、
// add/remove ボタンで操作する。最低限の挙動を担保する。
describe('ChatContextBar', () => {
  beforeEach(() => {
    useCanvasStore.getState().reset();
    // ノード 2 件を仕込む
    useCanvasStore.setState({
      nodes: {
        'req-a': { id: 'req-a', type: 'requirement', x: 0, y: 0, title: 'A', body: '' },
        'uc-1': { id: 'uc-1', type: 'usecase', x: 0, y: 0, title: 'UC1', body: '' },
      },
    } as never);
  });

  it('未添付なら「未添付」が出る', () => {
    render(<ChatContextBar />);
    expect(screen.getByText('未添付')).toBeDefined();
  });

  it('「+ ノードを追加」でピッカー開閉、ノードクリックで添付', () => {
    render(<ChatContextBar />);
    const openBtn = screen.getByRole('button', { name: 'コンテキストにノードを追加' });
    fireEvent.click(openBtn);
    // 要求ノード A が候補に出る
    const item = screen.getByText(/^A/);
    fireEvent.click(item);
    expect(useCanvasStore.getState().chatContextNodeIds).toEqual(['req-a']);
  });

  it('chip の × で個別解除できる', () => {
    useCanvasStore.getState().addChatContextNode('req-a');
    render(<ChatContextBar />);
    const removeBtn = screen.getByRole('button', { name: /要求「A」を解除/ });
    fireEvent.click(removeBtn);
    expect(useCanvasStore.getState().chatContextNodeIds).toEqual([]);
  });

  it('「すべて解除」で chatContextNodeIds が空になる', () => {
    useCanvasStore.getState().addChatContextNode('req-a');
    useCanvasStore.getState().addChatContextNode('uc-1');
    render(<ChatContextBar />);
    const clearBtn = screen.getByRole('button', { name: /コンテキストをすべて解除/ });
    fireEvent.click(clearBtn);
    expect(useCanvasStore.getState().chatContextNodeIds).toEqual([]);
  });

  it('選択中ノードが未添付ならショートカットボタンが出る、押すと add される', () => {
    useCanvasStore.getState().select({ kind: 'node', id: 'uc-1' });
    render(<ChatContextBar />);
    const btn = screen.getByRole('button', { name: '選択中のノードを添付' });
    fireEvent.click(btn);
    expect(useCanvasStore.getState().chatContextNodeIds).toEqual(['uc-1']);
  });
});
