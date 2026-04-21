import { customAlphabet } from 'nanoid';

import { NODE_META } from './meta';
import type { NodeType } from './types';

// 衝突耐性と可読性のバランスで 10 文字。大文字小文字・数字のみでファイル名に使える。
const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const ID_LENGTH = 10;
const generateSuffix = customAlphabet(ID_ALPHABET, ID_LENGTH);

// ノード ID は「型プレフィックス + ハイフン + nanoid」。
// 既存サンプル (`req-invite` など手書き可読 ID) とファイル名規則を揃える。
export function newNodeId(type: NodeType): string {
  return `${NODE_META[type].filePrefix}-${generateSuffix()}`;
}

// エッジ ID は接続情報主体で短ければ良いので `e-` + nanoid。
export function newEdgeId(): string {
  return `e-${generateSuffix()}`;
}

// プロジェクト ID はユーザーが手で命名したい場合がある。
// 手書き文字列を受け取るケースでは、呼び出し側で正規化して渡すこと。
export function newProjectId(): string {
  return `proj-${generateSuffix()}`;
}

// 論点ノードの選択肢 ID。extract-questions エージェントが生成する options の
// 識別子に使う。衝突耐性と可読性を揃えるためノード ID と同じ 10 文字サフィックス。
export function newQuestionOptionId(): string {
  return `opt-${generateSuffix()}`;
}

// チャットスレッド ID。プロジェクト内で複数スレッドを持つため、短く可読。
export function newChatId(): string {
  return `chat-${generateSuffix()}`;
}

// チャットメッセージ ID。1 スレッド内で多数 (数十〜数百) になるため nanoid ベース。
export function newChatMessageId(): string {
  return `msg-${generateSuffix()}`;
}

// チャット内の tool_use 呼び出し ID。承認 UI で識別に使う。
export function newToolUseId(): string {
  return `tool-${generateSuffix()}`;
}
