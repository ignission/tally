import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useCanvasStore } from '@/lib/store';

import { AgentProgressPanel } from './agent-progress-panel';

describe('AgentProgressPanel', () => {
  it('runningAgent が null なら何も表示しない', () => {
    useCanvasStore.setState({ runningAgent: null } as never);
    const { container } = render(<AgentProgressPanel />);
    expect(container.textContent).toBe('');
  });

  it('thinking イベントを表示する', () => {
    useCanvasStore.setState({
      runningAgent: {
        agent: 'decompose-to-stories',
        inputNodeId: 'uc-1',
        events: [
          { type: 'start', agent: 'decompose-to-stories', input: {} },
          { type: 'thinking', text: '考え中' },
        ],
      },
    } as never);
    render(<AgentProgressPanel />);
    expect(screen.getByText('考え中')).toBeDefined();
  });
});
