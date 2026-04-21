import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

import type { Project, ProjectMeta } from '@tally/core';

import { FileSystemProjectStore } from './project-store';

const execFileAsync = promisify(execFile);

export interface ProjectHandle {
  id: string;
  workspaceRoot: string; // .tally/ の親ディレクトリ
  meta: ProjectMeta;
}

interface ResolveOptions {
  /** 明示指定があれば ghq 無しで使う (開発時の固定 workspace)。 */
  tallyWorkspace?: string | undefined;
}

// 優先順位:
// 1. TALLY_WORKSPACE env で指定された単一または親ディレクトリ
// 2. ghq list -p で列挙された全リポジトリから .tally/ を持つものを収集
// ghq が無い環境では 1 のみが候補になる。どちらも無ければ空配列。
export async function discoverProjects(opts: ResolveOptions = {}): Promise<ProjectHandle[]> {
  const tallyWorkspace = opts.tallyWorkspace ?? process.env.TALLY_WORKSPACE;
  const roots = new Set<string>();

  if (tallyWorkspace) {
    const absolute = path.resolve(tallyWorkspace);
    for (const dir of await findTallyRootsUnder(absolute)) {
      roots.add(dir);
    }
  }

  for (const repoRoot of await listGhqRoots()) {
    if (await hasTallyDir(repoRoot)) roots.add(repoRoot);
  }

  const handles = await Promise.all(
    Array.from(roots).map(async (root) => {
      try {
        const store = new FileSystemProjectStore(root);
        const meta = await store.getProjectMeta();
        if (!meta) return null;
        return { id: meta.id, workspaceRoot: root, meta } satisfies ProjectHandle;
      } catch {
        // 壊れた YAML は一覧から除外する (エラーは個別ページで再現される)。
        return null;
      }
    }),
  );

  return handles
    .filter((h): h is ProjectHandle => h !== null)
    .sort((a, b) => a.meta.name.localeCompare(b.meta.name, 'ja'));
}

export async function resolveProjectById(
  id: string,
  opts: ResolveOptions = {},
): Promise<ProjectHandle | null> {
  const all = await discoverProjects(opts);
  return all.find((h) => h.id === id) ?? null;
}

export async function loadProjectById(
  id: string,
  opts: ResolveOptions = {},
): Promise<Project | null> {
  const handle = await resolveProjectById(id, opts);
  if (!handle) return null;
  const store = new FileSystemProjectStore(handle.workspaceRoot);
  return store.loadProject();
}

export interface WorkspaceCandidate {
  path: string;
  hasTally: boolean;
}

// 新規プロジェクト作成時に候補として出すディレクトリ一覧。
// TALLY_WORKSPACE (自身 + 直下) + ghq 管理下の全リポジトリ。
// hasTally フラグで既に Tally 化されているかを区別し、UI は未初期化のものを主候補として出す。
export async function listWorkspaceCandidates(
  opts: ResolveOptions = {},
): Promise<WorkspaceCandidate[]> {
  const tallyWorkspace = opts.tallyWorkspace ?? process.env.TALLY_WORKSPACE;
  const roots = new Set<string>();

  if (tallyWorkspace) {
    const absolute = path.resolve(tallyWorkspace);
    // 自身
    try {
      const st = await fs.stat(absolute);
      if (st.isDirectory()) roots.add(absolute);
    } catch {
      /* ignore */
    }
    // 直下
    try {
      const names = await fs.readdir(absolute);
      await Promise.all(
        names.map(async (name) => {
          if (name.startsWith('.')) return; // 隠しフォルダはスキップ
          const child = path.join(absolute, name);
          try {
            const st = await fs.stat(child);
            if (st.isDirectory()) roots.add(child);
          } catch {
            /* 壊れたリンク等は無視 */
          }
        }),
      );
    } catch {
      /* readdir 失敗も無視 */
    }
  }

  for (const repoRoot of await listGhqRoots()) {
    roots.add(repoRoot);
  }

  const candidates = await Promise.all(
    Array.from(roots).map(async (p) => ({
      path: p,
      hasTally: await hasTallyDir(p),
    })),
  );
  // 未初期化を先頭、アルファベット順で安定ソート
  candidates.sort((a, b) => {
    if (a.hasTally !== b.hasTally) return a.hasTally ? 1 : -1;
    return a.path.localeCompare(b.path);
  });
  return candidates;
}

// ---------------------------------------------------------------------------
// 内部ヘルパ
// ---------------------------------------------------------------------------

async function hasTallyDir(dir: string): Promise<boolean> {
  try {
    const stat = await fs.stat(path.join(dir, '.tally'));
    return stat.isDirectory();
  } catch {
    return false;
  }
}

// 指定ディレクトリが自身に .tally を持っていればそこを採用、
// 無ければ 1 階層下まで走査する (examples/ のように親が束ねるケース)。
async function findTallyRootsUnder(dir: string): Promise<string[]> {
  const out: string[] = [];
  if (await hasTallyDir(dir)) {
    out.push(dir);
    return out;
  }
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    return out;
  }
  await Promise.all(
    names.map(async (name) => {
      const child = path.join(dir, name);
      try {
        const stat = await fs.stat(child);
        if (!stat.isDirectory()) return;
        if (await hasTallyDir(child)) out.push(child);
      } catch {
        // 壊れたシンボリックリンクなどは無視。
      }
    }),
  );
  return out;
}

async function listGhqRoots(): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync('ghq', ['list', '-p'], { timeout: 5000 });
    return stdout
      .split('\n')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  } catch {
    // ghq 未インストール or 失敗時は黙って空配列にフォールバック。
    return [];
  }
}
