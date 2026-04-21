import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectMeta } from '@tally/core';

import { ProjectSettingsDialog } from './project-settings-dialog';
import { useCanvasStore } from '@/lib/store';

const meta: ProjectMeta = {
  id: 'proj-a',
  name: 'P',
  codebases: [{ id: 'web', label: 'Web', path: '/w' }],
  createdAt: '2026-04-21T00:00:00Z',
  updatedAt: '2026-04-21T00:00:00Z',
};

const patchProjectMeta = vi.fn().mockResolvedValue(undefined);

beforeEach(() => {
  patchProjectMeta.mockReset();
  patchProjectMeta.mockResolvedValue(undefined);
  useCanvasStore.setState({
    projectMeta: meta,
    patchProjectMeta,
  } as Partial<ReturnType<typeof useCanvasStore.getState>>);
  // fetch の実装: パスパラメータに応じてレスポンスを切り替え
  global.fetch = vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/home/you/api') || url.includes('path=%2Fhome%2Fyou%2Fapi')) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            path: '/home/you/api',
            parent: '/home/you',
            entries: [],
            containsProjectYaml: false,
          }),
          { status: 200 },
        ),
      );
    }
    return Promise.resolve(
      new Response(
        JSON.stringify({
          path: '/home/you',
          parent: null,
          entries: [{ name: 'api', path: '/home/you/api', isHidden: false, hasProjectYaml: false }],
          containsProjectYaml: false,
        }),
        { status: 200 },
      ),
    );
  }) as typeof fetch;
});

describe('ProjectSettingsDialog', () => {
  it('既存 codebases を表示', () => {
    render(<ProjectSettingsDialog open onClose={() => {}} />);
    expect(screen.getByDisplayValue('web')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Web')).toBeInTheDocument();
  });

  it('codebase を追加できる', async () => {
    render(<ProjectSettingsDialog open onClose={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: /codebase を追加|コードベースを追加/ }));
    // FolderBrowserDialog が /home/you を表示するまで待つ
    await screen.findByText('api');
    // api フォルダに入る（load('/home/you/api') が走る）
    await userEvent.click(screen.getByRole('button', { name: /api/ }));
    // パス入力欄が /home/you/api に更新されるまで待つ
    await screen.findByDisplayValue('/home/you/api');
    await userEvent.click(screen.getByRole('button', { name: '選択' }));
    // 保存ボタン押下
    await userEvent.click(screen.getByRole('button', { name: /保存/ }));
    await waitFor(() =>
      expect(patchProjectMeta).toHaveBeenCalledWith(
        expect.objectContaining({
          codebases: expect.arrayContaining([
            expect.objectContaining({ path: '/home/you/api' }),
          ]),
        }),
      ),
    );
  });

  it('codebase を削除できる', async () => {
    render(<ProjectSettingsDialog open onClose={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: /削除/ }));
    await userEvent.click(screen.getByRole('button', { name: /保存/ }));
    await waitFor(() =>
      expect(patchProjectMeta).toHaveBeenCalledWith(
        expect.objectContaining({ codebases: [] }),
      ),
    );
  });

  it('id 重複時は保存 disabled', async () => {
    render(<ProjectSettingsDialog open onClose={() => {}} />);
    // まず 2 件目を追加
    await userEvent.click(screen.getByRole('button', { name: /codebase を追加|コードベースを追加/ }));
    await screen.findByText('api');
    await userEvent.click(screen.getByRole('button', { name: /api/ }));
    await screen.findByDisplayValue('/home/you/api');
    await userEvent.click(screen.getByRole('button', { name: '選択' }));
    // 2 件目の id を 'web' (既存と衝突) に変更
    const idInputs = screen.getAllByLabelText(/codebase-.*-id/);
    await userEvent.clear(idInputs[1] as HTMLInputElement);
    await userEvent.type(idInputs[1] as HTMLInputElement, 'web');
    expect(screen.getByRole('button', { name: /保存/ })).toBeDisabled();
  });
});
