import path from 'node:path';

// プロジェクトディレクトリ直下の各 path を集約。.tally/ サブディレクトリは挟まない。
export interface ProjectPaths {
  root: string;
  projectFile: string;
  nodesDir: string;
  edgesDir: string;
  edgesFile: string;
  chatsDir: string;
}

export function resolveProjectPaths(projectDir: string): ProjectPaths {
  const root = path.resolve(projectDir);
  return {
    root,
    projectFile: path.join(root, 'project.yaml'),
    nodesDir: path.join(root, 'nodes'),
    edgesDir: path.join(root, 'edges'),
    edgesFile: path.join(root, 'edges', 'edges.yaml'),
    chatsDir: path.join(root, 'chats'),
  };
}

export function nodeFileName(id: string): string {
  return `${id}.yaml`;
}

export function chatFileName(threadId: string): string {
  return `${threadId}.yaml`;
}
