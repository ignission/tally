import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useCanvasStore } from '@/lib/store';

import { ToolApprovalCard } from './tool-approval-card';

describe('ToolApprovalCard', () => {
  beforeEach(() => {
    useCanvasStore.getState().reset();
  });

  it('承認クリックで approveChatTool(true) を呼ぶ', () => {
    const spy = vi.fn();
    useCanvasStore.setState({ approveChatTool: spy } as never);
    render(
      <ToolApprovalCard
        block={{
          type: 'tool_use',
          toolUseId: 'tool-abc',
          name: 'mcp__tally__create_node',
          input: { adoptAs: 'requirement', title: 'X', body: '' },
          source: 'internal',
          approval: 'pending',
        }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /^承認$/ }));
    expect(spy).toHaveBeenCalledWith('tool-abc', true);
  });

  it('却下クリックで approveChatTool(false) を呼ぶ', () => {
    const spy = vi.fn();
    useCanvasStore.setState({ approveChatTool: spy } as never);
    render(
      <ToolApprovalCard
        block={{
          type: 'tool_use',
          toolUseId: 'tool-xyz',
          name: 'mcp__tally__create_edge',
          input: { from: 'a', to: 'b', type: 'derive' },
          source: 'internal',
          approval: 'pending',
        }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /^却下$/ }));
    expect(spy).toHaveBeenCalledWith('tool-xyz', false);
  });

  it('tool 名から mcp__tally__ プレフィックスを剥いで表示', () => {
    useCanvasStore.setState({ approveChatTool: vi.fn() } as never);
    render(
      <ToolApprovalCard
        block={{
          type: 'tool_use',
          toolUseId: 'tool-1',
          name: 'mcp__tally__create_node',
          input: {},
          source: 'internal',
          approval: 'pending',
        }}
      />,
    );
    expect(screen.getByText(/^create_node$/)).toBeDefined();
  });
});
