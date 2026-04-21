import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { FileSystemProjectStore } from './project-store';

// examples/sample-project/.tally/ を実ストアとして読み込めることを検証する。
// Phase 2 で UI がこの YAML を表示するため、Phase 1 の時点で読み込みの互換性を担保しておく。
const here = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE_ROOT = path.resolve(here, '../../../examples/sample-project');

describe('examples/sample-project の読み込み', () => {
  const store = new FileSystemProjectStore(SAMPLE_ROOT);

  it('project.yaml を読める', async () => {
    const meta = await store.getProjectMeta();
    expect(meta?.id).toBe('taskflow-invite');
    expect(meta?.name).toContain('招待');
  });

  it('7 ノード型すべてを Node 型として読める', async () => {
    const nodes = await store.listNodes();
    const byType = (t: string) => nodes.filter((n) => n.type === t);
    expect(byType('requirement')).toHaveLength(3);
    expect(byType('question')).toHaveLength(3);
    expect(byType('usecase')).toHaveLength(2);
    expect(byType('coderef')).toHaveLength(4);
    expect(byType('issue')).toHaveLength(1);
    expect(byType('proposal')).toHaveLength(2);
  });

  it('論点ノードはすべて未決定 (decision: null) で読める', async () => {
    const questions = await store.findNodesByType('question');
    for (const q of questions) {
      expect(q.decision).toBeNull();
      expect(q.options?.length ?? 0).toBeGreaterThan(0);
    }
  });

  it('loadProject でプロジェクト全体を一括ロードできる', async () => {
    const project = await store.loadProject();
    expect(project).not.toBeNull();
    // 3 req + 3 question + 2 usecase + 4 coderef + 1 issue + 2 proposal = 15
    expect(project?.nodes.length).toBe(15);
    // Phase 2 で補完したエッジは 11 本。
    expect(project?.edges.length).toBe(11);
  });

  it('読み込んだ全エッジが SysML 準拠のいずれかの type を持つ', async () => {
    const project = await store.loadProject();
    const validTypes = new Set(['satisfy', 'contain', 'derive', 'refine', 'verify', 'trace']);
    for (const edge of project?.edges ?? []) {
      expect(validTypes.has(edge.type)).toBe(true);
    }
  });
});
