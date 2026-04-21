import path from 'node:path';

// 1 プロジェクト = 1 リポジトリ前提。.tally/ 配下のパス解決をここに集約する。
// workspaceRoot は「どのディレクトリを .tally/ の親として扱うか」。
export interface TallyPaths {
  root: string;
  projectFile: string;
  nodesDir: string;
  edgesDir: string;
  edgesFile: string;
  chatsDir: string;
}

export function resolveTallyPaths(workspaceRoot: string): TallyPaths {
  const root = path.resolve(workspaceRoot, '.tally');
  return {
    root,
    projectFile: path.join(root, 'project.yaml'),
    nodesDir: path.join(root, 'nodes'),
    edgesDir: path.join(root, 'edges'),
    edgesFile: path.join(root, 'edges', 'edges.yaml'),
    chatsDir: path.join(root, 'chats'),
  };
}

// ノードのファイル名は `<id>.yaml`。
// id に型プレフィックス (req- / q- / ...) が含まれることを前提にしている (ADR-0003)。
export function nodeFileName(id: string): string {
  return `${id}.yaml`;
}

// チャットスレッドのファイル名は `<thread-id>.yaml`。
// threadId は `chat-` プレフィックスを含む想定。
export function chatFileName(threadId: string): string {
  return `${threadId}.yaml`;
}
