import type { ProjectMeta } from '@tally/core';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useCanvasStore } from '@/lib/store';
import { ProjectSettingsDialog } from './project-settings-dialog';

const meta: ProjectMeta = {
  id: 'proj-a',
  name: 'P',
  codebases: [{ id: 'web', label: 'Web', path: '/w' }],
  mcpServers: [],
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
    await userEvent.click(
      screen.getByRole('button', { name: /codebase を追加|コードベースを追加/ }),
    );
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
          codebases: expect.arrayContaining([expect.objectContaining({ path: '/home/you/api' })]),
        }),
      ),
    );
  });

  it('codebase を削除できる', async () => {
    render(<ProjectSettingsDialog open onClose={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: /削除/ }));
    await userEvent.click(screen.getByRole('button', { name: /保存/ }));
    await waitFor(() =>
      expect(patchProjectMeta).toHaveBeenCalledWith(expect.objectContaining({ codebases: [] })),
    );
  });

  it('MCP サーバーを追加できる (Task 17)', async () => {
    render(<ProjectSettingsDialog open onClose={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: /MCP サーバーを追加/ }));
    // 新規追加された MCP server の id 入力欄が現れる (default は atlassian-1)
    const idInput = screen.getByLabelText('mcp-0-id') as HTMLInputElement;
    expect(idInput).toBeInTheDocument();
    expect(idInput.value).toBe('atlassian-1');
    // url / tokenEnvVar を入力
    const urlInput = screen.getByLabelText('mcp-0-url');
    await userEvent.type(urlInput, 'https://x.test/mcp');
    const tokenInput = screen.getByLabelText('mcp-0-tokenEnvVar');
    await userEvent.type(tokenInput, 'JIRA_PAT');

    await userEvent.click(screen.getByRole('button', { name: /保存/ }));
    await waitFor(() =>
      expect(patchProjectMeta).toHaveBeenCalledWith(
        expect.objectContaining({
          mcpServers: [
            expect.objectContaining({
              id: 'atlassian-1',
              kind: 'atlassian',
              url: 'https://x.test/mcp',
              auth: expect.objectContaining({
                type: 'pat',
                scheme: 'bearer',
                tokenEnvVar: 'JIRA_PAT',
              }),
            }),
          ],
        }),
      ),
    );
  });

  it('Basic auth 切替で emailEnvVar 入力欄が現れる (Task 17)', async () => {
    render(<ProjectSettingsDialog open onClose={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: /MCP サーバーを追加/ }));
    // 初期は bearer なので emailEnvVar 欄は無し
    expect(screen.queryByLabelText('mcp-0-emailEnvVar')).toBeNull();
    // basic に切替
    const schemeSelect = screen.getByLabelText('mcp-0-scheme') as HTMLSelectElement;
    await userEvent.selectOptions(schemeSelect, 'basic');
    // emailEnvVar 欄が現れる
    expect(screen.getByLabelText('mcp-0-emailEnvVar')).toBeInTheDocument();
  });

  it('MCP サーバーを削除できる (Task 17)', async () => {
    render(<ProjectSettingsDialog open onClose={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: /MCP サーバーを追加/ }));
    // 追加直後 1 件
    expect(screen.getByLabelText('mcp-0-id')).toBeInTheDocument();
    // MCP セクションの削除 button (codebase の削除と区別するため scope で取る)
    // codebase 削除 + MCP 削除の 2 つ「削除」button があるので getAllByRole で取って最後を click
    const removeButtons = screen.getAllByRole('button', { name: /削除/ });
    // 最後の削除 button = MCP のもの (codebase は 1 件目で追加 = 0 番目)
    await userEvent.click(removeButtons[removeButtons.length - 1] as HTMLElement);
    expect(screen.queryByLabelText('mcp-0-id')).toBeNull();
  });

  // 旧実装は `mcpServers.length + 1` で id 採番していたため、削除→追加で
  // 既存 id と衝突して下流の React key も衝突していた。未使用 suffix を探索する
  // ように修正済み (Task 17 fix)。
  it('addMcpServer: 削除→追加で id が既存と衝突しない', async () => {
    render(<ProjectSettingsDialog open onClose={() => {}} />);
    const addBtn = () => screen.getByRole('button', { name: /MCP サーバーを追加/ });
    await userEvent.click(addBtn()); // atlassian-1
    await userEvent.click(addBtn()); // atlassian-2
    expect((screen.getByLabelText('mcp-0-id') as HTMLInputElement).value).toBe('atlassian-1');
    expect((screen.getByLabelText('mcp-1-id') as HTMLInputElement).value).toBe('atlassian-2');
    // 1 件目 (mcp-0) を削除 → 残るのは元 mcp-1 だが index は 0 にスライド
    const removeButtons = screen.getAllByRole('button', { name: /削除/ });
    // codebase 削除 (0) + MCP 2 件分 削除 (1, 2) → MCP 削除は最後 2 つ。1 件目 MCP を削除。
    await userEvent.click(removeButtons[removeButtons.length - 2] as HTMLElement);
    expect((screen.getByLabelText('mcp-0-id') as HTMLInputElement).value).toBe('atlassian-2');
    // 再度追加 → 旧実装は length+1=2 で `atlassian-2` 衝突。修正後は `atlassian-1`。
    await userEvent.click(addBtn());
    const ids = [
      (screen.getByLabelText('mcp-0-id') as HTMLInputElement).value,
      (screen.getByLabelText('mcp-1-id') as HTMLInputElement).value,
    ];
    expect(new Set(ids).size).toBe(2); // 衝突なし
    expect(ids).toContain('atlassian-1');
    expect(ids).toContain('atlassian-2');
  });

  it('secret 値の入力欄は無い (envVar 名のみ。caption に .env への誘導)', () => {
    render(<ProjectSettingsDialog open onClose={() => {}} />);
    // secret / token / pat / api_token / password 系の入力欄が無いこと
    expect(screen.queryByLabelText(/PAT$/i)).toBeNull();
    expect(screen.queryByLabelText(/シークレット/i)).toBeNull();
    expect(screen.queryByLabelText(/api_token$/i)).toBeNull();
    expect(screen.queryByLabelText(/password/i)).toBeNull();
    // .env への誘導文言
    expect(screen.getByText(/\.env/)).toBeInTheDocument();
  });

  it('id 重複時は保存 disabled', async () => {
    render(<ProjectSettingsDialog open onClose={() => {}} />);
    // まず 2 件目を追加
    await userEvent.click(
      screen.getByRole('button', { name: /codebase を追加|コードベースを追加/ }),
    );
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
