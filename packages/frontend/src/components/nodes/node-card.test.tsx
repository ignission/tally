import { NODE_META } from '@tally/core';
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { ReactFlowProvider } from '@xyflow/react';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { NodeCard } from './node-card';

// React Flow の Handle は ReactFlowProvider 内でなければ warning を出すため wrap する。
function renderInFlow(el: ReactElement) {
  return render(<ReactFlowProvider>{el}</ReactFlowProvider>);
}

describe('NodeCard アコーディオン', () => {
  it('collapsed=true のとき body と footer を描画しない', () => {
    renderInFlow(
      <NodeCard
        meta={NODE_META.requirement}
        title="要求A"
        body="この要求は重要な……（長い説明）"
        footer={<span>フッタ情報</span>}
        collapsed={true}
        onToggleCollapse={() => {}}
      />,
    );
    expect(screen.getByText('要求A')).toBeInTheDocument();
    expect(screen.queryByText(/この要求は重要な/)).not.toBeInTheDocument();
    expect(screen.queryByText('フッタ情報')).not.toBeInTheDocument();
  });

  it('collapsed=false のとき body と footer を描画する', () => {
    renderInFlow(
      <NodeCard
        meta={NODE_META.requirement}
        title="要求A"
        body="この要求は重要な本文"
        footer={<span>フッタ情報</span>}
        collapsed={false}
        onToggleCollapse={() => {}}
      />,
    );
    expect(screen.getByText('要求A')).toBeInTheDocument();
    expect(screen.getByText('この要求は重要な本文')).toBeInTheDocument();
    expect(screen.getByText('フッタ情報')).toBeInTheDocument();
  });

  it('トグルボタンのクリックで onToggleCollapse が呼ばれ、親への伝播は止まる', async () => {
    const toggle = vi.fn();
    const parentClick = vi.fn();
    const user = userEvent.setup();
    renderInFlow(
      // React Flow のノードは親 div の onClick で選択扱いになるため、
      // トグルボタンのクリックが親に伝播しないことをここで保証する (実挙動と同じ形)。
      // button 要素で親を組む: a11y lint を満たしつつクリック伝播の挙動検証ができる。
      <button type="button" onClick={parentClick}>
        <NodeCard
          meta={NODE_META.requirement}
          title="要求A"
          body="本文"
          collapsed={true}
          onToggleCollapse={toggle}
        />
      </button>,
    );
    await user.click(screen.getByRole('button', { name: '展開' }));
    expect(toggle).toHaveBeenCalledTimes(1);
    expect(parentClick).not.toHaveBeenCalled();
  });

  it('onToggleCollapse 未指定なら トグルボタンは表示されない', () => {
    renderInFlow(
      <NodeCard meta={NODE_META.requirement} title="要求A" body="本文" collapsed={true} />,
    );
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
