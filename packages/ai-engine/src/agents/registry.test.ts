import { describe, expect, it } from 'vitest';

import { analyzeImpactAgent } from './analyze-impact';
import { AGENT_REGISTRY } from './registry';

describe('AGENT_REGISTRY', () => {
  it('decompose-to-stories と find-related-code が登録されている', () => {
    expect(AGENT_REGISTRY['decompose-to-stories']).toBeDefined();
    expect(AGENT_REGISTRY['find-related-code']).toBeDefined();
  });

  it('decompose-to-stories の allowedTools に tally の書き込みツールが含まれる', () => {
    const def = AGENT_REGISTRY['decompose-to-stories'];
    expect(def).toBeDefined();
    // def が undefined でないことを上の expect で確認済み
    expect(def?.allowedTools).toContain('mcp__tally__create_node');
    expect(def?.allowedTools).toContain('mcp__tally__create_edge');
  });

  it("'analyze-impact' で analyzeImpactAgent が取れる", () => {
    expect(AGENT_REGISTRY['analyze-impact']).toBe(analyzeImpactAgent);
  });

  it('extract-questions が登録されている', () => {
    expect(AGENT_REGISTRY['extract-questions'].name).toBe('extract-questions');
    expect(AGENT_REGISTRY['extract-questions'].allowedTools).toContain('mcp__tally__create_node');
  });

  it('ingest-document が登録されている', () => {
    expect(AGENT_REGISTRY['ingest-document'].name).toBe('ingest-document');
    expect(AGENT_REGISTRY['ingest-document'].allowedTools).toContain('mcp__tally__create_node');
  });
});
