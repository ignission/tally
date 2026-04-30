import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useCanvasStore } from '@/lib/store';

import { CodebaseAgentButton } from './codebase-agent-button';

const anchor = { id: 'uc-1', type: 'usecase' as const, x: 0, y: 0, title: 't', body: 'b' };

const baseMeta = {
  id: 'proj-1',
  name: 'P',
  codebases: [] as { id: string; label: string; path: string }[],
  mcpServers: [],
  createdAt: '2026-04-18T00:00:00Z',
  updatedAt: '2026-04-18T00:00:00Z',
  nodes: [anchor],
  edges: [],
};

function hydrate(codebases: { id: string; label: string; path: string }[], running = false) {
  useCanvasStore.getState().hydrate({ ...baseMeta, codebases });
  if (running) {
    useCanvasStore.setState({
      runningAgent: { agent: 'find-related-code', inputNodeId: 'uc-1', events: [] },
    } as never);
  }
}

describe('CodebaseAgentButton', () => {
  beforeEach(() => {
    useCanvasStore.getState().reset();
  });

  it('codebases が 0 件なら disabled で tooltip', () => {
    hydrate([]);
    render(
      <CodebaseAgentButton
        agentName="find-related-code"
        node={anchor}
        label="テスト"
        busyLabel="実行中"
        tooltip="ふつう"
        onRun={vi.fn()}
      />,
    );
    const btn = screen.getByRole('button') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.getAttribute('title')).toBe('コードベースを追加してください');
  });

  it('codebases が 1 件なら enabled で select を表示しない', () => {
    hydrate([{ id: 'w', label: 'Web', path: '/w' }]);
    render(
      <CodebaseAgentButton
        agentName="find-related-code"
        node={anchor}
        label="テスト"
        busyLabel="実行中"
        tooltip="x"
        onRun={vi.fn()}
      />,
    );
    expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByLabelText('対象コードベース')).not.toBeInTheDocument();
  });

  it('codebases が 2 件以上なら select が表示される', () => {
    hydrate([
      { id: 'web', label: 'Web', path: '/w' },
      { id: 'api', label: 'API', path: '/a' },
    ]);
    render(
      <CodebaseAgentButton
        agentName="find-related-code"
        node={anchor}
        label="テスト"
        busyLabel="実行中"
        tooltip="x"
        onRun={vi.fn()}
      />,
    );
    expect(screen.getByLabelText('対象コードベース')).toBeInTheDocument();
  });

  it('runningAgent が非 null なら disabled', () => {
    hydrate([{ id: 'w', label: 'Web', path: '/w' }], true);
    render(
      <CodebaseAgentButton
        agentName="find-related-code"
        node={anchor}
        label="テスト"
        busyLabel="実行中"
        tooltip="x"
        onRun={vi.fn()}
      />,
    );
    expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(true);
  });

  it('click で onRun(nodeId, codebaseId) が呼ばれる', () => {
    hydrate([{ id: 'w', label: 'Web', path: '/w' }]);
    const onRun = vi.fn().mockResolvedValue(undefined);
    render(
      <CodebaseAgentButton
        agentName="find-related-code"
        node={anchor}
        label="テスト"
        busyLabel="実行中"
        tooltip="x"
        onRun={onRun}
      />,
    );
    fireEvent.click(screen.getByRole('button'));
    expect(onRun).toHaveBeenCalledWith('uc-1', 'w');
  });

  it('通常時は tooltip が渡された値', () => {
    hydrate([{ id: 'w', label: 'Web', path: '/w' }]);
    render(
      <CodebaseAgentButton
        agentName="find-related-code"
        node={anchor}
        label="テスト"
        busyLabel="実行中"
        tooltip="カスタム文言"
        onRun={vi.fn()}
      />,
    );
    expect(screen.getByRole('button').getAttribute('title')).toBe('カスタム文言');
  });
});
