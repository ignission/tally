import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useCanvasStore } from '@/lib/store';

import { ProjectSettingsDialog } from './project-settings-dialog';

function hydrateStore(codebasePath?: string) {
  useCanvasStore.getState().hydrate({
    id: 'proj-1',
    name: 'P',
    ...(codebasePath !== undefined ? { codebasePath } : {}),
    createdAt: '2026-04-18T00:00:00Z',
    updatedAt: '2026-04-18T00:00:00Z',
    nodes: [],
    edges: [],
  });
}

describe('ProjectSettingsDialog', () => {
  it('open=false のときは何も描画しない', () => {
    hydrateStore('../old');
    render(<ProjectSettingsDialog open={false} onClose={() => {}} />);
    expect(screen.queryByText(/プロジェクト設定/)).toBeNull();
  });

  it('open=true で codebasePath を初期値として入力欄に表示する', () => {
    hydrateStore('../backend');
    render(<ProjectSettingsDialog open={true} onClose={() => {}} />);
    const input = screen.getByLabelText(/codebasePath/i) as HTMLInputElement;
    expect(input.value).toBe('../backend');
  });

  it('保存ボタンで patchProjectMeta が呼ばれ onClose が実行される', async () => {
    hydrateStore('');
    const patchProjectMeta = vi.fn(async () => {});
    useCanvasStore.setState({ patchProjectMeta } as never);
    const onClose = vi.fn();
    render(<ProjectSettingsDialog open={true} onClose={onClose} />);
    const input = screen.getByLabelText(/codebasePath/i);
    fireEvent.change(input, { target: { value: '../backend' } });
    fireEvent.click(screen.getByRole('button', { name: /保存/ }));
    await waitFor(() => {
      expect(patchProjectMeta).toHaveBeenCalledWith({
        codebasePath: '../backend',
        additionalCodebasePaths: [],
      });
      expect(onClose).toHaveBeenCalled();
    });
  });

  it('空入力で保存すると codebasePath: null が送られる (削除)', async () => {
    hydrateStore('../old');
    const patchProjectMeta = vi.fn(async () => {});
    useCanvasStore.setState({ patchProjectMeta } as never);
    render(<ProjectSettingsDialog open={true} onClose={() => {}} />);
    const input = screen.getByLabelText(/codebasePath/i);
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: /保存/ }));
    await waitFor(() => {
      expect(patchProjectMeta).toHaveBeenCalledWith({
        codebasePath: null,
        additionalCodebasePaths: [],
      });
    });
  });

  it('キャンセルボタンで onClose が呼ばれ patchProjectMeta は呼ばれない', () => {
    hydrateStore('../old');
    const patchProjectMeta = vi.fn(async () => {});
    useCanvasStore.setState({ patchProjectMeta } as never);
    const onClose = vi.fn();
    render(<ProjectSettingsDialog open={true} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /キャンセル/ }));
    expect(onClose).toHaveBeenCalled();
    expect(patchProjectMeta).not.toHaveBeenCalled();
  });
});
