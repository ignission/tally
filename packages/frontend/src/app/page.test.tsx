import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import Page from './page';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

beforeEach(() => {
  global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
    const u = new URL(url, 'http://localhost');
    if (u.pathname === '/api/projects' && !init?.method) {
      return new Response(
        JSON.stringify({
          projects: [
            {
              id: 'proj-a',
              name: 'A',
              description: null,
              codebases: [],
              projectDir: '/some/a',
              createdAt: '2026-04-21T00:00:00Z',
              updatedAt: '2026-04-21T00:00:00Z',
              lastOpenedAt: '2026-04-21T10:00:00Z',
            },
            {
              id: 'proj-b',
              name: 'B',
              description: 'desc b',
              codebases: [{ id: 'web', label: 'Web', path: '/w' }],
              projectDir: '/some/b',
              createdAt: '2026-04-21T00:00:00Z',
              updatedAt: '2026-04-21T00:00:00Z',
              lastOpenedAt: '2026-04-21T09:00:00Z',
            },
          ],
        }),
        { status: 200 },
      );
    }
    if (u.pathname.endsWith('/unregister') && init?.method === 'POST') {
      return new Response(null, { status: 204 });
    }
    if (u.pathname === '/api/fs/ls') {
      return new Response(
        JSON.stringify({
          path: '/home/you',
          parent: null,
          entries: [],
          containsProjectYaml: false,
        }),
        { status: 200 },
      );
    }
    return new Response(null, { status: 404 });
  }) as typeof fetch;
});

describe('Page (top)', () => {
  it('プロジェクト一覧を表示', async () => {
    render(<Page />);
    expect(await screen.findByText('A')).toBeInTheDocument();
    expect(screen.getByText('B')).toBeInTheDocument();
    expect(screen.getByText('desc b')).toBeInTheDocument();
  });

  it('「+ 新規プロジェクト」ボタンで NewProjectDialog が開く', async () => {
    render(<Page />);
    await userEvent.click(screen.getByRole('button', { name: /\+ 新規プロジェクト/ }));
    expect(await screen.findByRole('heading', { name: /新規プロジェクト/ })).toBeInTheDocument();
  });

  it('「既存を読み込む」ボタンで ProjectImportDialog が開く', async () => {
    render(<Page />);
    await userEvent.click(screen.getByRole('button', { name: /既存を読み込む/ }));
    expect(await screen.findByText(/既存プロジェクト/)).toBeInTheDocument();
  });

  it('「レジストリから外す」を押すと unregister API が呼ばれる', async () => {
    const spy = vi.spyOn(global, 'fetch');
    render(<Page />);
    await screen.findByText('A');
    const unregisterButtons = screen.getAllByRole('button', { name: /レジストリから外す/ });
    await userEvent.click(unregisterButtons[0] as HTMLElement);
    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith(
        expect.stringContaining('/unregister'),
        expect.objectContaining({ method: 'POST' }),
      ),
    );
  });
});
