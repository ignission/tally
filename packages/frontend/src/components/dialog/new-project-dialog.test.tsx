import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NewProjectDialog } from './new-project-dialog';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

beforeEach(() => {
  push.mockReset();
  global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
    const u = new URL(url, 'http://localhost');
    if (u.pathname === '/api/projects' && init?.method === 'POST') {
      return new Response(JSON.stringify({ id: 'proj-new', projectDir: '/x' }), { status: 201 });
    }
    if (u.pathname === '/api/projects/default-path') {
      const name = u.searchParams.get('name') ?? 'default';
      return new Response(
        JSON.stringify({ path: `/home/you/.local/share/tally/projects/${name.toLowerCase()}` }),
        { status: 200 },
      );
    }
    if (u.pathname === '/api/fs/ls') {
      return new Response(
        JSON.stringify({
          path: u.searchParams.get('path') ?? '/home/you',
          parent: null,
          entries: [
            { name: 'repo1', path: '/home/you/repo1', isHidden: false, hasProjectYaml: false },
          ],
          containsProjectYaml: false,
        }),
        { status: 200 },
      );
    }
    return new Response(null, { status: 404 });
  }) as typeof fetch;
});

describe('NewProjectDialog', () => {
  it('初期状態では作成ボタンが disabled', () => {
    render(<NewProjectDialog open onClose={() => {}} />);
    expect(screen.getByRole('button', { name: /作成/ })).toBeDisabled();
  });

  it('名前と保存先を選ぶと作成可', async () => {
    render(<NewProjectDialog open onClose={() => {}} />);
    await userEvent.type(screen.getByLabelText('プロジェクト名'), '思考ログ');
    // 保存先未指定なので disabled のまま
    expect(screen.getByRole('button', { name: /作成/ })).toBeDisabled();
    // FolderBrowser を開いて選択
    await userEvent.click(screen.getByRole('button', { name: /保存先.*選択|フォルダを選ぶ|フォルダを変更/ }));
    await screen.findByText('repo1');
    await userEvent.click(screen.getByRole('button', { name: '選択' }));
    // 保存先が設定され、作成可能に
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /作成/ })).toBeEnabled(),
    );
  });

  it('作成成功時に /projects/:id へ遷移', async () => {
    render(<NewProjectDialog open onClose={() => {}} />);
    await userEvent.type(screen.getByLabelText('プロジェクト名'), '思考ログ');
    await userEvent.click(screen.getByRole('button', { name: /保存先.*選択|フォルダを選ぶ|フォルダを変更/ }));
    await screen.findByText('repo1');
    await userEvent.click(screen.getByRole('button', { name: '選択' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /作成/ })).toBeEnabled(),
    );
    await userEvent.click(screen.getByRole('button', { name: /作成/ }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/projects/proj-new'));
  });

  it('codebases は 0 件で作成可（初期思考用）', async () => {
    render(<NewProjectDialog open onClose={() => {}} />);
    await userEvent.type(screen.getByLabelText('プロジェクト名'), 'p');
    await userEvent.click(screen.getByRole('button', { name: /保存先.*選択|フォルダを選ぶ|フォルダを変更/ }));
    await screen.findByText('repo1');
    await userEvent.click(screen.getByRole('button', { name: '選択' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /作成/ })).toBeEnabled(),
    );
  });
});
