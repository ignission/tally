import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectImportDialog } from './project-import-dialog';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

beforeEach(() => {
  push.mockReset();
  global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
    const u = new URL(url, 'http://localhost');
    if (u.pathname === '/api/projects/import' && init?.method === 'POST') {
      return new Response(JSON.stringify({ id: 'proj-imp', projectDir: '/x' }), { status: 201 });
    }
    if (u.pathname === '/api/fs/ls') {
      return new Response(
        JSON.stringify({
          path: u.searchParams.get('path') ?? '/home/you',
          parent: null,
          entries: [
            { name: 'existing', path: '/home/you/existing', isHidden: false, hasProjectYaml: true },
            { name: 'other', path: '/home/you/other', isHidden: false, hasProjectYaml: false },
          ],
          // simulate folder-browser behavior: dir自身が project.yaml を含む判定は親経由で container
          containsProjectYaml: u.searchParams.get('path')?.endsWith('existing') ?? false,
        }),
        { status: 200 },
      );
    }
    return new Response(null, { status: 404 });
  }) as typeof fetch;
});

describe('ProjectImportDialog', () => {
  it('open 時に FolderBrowserDialog が表示される', async () => {
    render(<ProjectImportDialog open onClose={() => {}} />);
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    // import-project purpose の title を期待
    expect(screen.getByText(/既存プロジェクト/)).toBeInTheDocument();
  });

  it('project.yaml を含む dir を選ぶとインポートして遷移', async () => {
    render(<ProjectImportDialog open onClose={() => {}} />);
    await screen.findByText('existing');
    // 'existing' に潜る
    await userEvent.click(screen.getByRole('button', { name: /existing/ }));
    // 潜った先は containsProjectYaml: true なので「選択」ボタンが有効化される
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '選択' })).toBeEnabled(),
    );
    await userEvent.click(screen.getByRole('button', { name: '選択' }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/projects/proj-imp'));
  });

  it('キャンセルで onClose', async () => {
    const onClose = vi.fn();
    render(<ProjectImportDialog open onClose={onClose} />);
    await screen.findByText('existing');
    await userEvent.click(screen.getByRole('button', { name: 'キャンセル' }));
    expect(onClose).toHaveBeenCalled();
  });
});
