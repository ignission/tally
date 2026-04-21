import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useCanvasStore } from '@/lib/store';

import { GraphAgentButton, type AnchorNode } from './graph-agent-button';

const anchor: AnchorNode = {
  id: 'uc-1',
  type: 'usecase',
  x: 0,
  y: 0,
  title: '',
  body: '',
};

describe('GraphAgentButton', () => {
  beforeEach(() => {
    useCanvasStore.getState().reset();
  });

  it('何も実行中でなければラベルを出し、クリックで onRun が呼ばれる', () => {
    const onRun = vi.fn().mockResolvedValue(undefined);
    render(
      <GraphAgentButton
        node={anchor}
        agentName="extract-questions"
        label="論点を抽出"
        busyLabel="抽出中…"
        tooltip="hint"
        onRun={onRun}
      />,
    );
    const btn = screen.getByRole('button', { name: /論点を抽出/ });
    expect((btn as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(btn);
    expect(onRun).toHaveBeenCalledWith('uc-1');
  });

  it('同じ agent が実行中なら busyLabel + disabled', () => {
    useCanvasStore.setState({
      runningAgent: { agent: 'extract-questions', inputNodeId: 'uc-1', events: [] },
    } as never);
    const onRun = vi.fn();
    render(
      <GraphAgentButton
        node={anchor}
        agentName="extract-questions"
        label="論点を抽出"
        busyLabel="抽出中…"
        tooltip="hint"
        onRun={onRun}
      />,
    );
    const btn = screen.getByRole('button', { name: /抽出中…/ });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(btn);
    expect(onRun).not.toHaveBeenCalled();
  });

  it('別 agent が実行中ならラベル表示のまま disabled + 別エージェント tooltip', () => {
    useCanvasStore.setState({
      runningAgent: { agent: 'analyze-impact', inputNodeId: 'uc-1', events: [] },
    } as never);
    const onRun = vi.fn();
    render(
      <GraphAgentButton
        node={anchor}
        agentName="extract-questions"
        label="論点を抽出"
        busyLabel="抽出中…"
        tooltip="hint"
        onRun={onRun}
      />,
    );
    const btn = screen.getByRole('button', { name: /論点を抽出/ });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
    expect(btn.getAttribute('title')).toContain('別のエージェント');
  });
});
