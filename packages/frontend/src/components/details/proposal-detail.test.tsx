import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useCanvasStore } from '@/lib/store';

import { ProposalDetail } from './proposal-detail';

describe('ProposalDetail', () => {
  it('採用ボタン押下で adoptProposal が呼ばれる', async () => {
    const adoptProposal = vi.fn(async () => ({
      id: 'prop-1',
      type: 'userstory',
      x: 0,
      y: 0,
      title: '採用済み',
      body: '',
    }));
    useCanvasStore.setState({ adoptProposal } as never);
    render(
      <ProposalDetail
        node={{
          id: 'prop-1',
          type: 'proposal',
          x: 0,
          y: 0,
          title: '[AI] ...',
          body: '',
          adoptAs: 'userstory',
        }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /採用/ }));
    await Promise.resolve();
    expect(adoptProposal).toHaveBeenCalledWith('prop-1', 'userstory', undefined);
  });

  it('adoptAs が "proposal" の場合はフォールバックで userstory を初期選択', () => {
    const adoptProposal = vi.fn(async () => ({
      id: 'prop-1',
      type: 'userstory',
      x: 0,
      y: 0,
      title: '',
      body: '',
    }));
    useCanvasStore.setState({ adoptProposal } as never);
    render(
      <ProposalDetail
        node={{
          id: 'prop-1',
          type: 'proposal',
          x: 0,
          y: 0,
          title: '[AI] ...',
          body: '',
          // スキーマ上は 'proposal' も許されるが UI ではフォールバックする。
          adoptAs: 'proposal',
        }}
      />,
    );
    const select = screen.getByLabelText(/採用先/) as HTMLSelectElement;
    expect(select.value).toBe('userstory');
  });

  it('coderef adopt 時に proposal 固有属性 (filePath 等) が additional として渡る', async () => {
    const adoptProposal = vi.fn(async () => ({
      id: 'prop-1',
      type: 'coderef',
      x: 0,
      y: 0,
      title: 'src/invite.ts:10',
      body: '',
      filePath: 'src/invite.ts',
    }));
    useCanvasStore.setState({ adoptProposal } as never);
    render(
      <ProposalDetail
        node={
          {
            id: 'prop-1',
            type: 'proposal',
            x: 0,
            y: 0,
            title: '[AI] src/invite.ts:10',
            body: '',
            adoptAs: 'coderef',
            filePath: 'src/invite.ts',
            startLine: 10,
            endLine: 20,
          } as never
        }
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /採用/ }));
    await Promise.resolve();
    expect(adoptProposal).toHaveBeenCalledWith('prop-1', 'coderef', {
      filePath: 'src/invite.ts',
      startLine: 10,
      endLine: 20,
    });
  });

  it('セレクタで adoptAs を変更できる', async () => {
    const adoptProposal = vi.fn(async () => ({
      id: 'prop-1',
      type: 'requirement',
      x: 0,
      y: 0,
      title: '',
      body: '',
    }));
    useCanvasStore.setState({ adoptProposal } as never);
    render(
      <ProposalDetail
        node={{
          id: 'prop-1',
          type: 'proposal',
          x: 0,
          y: 0,
          title: '[AI] ...',
          body: '',
          adoptAs: 'userstory',
        }}
      />,
    );
    fireEvent.change(screen.getByLabelText(/採用先/), { target: { value: 'requirement' } });
    fireEvent.click(screen.getByRole('button', { name: /採用/ }));
    await Promise.resolve();
    expect(adoptProposal).toHaveBeenCalledWith('prop-1', 'requirement', undefined);
  });
});
