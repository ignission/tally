import type { Edge, Node } from '@tally/core';
import { describe, expect, it } from 'vitest';

import { buildMermaid } from './mermaid';

function reqNode(id: string, title: string): Node {
  return {
    id,
    type: 'requirement',
    x: 0,
    y: 0,
    title,
    body: '',
  } as Node;
}

function ucNode(id: string, title: string): Node {
  return {
    id,
    type: 'usecase',
    x: 0,
    y: 0,
    title,
    body: '',
  } as Node;
}

function questionNode(id: string, title: string): Node {
  return {
    id,
    type: 'question',
    x: 0,
    y: 0,
    title,
    body: '',
  } as Node;
}

function edge(id: string, from: string, to: string, type: Edge['type']): Edge {
  return { id, from, to, type };
}

describe('buildMermaid', () => {
  it('空グラフでも flowchart ヘッダ + 凡例を返す', () => {
    const out = buildMermaid([], []);
    expect(out.startsWith('flowchart LR')).toBe(true);
    expect(out).toContain('%% 凡例');
  });

  it('ノード型ごとに固有の形状を使う (ラベルはクォート囲み)', () => {
    const nodes = [reqNode('req-1', '要求A'), ucNode('uc-1', 'UC-A'), questionNode('q-1', '論点A')];
    const out = buildMermaid(nodes, []);
    expect(out).toContain('req_1["要求A"]');
    expect(out).toContain('uc_1("UC-A")');
    expect(out).toContain('q_1{"論点A"}');
  });

  it('ラベル内の括弧は Mermaid 構文を壊さない (クォート囲みのため)', () => {
    const out = buildMermaid([ucNode('uc', '工賃実績計算シート(Excel)を出力する')], []);
    expect(out).toContain('uc("工賃実績計算シート(Excel)を出力する")');
  });

  it('エッジ種別をラベル付き矢印に変換する', () => {
    const nodes = [reqNode('r', 'R'), ucNode('u', 'U')];
    const edges = [edge('e1', 'r', 'u', 'satisfy')];
    const out = buildMermaid(nodes, edges);
    expect(out).toContain('r -->|充足| u');
  });

  it('ラベル内の | や " を安全化する', () => {
    const nodes = [reqNode('r-1', '要求 | "重要"')];
    const out = buildMermaid(nodes, []);
    expect(out).not.toMatch(/\|/); // ノード行内にパイプが残らない
    expect(out).not.toContain('"重要"');
  });

  it('存在しないノードを参照するエッジは無視する', () => {
    const nodes = [reqNode('r', 'R')];
    const edges = [edge('e1', 'r', 'missing', 'satisfy')];
    const out = buildMermaid(nodes, edges);
    expect(out).not.toContain('missing');
  });

  it('direction オプションで TB/LR を切替できる', () => {
    expect(buildMermaid([], [], { direction: 'TB' }).startsWith('flowchart TB')).toBe(true);
    expect(buildMermaid([], [], { direction: 'LR' }).startsWith('flowchart LR')).toBe(true);
  });

  it('空タイトルはプレースホルダに置換される', () => {
    const out = buildMermaid([reqNode('r', '')], [], { placeholderTitle: '(未定)' });
    expect(out).toContain('(未定)');
  });
});
