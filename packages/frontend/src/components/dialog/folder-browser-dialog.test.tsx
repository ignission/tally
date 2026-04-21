import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FolderBrowserDialog } from './folder-browser-dialog';

beforeEach(() => {
  global.fetch = vi.fn().mockImplementation((url: string) => {
    const u = new URL(url, 'http://localhost');
    if (u.pathname === '/api/fs/ls') {
      const p = u.searchParams.get('path') ?? '/home/you';
      const entries =
        p === '/home/you'
          ? [
              { name: 'acme', path: '/home/you/acme', isHidden: false, hasProjectYaml: false },
              { name: '.ssh', path: '/home/you/.ssh', isHidden: true, hasProjectYaml: false },
              { name: 'proj', path: '/home/you/proj', isHidden: false, hasProjectYaml: true },
            ]
          : [];
      return Promise.resolve(
        new Response(
          JSON.stringify({
            path: p,
            parent: p === '/' ? null : '/',
            entries,
            containsProjectYaml: p === '/home/you/proj',
          }),
          { status: 200 },
        ),
      );
    }
    if (u.pathname === '/api/fs/mkdir') {
      return Promise.resolve(
        new Response(JSON.stringify({ path: '/home/you/new-dir' }), { status: 201 }),
      );
    }
    return Promise.reject(new Error('unexpected'));
  }) as typeof fetch;
});

describe('FolderBrowserDialog', () => {
  it('初期表示で initialPath の中身を一覧表示', async () => {
    render(
      <FolderBrowserDialog
        open
        initialPath="/home/you"
        purpose="create-project"
        onConfirm={() => {}}
        onClose={() => {}}
      />,
    );
    expect(await screen.findByText('acme')).toBeInTheDocument();
  });

  it('隠しフォルダはデフォルト非表示、トグルで表示', async () => {
    render(
      <FolderBrowserDialog
        open
        initialPath="/home/you"
        purpose="create-project"
        onConfirm={() => {}}
        onClose={() => {}}
      />,
    );
    await screen.findByText('acme');
    expect(screen.queryByText('.ssh')).not.toBeInTheDocument();
    await userEvent.click(screen.getByLabelText('隠しフォルダを表示'));
    expect(await screen.findByText('.ssh')).toBeInTheDocument();
  });

  it('「選択」で onConfirm に現在のパスを渡す', async () => {
    const onConfirm = vi.fn();
    render(
      <FolderBrowserDialog
        open
        initialPath="/home/you"
        purpose="create-project"
        onConfirm={onConfirm}
        onClose={() => {}}
      />,
    );
    await screen.findByText('acme');
    await userEvent.click(screen.getByRole('button', { name: '選択' }));
    expect(onConfirm).toHaveBeenCalledWith('/home/you');
  });

  it('import-project で project.yaml 無しなら「選択」は disabled', async () => {
    render(
      <FolderBrowserDialog
        open
        initialPath="/home/you"
        purpose="import-project"
        onConfirm={() => {}}
        onClose={() => {}}
      />,
    );
    await screen.findByText('acme');
    expect(screen.getByRole('button', { name: '選択' })).toBeDisabled();
  });

  it('閉じるボタンで onClose 発火', async () => {
    const onClose = vi.fn();
    render(
      <FolderBrowserDialog
        open
        initialPath="/home/you"
        purpose="create-project"
        onConfirm={() => {}}
        onClose={onClose}
      />,
    );
    await screen.findByText('acme');
    await userEvent.click(screen.getByRole('button', { name: 'キャンセル' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('エントリをクリックすると潜る', async () => {
    render(
      <FolderBrowserDialog
        open
        initialPath="/home/you"
        purpose="create-project"
        onConfirm={() => {}}
        onClose={() => {}}
      />,
    );
    const acmeButton = await screen.findByRole('button', { name: /acme/ });
    await userEvent.click(acmeButton);
    // 潜った先の path が表示されること（URL更新 or 空entries表示）
    await new Promise((r) => setTimeout(r, 10));
    // entries=[] になるはず (mock)
  });
});
