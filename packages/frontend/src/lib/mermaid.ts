import type { Edge, EdgeType, Node, NodeType } from '@tally/core';
import { EDGE_META } from '@tally/core';

// グラフを Mermaid flowchart 構文へ変換する。
// Slack/Notion/Confluence などに貼り付ければ静的な図として共有できる。

// Mermaid のノード形状: ノード型に応じた記号を使い、視覚的に区別する。
// ラベルは常にダブルクォート文字列で包む (Mermaid は括弧や特殊文字の解釈を回避できる)。
type ShapeFn = (label: string) => string;

const SHAPES: Record<NodeType, ShapeFn> = {
  requirement: (l) => `["${l}"]`,
  usecase: (l) => `("${l}")`,
  userstory: (l) => `[/"${l}"/]`,
  question: (l) => `{"${l}"}`,
  coderef: (l) => `[["${l}"]]`,
  issue: (l) => `(("${l}"))`,
  proposal: (l) => `["✦ ${l}"]`,
};

// エッジ矢印: satisfy は太実線、trace は弱い点線、等。
// Mermaid の線種記法に揃える。
const ARROWS: Record<EdgeType, string> = {
  satisfy: '-->',
  contain: '==>',
  derive: '-.->',
  refine: '-->',
  verify: '==>',
  trace: '-.->',
};

// ノードラベル中の Mermaid 特殊文字を安全化する。
// ダブルクォート・山括弧・パイプはパース衝突するため削除 or エスケープ。
function sanitize(label: string): string {
  return label
    .replace(/"/g, "'")
    .replace(/\|/g, '／')
    .replace(/[<>]/g, '')
    .replace(/\r?\n/g, ' ')
    .trim();
}

// Mermaid のノード ID は英数字とアンダースコアのみ推奨。
// Tally のノード ID は `-` を含むため、アンダースコアに置換。
function toMermaidId(id: string): string {
  return id.replace(/[^A-Za-z0-9]/g, '_');
}

export interface BuildMermaidOptions {
  /** レイアウト方向。TB/LR が実用。省略時 LR。 */
  direction?: 'TB' | 'LR';
  /** 空タイトルのときに出すプレースホルダ。省略時 "(無題)"。 */
  placeholderTitle?: string;
}

export function buildMermaid(nodes: Node[], edges: Edge[], opts: BuildMermaidOptions = {}): string {
  const direction = opts.direction ?? 'LR';
  const placeholder = opts.placeholderTitle ?? '(無題)';

  const lines: string[] = [];
  lines.push(`flowchart ${direction}`);

  // ノード定義
  for (const n of nodes) {
    const id = toMermaidId(n.id);
    const shape = SHAPES[n.type];
    const rawTitle = n.title && n.title.trim().length > 0 ? n.title : placeholder;
    const label = sanitize(rawTitle);
    lines.push(`  ${id}${shape(label)}`);
  }

  // エッジ定義
  const validIds = new Set(nodes.map((n) => n.id));
  for (const e of edges) {
    if (!validIds.has(e.from) || !validIds.has(e.to)) continue;
    const from = toMermaidId(e.from);
    const to = toMermaidId(e.to);
    const meta = EDGE_META[e.type];
    const arrow = ARROWS[e.type];
    lines.push(`  ${from} ${arrow}|${meta.label}| ${to}`);
  }

  // ノード種別の凡例コメント (Mermaid は %% がコメント記法)
  lines.push('');
  lines.push('  %% 凡例: [要求] (UC) {論点} [[コード]] ((課題)) ["✦ 提案"]');

  return lines.join('\n');
}
