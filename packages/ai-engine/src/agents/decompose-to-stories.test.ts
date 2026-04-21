import { describe, expect, it } from 'vitest';

import { buildDecomposePrompt } from './decompose-to-stories';

describe('buildDecomposePrompt', () => {
  it('UC の title/body とノード ID をプロンプトに含める', () => {
    const p = buildDecomposePrompt({
      ucNode: {
        id: 'uc-1',
        type: 'usecase',
        x: 0,
        y: 0,
        title: '招待を送る',
        body: 'メールで招待',
      },
    });
    expect(p.userPrompt).toContain('招待を送る');
    expect(p.userPrompt).toContain('uc-1');
    expect(p.userPrompt).toContain('メールで招待');
  });

  it('system プロンプトに proposal のみ作成する契約が入っている', () => {
    const p = buildDecomposePrompt({
      ucNode: { id: 'uc-1', type: 'usecase', x: 0, y: 0, title: 't', body: '' },
    });
    expect(p.systemPrompt).toContain('proposal');
    expect(p.systemPrompt).toContain('derive');
  });
});
