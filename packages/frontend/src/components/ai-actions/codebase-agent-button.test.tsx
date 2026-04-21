import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useCanvasStore } from '@/lib/store';

import { CodebaseAgentButton } from './codebase-agent-button';

const anchor = { id: 'uc-1', type: 'usecase' as const, x: 0, y: 0, title: 't', body: 'b' };

function hydrate(codebasePath?: string, running = false) {
  useCanvasStore.getState().hydrate({
    id: 'proj-1',
    name: 'P',
    ...(codebasePath !== undefined ? { codebasePath } : {}),
    createdAt: '2026-04-18T00:00:00Z',
    updatedAt: '2026-04-18T00:00:00Z',
    nodes: [anchor],
    edges: [],
  });
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

  it('codebasePath 未設定なら disabled で警告 tooltip', () => {
    hydrate(undefined, false);
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
    expect(btn.getAttribute('title')).toContain('codebasePath');
  });

  it('runningAgent が非 null なら disabled', () => {
    hydrate('../backend', true);
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

  it('click で onRun(nodeId) が呼ばれる', () => {
    hydrate('../backend', false);
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
    expect(onRun).toHaveBeenCalledWith('uc-1');
  });

  it('通常時は tooltip が渡された値', () => {
    hydrate('../backend', false);
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
