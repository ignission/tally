import type { AdoptableType } from '@tally/core';
import type { ProjectStore } from '@tally/storage';

// create-node 入力のうち guard に必要な最小 shape。
export interface GuardInput {
  title: string;
  body: string;
  additional: Record<string, unknown> | undefined;
}

// guard が共有するランタイム文脈。
export interface DuplicateGuardContext {
  store: ProjectStore;
  // anchor 無し (chat) のときは空文字。anchor 依存 guard は空文字を skip せよ。
  anchorId: string;
  // セッション内で生成済みノードの重複記録。キーは guard 実装が決める。
  sessionMemo: Set<string>;
  // マルチコードベース対応のために流すコードベース ID (optional)。
  codebaseId?: string;
}

export interface DuplicateFound {
  reason: string; // ユーザー向けメッセージ (既存 node id などを含む)
}

export interface DuplicateGuard {
  // 対象 adoptAs。複数対応は同 guard を複数 adoptAs で登録する。
  adoptAs: AdoptableType;
  // 重複があれば DuplicateFound、無ければ null。
  check(input: GuardInput, ctx: DuplicateGuardContext): Promise<DuplicateFound | null>;
  // 生成成功後に呼ばれる (sessionMemo 更新など)。任意。
  onCreated?(input: GuardInput, ctx: DuplicateGuardContext): void;
}

// adoptAs → Guard[] のレジストリ。Task 7-9 で個別 guard を追加する。
const REGISTRY = new Map<AdoptableType, DuplicateGuard[]>();

export function registerGuard(guard: DuplicateGuard): void {
  const list = REGISTRY.get(guard.adoptAs) ?? [];
  list.push(guard);
  REGISTRY.set(guard.adoptAs, list);
}

// dispatcher: 登録 guard を順に check し、最初に重複を見つけたら返す。
// 全部 null なら null。Promise を一つずつ await する (並列にしない: 副作用順序を保つ)。
export async function dispatchDuplicateGuard(
  adoptAs: AdoptableType,
  input: GuardInput,
  ctx: DuplicateGuardContext,
): Promise<DuplicateFound | null> {
  const guards = REGISTRY.get(adoptAs) ?? [];
  for (const g of guards) {
    const found = await g.check(input, ctx);
    if (found) return found;
  }
  return null;
}

// 生成成功通知: 登録 guard の onCreated を全部呼ぶ。
export function notifyCreated(
  adoptAs: AdoptableType,
  input: GuardInput,
  ctx: DuplicateGuardContext,
): void {
  const guards = REGISTRY.get(adoptAs) ?? [];
  for (const g of guards) g.onCreated?.(input, ctx);
}

// テスト用: REGISTRY をクリア。プロダクションコードからは呼ばないこと。
// 命名 prefix で「test-only」を明示し、accidental 使用を防ぐ。
export function __resetGuardsForTest(): void {
  REGISTRY.clear();
}

import { coderefGuard } from './coderef';
import { questionGuard } from './question';

// 個別 guard を register する (module load 時の副作用)。
// テストは __resetGuardsForTest でクリアした後、必要な guard を再登録すること。
registerGuard(coderefGuard);
registerGuard(questionGuard);
