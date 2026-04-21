import type { QuestionNode, QuestionOption } from '../types';

// 論点ノードが「決定済み」かどうかを判定する。
// decision が空文字や null でなく、options 内に該当 ID が存在する場合のみ決定済みとみなす。
export function isDecided(node: QuestionNode): boolean {
  return getSelectedOption(node) !== null;
}

// 選ばれている選択肢を返す。未決定なら null。
export function getSelectedOption(node: QuestionNode): QuestionOption | null {
  if (!node.decision) return null;
  const options = node.options;
  if (!options || options.length === 0) return null;
  return options.find((opt) => opt.id === node.decision) ?? null;
}
