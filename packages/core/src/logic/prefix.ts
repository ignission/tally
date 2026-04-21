// AI 生成ノードのタイトル先頭に付く "[AI]" プレフィックスを 1 回だけ除去する。
// ADR-0005 の「採用時に [AI] プレフィックスを削除」規定に対応。
const AI_PREFIX_PATTERN = /^\s*\[AI\]\s*/;

export function stripAiPrefix(title: string): string {
  return title.replace(AI_PREFIX_PATTERN, '');
}
