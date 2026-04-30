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

  it('source=external の tool_use は承認 / 却下ボタンを表示しない (Task 18)', () => {
    useCanvasStore.setState({ approveChatTool: vi.fn() } as never);
    render(
      <ToolApprovalCard
        block={{
          type: 'tool_use',
          toolUseId: 'tool-ext',
          name: 'mcp__atlassian__jira_get_issue',
          input: { issueKey: 'EPIC-1' },
          source: 'external',
        }}
      />,
    );
    expect(screen.queryByRole('button', { name: /^承認$/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^却下$/ })).toBeNull();
    // 外部ソース表示は AI が読んだ tool 名を含む
    expect(screen.getByText(/外部ソース/)).toBeInTheDocument();
    expect(screen.getByText(/atlassian: jira_get_issue/)).toBeInTheDocument();
  });

  it('source=external は折り畳み (details) で input を隠す (Task 18)', () => {
    useCanvasStore.setState({ approveChatTool: vi.fn() } as never);
    const { container } = render(
      <ToolApprovalCard
        block={{
          type: 'tool_use',
          toolUseId: 'tool-ext-2',
          name: 'mcp__atlassian__jira_search',
          input: { jql: 'project = TALLY' },
          source: 'external',
        }}
      />,
    );
    // <details> 要素が存在し、その内側に input preview の <pre> が含まれていること。
    // details が存在するだけだと「input が details の外に出ている」誤実装を取り逃すため
    // 親子関係まで確認する。
    const details = container.querySelector('details');
    expect(details).not.toBeNull();
    expect(details?.querySelector('pre')).not.toBeNull();
  });
});
