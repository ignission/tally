import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useCanvasStore } from '@/lib/store';

import { ChatTab } from './chat-tab';

describe('ChatTab', () => {
  beforeEach(() => {
    useCanvasStore.getState().reset();
  });

  it('activeChatThreadId 無しなら案内メッセージを表示', () => {
    useCanvasStore.setState({
      loadChatThreads: vi.fn().mockResolvedValue(undefined),
      chatThreadList: [],
      activeChatThreadId: null,
    } as never);
    render(<ChatTab />);
    expect(screen.getByText(/スレッドを選択または新規作成/)).toBeDefined();
  });

  it('activeChatThreadId ありなら ChatMessages + ChatInput が出る', () => {
    useCanvasStore.setState({
      loadChatThreads: vi.fn().mockResolvedValue(undefined),
      chatThreadList: [
        { id: 'chat-1', projectId: 'proj-1', title: 't', createdAt: '', updatedAt: '' },
      ],
      activeChatThreadId: 'chat-1',
      chatThreadMessages: [],
    } as never);
    render(<ChatTab />);
    // ChatInput の textarea が見える
    expect(screen.getByRole('textbox')).toBeDefined();
  });

  it('マウント時に loadChatThreads を呼ぶ', () => {
    const loadSpy = vi.fn().mockResolvedValue(undefined);
    useCanvasStore.setState({
      loadChatThreads: loadSpy,
      chatThreadList: [],
      activeChatThreadId: null,
    } as never);
    render(<ChatTab />);
    expect(loadSpy).toHaveBeenCalled();
  });
});
