import { promises as fs } from 'node:fs';
import path from 'node:path';

import type { Codebase, NodeType } from '@tally/core';
import type { ProjectStore } from '@tally/storage';

import type { AgentValidateResult } from './registry';

// 横断機能用: additionalCwds をプロンプトに差し込む共通テキストを生成する。
// 空配列・undefined なら空文字を返し、各エージェント側で安全に結合できる。
export function buildAdditionalRepoSection(additionalCwds?: string[]): string {
  if (!additionalCwds || additionalCwds.length === 0) return '';
  const list = additionalCwds.map((p) => `  - ${p}`).join('\n');
  return [
    '',
    '【横断リポジトリ】',
    '以下のディレクトリも読み取り可能 (Read / Glob / Grep に絶対パスで指定)。',
    'この機能は複数リポジトリにまたがるため、primary に加えて横断探索してよい。',
    list,
    '',
  ].join('\n');
}

export interface ValidateCodebaseAnchorOptions {
  // codebases[0] の存在を必須にするか (default: true)。
  // extract-questions のように codebase を読まないエージェントは false を渡す。
  requireCodebasePath?: boolean;
  // フロントから送られる codebase 指定 ID。指定があれば codebases[0] より優先する。
  codebaseId?: string;
}

// anchor type と (必要なら) 選択 codebase を検証する共通ヘルパ。
// find-related-code / analyze-impact は requireCodebasePath=true (default) で使う。
// extract-questions は requireCodebasePath=false を渡してグラフ文脈のみで起動する。
//
// codebaseId が指定されている場合はそれを優先してルックアップする。
// 未指定の場合は後方互換として codebases[0] を使う。
export async function validateCodebaseAnchor(
  deps: { store: ProjectStore; projectDir: string },
  nodeId: string,
  allowedTypes: readonly NodeType[],
  agentLabel: string,
  options: ValidateCodebaseAnchorOptions = {},
): Promise<AgentValidateResult> {
  const requireCodebasePath = options.requireCodebasePath ?? true;

  const node = await deps.store.getNode(nodeId);
  if (!node) {
    return { ok: false, code: 'not_found', message: `ノードが存在しない: ${nodeId}` };
  }
  if (!(allowedTypes as readonly string[]).includes(node.type)) {
    return {
      ok: false,
      code: 'bad_request',
      message: `${agentLabel} の対象外: ${node.type}`,
    };
  }

  if (!requireCodebasePath) {
    // codebase を読まないエージェント用: anchor type だけ検証して返す。
    return { ok: true, anchor: node };
  }

  const meta = await deps.store.getProjectMeta();
  const codebases = meta?.codebases ?? [];

  // 優先順位:
  //  1. options.codebaseId (呼び出し元の明示指定)
  //  2. anchor.codebaseId (coderef ノードが持つ所属 codebase)
  //  3. codebases[0] (後方互換フォールバック)
  const anchorCodebaseId = (node as { codebaseId?: string }).codebaseId;
  const resolvedId = options.codebaseId ?? anchorCodebaseId;

  let target: Codebase | undefined;
  if (resolvedId) {
    target = codebases.find((c) => c.id === resolvedId);
    if (!target) {
      return {
        ok: false,
        code: 'bad_request',
        message: `指定された codebaseId が見つかりません: ${resolvedId}`,
      };
    }
  } else {
    target = codebases[0];
  }

  if (!target) {
    return {
      ok: false,
      code: 'bad_request',
      message: 'プロジェクト設定で codebasePath を指定してください',
    };
  }
  // target.path は絶対パスまたは projectDir 相対パスとして解決する。
  const abs = path.resolve(deps.projectDir, target.path);
  try {
    const st = await fs.stat(abs);
    if (!st.isDirectory()) {
      return {
        ok: false,
        code: 'bad_request',
        message: `codebasePath がディレクトリではない: ${abs}`,
      };
    }
  } catch {
    return { ok: false, code: 'not_found', message: `codebasePath 解決失敗: ${abs}` };
  }

  return {
    ok: true,
    anchor: node,
    cwd: abs,
    codebaseId: target.id,
  };
}
