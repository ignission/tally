import { promises as fs } from 'node:fs';
import path from 'node:path';

import type { NodeType } from '@tally/core';
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
  // codebasePath の存在を必須にするか (default: true)。
  // extract-questions のように codebase を読まないエージェントは false を渡す。
  requireCodebasePath?: boolean;
}

// anchor type と (必要なら) codebasePath を検証する共通ヘルパ。
// find-related-code / analyze-impact は requireCodebasePath=true (default) で使う。
// extract-questions は requireCodebasePath=false を渡してグラフ文脈のみで起動する。
export async function validateCodebaseAnchor(
  deps: { store: ProjectStore; workspaceRoot: string },
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
  if (!meta?.codebasePath) {
    return {
      ok: false,
      code: 'bad_request',
      message: 'プロジェクト設定で codebasePath を指定してください',
    };
  }
  const abs = path.resolve(deps.workspaceRoot, meta.codebasePath);
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

  // 追加リポジトリ: 存在しないパスは警告レベルで無視する方針 (primary とは違い必須ではない)。
  // 存在検証に失敗した行はログだけ残してスキップ。AI には有効なものだけを提示する。
  const additionalCwds: string[] = [];
  for (const rel of meta.additionalCodebasePaths ?? []) {
    const addAbs = path.resolve(deps.workspaceRoot, rel);
    try {
      const st = await fs.stat(addAbs);
      if (st.isDirectory()) additionalCwds.push(addAbs);
    } catch {
      // スキップ: 存在しない追加パスは無視。
    }
  }

  return {
    ok: true,
    anchor: node,
    cwd: abs,
    ...(additionalCwds.length > 0 ? { additionalCwds } : {}),
  };
}
