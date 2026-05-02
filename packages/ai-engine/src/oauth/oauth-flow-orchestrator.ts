// ADR-0011 PR-E3: OAuth 2.1 フロー全体のオーケストレータ。
// PR-E2 で実装した部品 (OAuthClient + LoopbackCallbackServer) と PR-E1 の
// FileSystemOAuthStore を組み合わせて、Route Handler から呼べる単一エントリ
// (`startOAuthFlow` / `getOAuthFlowStatus`) に集約する。
//
// 設計判断:
// - process scope の singleton state (`flows` Map) で in-progress 状態を保持。
//   Next.js Route Handler は per-request にハンドラ関数が走るが、Next の dev/prod
//   とも単一 Node.js プロセスで動くので module scope の Map は共有される。
// - 1 mcpServerId につき同時に 1 フローまで。pending 中の二重 start は reject。
// - state verify (CSRF 対策) は本モジュールが持つ。LoopbackCallbackServer から
//   返ってきた code/state のうち、state が start 時に発行したものと一致しなければ
//   即 failed に倒す。
// - completed / failed 状態は次回 start まで Map に残す (UI が status を pull できる)。
//   start を呼ぶと前の状態は上書きされる。

import { randomUUID } from 'node:crypto';

import type { McpOAuthToken, OAuthProviderConfig } from '@tally/core';
import { FileSystemOAuthStore } from '@tally/storage';
import {
  type LoopbackCallbackHandle,
  startLoopbackCallbackServer,
} from './loopback-callback-server';
import {
  buildAuthorizationUrl,
  exchangeCodeForToken,
  generateOAuthState,
  generatePkcePair,
} from './oauth-client';

export type OAuthFlowStatus =
  | {
      status: 'pending';
      authorizationUrl: string;
    }
  | {
      status: 'completed';
      // completed では authorizationUrl は意味を持たないが UI 側のシグナル整合のため残す。
      // TODO(PR-E3b): UI 側が completed 時に authorizationUrl を参照しないことが確認できたら
      // この field は削除しても良い (deadweight 化のため)。
      authorizationUrl: string;
    }
  | {
      status: 'failed';
      authorizationUrl: string;
      failureMessage: string;
    };

// OAuthFlowStatus の discriminated union を保つために interface 拡張ではなく
// intersection で promise を足す (narrow が動くため)。
type FlowEntry = OAuthFlowStatus & {
  // bg で動く完了 promise。await することは無いが、test の安定化用に export 用 helper を持つ。
  promise: Promise<void>;
  // pending 中のみ存在する loopback server ハンドル。clearOAuthFlow から close() を呼んで
  // bg IIFE を中断するために flows entry で保持する (CR HIGH 対応)。
  callbackHandle?: LoopbackCallbackHandle;
  // この flow を起動した startOAuthFlow 呼び出し固有の ID。並走 start や
  // clearOAuthFlow → 即 start などで entry が他の run に置き換わったかを
  // 判定するために使う。bg IIFE は flows.set する前に runId 一致を確認する
  // ことで、自分が「現在の run」でなくなっていたら状態遷移をスキップする
  // (CR Major 対応: 古い run が新 run の状態を踏みつぶすのを防ぐ)。
  runId: string;
};

// プロセスローカルの flow 状態。Next の Route Handler が共有する。
// key: makeFlowKey(projectId, mcpServerId) で生成する composite key。
// projectId のみ / mcpServerId のみだと、複数プロジェクトが同名 mcpServerId を持つ
// ケース (例: project A と project B が両方 'atlassian' を使う) で flow がクロス汚染される
// (codex Major 対応)。
const flows = new Map<string, FlowEntry>();

// project と mcpServerId から flows Map のキーを生成する。両者は core schema の
// id 制約 (`[a-z][a-z0-9-]{0,31}`) で区切り文字 ':' を含まないため、衝突しない。
function makeFlowKey(projectId: string, mcpServerId: string): string {
  return `${projectId}:${mcpServerId}`;
}

export interface StartOAuthFlowInput {
  // codex Major 対応: 同名 mcpServerId を持つプロジェクト間の取り違えを防ぐため、
  // flow key には projectId を含める。Route Handler が path param から渡す。
  projectId: string;
  mcpServerId: string;
  provider: OAuthProviderConfig;
  clientId: string;
  // 未指定なら provider.defaultScopes を使う。
  scopes?: readonly string[];
  // FileSystemOAuthStore が token を書き込むプロジェクトディレクトリ。
  projectDir: string;
}

export interface StartOAuthFlowResult {
  authorizationUrl: string;
}

// OAuth フロー開始: PKCE/state 生成 → loopback server 起動 → authorization URL 構築 →
// bg で callback を待ち token 交換 + 保存 → 完了/失敗を flows Map に反映。
//
// 戻り値の `authorizationUrl` を UI 側がブラウザで開く。`getOAuthFlowStatus` で
// 完了を polling する。
export async function startOAuthFlow(input: StartOAuthFlowInput): Promise<StartOAuthFlowResult> {
  const flowKey = makeFlowKey(input.projectId, input.mcpServerId);
  // CR HIGH 対応: スロット予約を await より前に同期で確保する。これをしないと
  // `await startLoopbackCallbackServer()` 中に並走 start が来た場合、両方が
  // `existing?.status === 'pending'` を通過してフローが二重に走る。
  // sentinel として一旦 authorizationUrl='' で予約し、本物が決まったら上書きする。
  const existing = flows.get(flowKey);
  if (existing?.status === 'pending') {
    throw new Error(`OAuth flow already in progress for "${flowKey}"`);
  }
  // CR Major 対応: この呼び出し固有の runId を発行する。bg IIFE は状態遷移する前に
  // 自分が flows に登録された当時の runId を保持しているか確認する。clearOAuthFlow
  // → 別 start で entry が置き換わったケースでは、古い run の bg は何もしない。
  const runId = randomUUID();
  flows.set(flowKey, {
    status: 'pending',
    authorizationUrl: '',
    promise: Promise.resolve(),
    runId,
  });

  const pkce = generatePkcePair();
  const state = generateOAuthState();
  let callbackHandle: LoopbackCallbackHandle;
  try {
    callbackHandle = await startLoopbackCallbackServer();
  } catch (err) {
    // 起動失敗で sentinel が残らないよう片付ける (この run が登録した sentinel 限定)。
    const cur = flows.get(flowKey);
    if (cur?.runId === runId) {
      flows.delete(flowKey);
    }
    throw err;
  }
  // ownership 確認: startLoopbackCallbackServer の await 中に clearOAuthFlow か
  // 別 start が割り込んで entry が置き換わっていたら、起動した callback server
  // を片付けて本 run は abort する (新 run を踏みつぶさない)。
  const afterListen = flows.get(flowKey);
  if (afterListen?.runId !== runId) {
    await callbackHandle.close().catch((closeErr) => {
      console.warn(`[oauth-flow] callback server close failed (abort path): ${String(closeErr)}`);
    });
    throw new Error(`OAuth flow was preempted for "${flowKey}"`);
  }
  const scopes = input.scopes ?? input.provider.defaultScopes;

  const authorizationUrl = buildAuthorizationUrl({
    provider: input.provider,
    clientId: input.clientId,
    redirectUri: callbackHandle.redirectUri,
    scopes,
    state,
    codeChallenge: pkce.codeChallenge,
  });

  // bg promise を IIFE で生成。IIFE 内部から自分自身の promise 変数を直接参照すると
  // tsc の definite-assignment 解析でエラーになるため、`flows.get(mcpServerId)?.promise`
  // 経由で取り出して再 set する。これは外側で flows.set した後の値を読むので安全。
  const promise = (async () => {
    try {
      const cb = await callbackHandle.awaitCallback();
      if (cb.state !== state) {
        throw new Error('OAuth state mismatch (possible CSRF or stale callback)');
      }
      const result = await exchangeCodeForToken({
        provider: input.provider,
        clientId: input.clientId,
        code: cb.code,
        redirectUri: callbackHandle.redirectUri,
        codeVerifier: pkce.codeVerifier,
      });

      const now = new Date().toISOString();
      const expiresAt =
        result.expiresIn !== undefined
          ? new Date(Date.now() + result.expiresIn * 1000).toISOString()
          : undefined;

      // exactOptionalPropertyTypes 下では undefined を含む object 構築不可なので
      // optional フィールドは値があるときだけ乗せる。
      // scope は空白区切り。連続空白・前後空白で空文字が混入しないよう \s+ split + filter。
      const scopesParsed = result.scope?.split(/\s+/).filter(Boolean);
      const token: McpOAuthToken = {
        mcpServerId: input.mcpServerId,
        accessToken: result.accessToken,
        ...(result.refreshToken !== undefined ? { refreshToken: result.refreshToken } : {}),
        acquiredAt: now,
        ...(expiresAt !== undefined ? { expiresAt } : {}),
        ...(scopesParsed && scopesParsed.length > 0 ? { scopes: scopesParsed } : {}),
        tokenType: result.tokenType,
      };

      // CR Major 対応 (codex): store.write の手前で ownership 確認。ここを通さないと、
      // この run が clearOAuthFlow → 別 start に置き換えられた後でも旧 run のトークンが
      // ストレージに書き込まれ、UI 上の新 run の pending と保存済みトークンの不整合が起きる。
      // 不一致なら throw して catch 側に流す (catch 側でも runId guard が掛かるので状態は遷移しない)。
      const ownerBeforeWrite = flows.get(flowKey);
      if (ownerBeforeWrite?.runId !== runId) {
        throw new Error(`OAuth flow was preempted before token write for "${flowKey}"`);
      }

      const store = new FileSystemOAuthStore(input.projectDir);
      await store.write(token);

      const cur = flows.get(flowKey);
      if (cur && cur.runId === runId) {
        flows.set(flowKey, {
          status: 'completed',
          authorizationUrl,
          promise: cur.promise,
          runId,
        });
      } else {
        // store.write 後の極めて稀な race: write 中に clearOAuthFlow が走ったケース。
        // 新 run の pending を踏まないために状態遷移はせず warn のみ。
        // (write 後にトークンが残るが、これは runId guard が write 前に通った時点で
        //  「現在の run の成果」として正しく書かれている。後で新 run が同 mcpServerId で
        //  完了すれば上書きされる。)
        console.warn(
          `[oauth-flow] flow entry was preempted between write and completion: ${flowKey}`,
        );
      }
    } catch (err) {
      // CR Major 対応: failureMessage は raw な err.message を露出すると provider エンドポイント /
      // 内部メッセージが UI 経由でユーザーに返ってしまうので、固定メッセージに正規化する。
      // 詳細は console.warn で server-side ログに残す。
      console.warn(
        `[oauth-flow] flow failed (flowKey=${flowKey}): ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`,
      );
      const cur = flows.get(flowKey);
      if (cur && cur.runId === runId) {
        flows.set(flowKey, {
          status: 'failed',
          authorizationUrl,
          failureMessage: 'OAuth flow failed (see server logs for details)',
          promise: cur.promise,
          runId,
        });
      } else {
        console.warn(`[oauth-flow] flow entry was preempted before failure: ${flowKey}`);
      }
    } finally {
      await callbackHandle.close().catch((closeErr) => {
        // close 失敗は token 保存成否には影響しないが、port / fd リーク診断のため warn。
        console.warn(`[oauth-flow] callback server close failed: ${String(closeErr)}`);
      });
    }
  })();

  // ここでも ownership 再確認: 上の `afterListen` チェック以降は同期のみだが、
  // bg IIFE の生成中にも microtask は走らないので置き換えは起きない想定。
  // 念のため runId 一致を確認してから本物の entry に上書きする。
  const beforePublish = flows.get(flowKey);
  if (beforePublish?.runId !== runId) {
    // この run は abort された後。bg promise はもう動いているが、awaitCallback で
    // close() による reject を受けて catch に行き、preempted ログを出して終わる。
    // ここで認可 URL を return しても呼び出し元には混乱を招くだけなので throw する。
    await callbackHandle.close().catch(() => {});
    throw new Error(`OAuth flow was preempted for "${flowKey}"`);
  }
  flows.set(flowKey, {
    status: 'pending',
    authorizationUrl,
    promise,
    callbackHandle,
    runId,
  });

  return { authorizationUrl };
}

// 現在の flow 状態を取得。未開始なら null。
export function getOAuthFlowStatus(projectId: string, mcpServerId: string): OAuthFlowStatus | null {
  const f = flows.get(makeFlowKey(projectId, mcpServerId));
  if (!f) return null;
  // promise を返さないために再構築する (ユーザーには内部 promise を見せない)。
  if (f.status === 'pending') return { status: 'pending', authorizationUrl: f.authorizationUrl };
  if (f.status === 'completed') {
    return { status: 'completed', authorizationUrl: f.authorizationUrl };
  }
  return {
    status: 'failed',
    authorizationUrl: f.authorizationUrl,
    failureMessage: f.failureMessage,
  };
}

// 進行中の bg promise が完了するのを待つ helper (主に test 用)。Route Handler は
// status を polling するので呼ばない。
export async function awaitOAuthFlowSettled(projectId: string, mcpServerId: string): Promise<void> {
  const f = flows.get(makeFlowKey(projectId, mcpServerId));
  if (!f) return;
  await f.promise;
}

// flow state を Map から消す (UI 側の「やり直し」操作用)。pending 中だった場合は
// callbackHandle.close() を呼んで bg IIFE を中断する。close 後に awaitCallback が
// reject され IIFE は catch ブランチに行くが、その時点で flows entry は無いので
// console.warn が出るのは想定動作。
export function clearOAuthFlow(projectId: string, mcpServerId: string): void {
  const flowKey = makeFlowKey(projectId, mcpServerId);
  const f = flows.get(flowKey);
  if (f?.status === 'pending' && f.callbackHandle) {
    f.callbackHandle.close().catch(() => {
      /* swallow: close 失敗は cleanup の妨げにしない */
    });
  }
  flows.delete(flowKey);
}

/**
 * @internal テスト isolation 用: 全 flow をクリアする。本番コードから呼ばないこと。
 *
 * CR Major 対応: pending な flow の callbackHandle を close してから関数 return する。
 * 単に Map.clear だけだと bg IIFE が抱えている loopback サーバが解放されず、テスト間で
 * port や fd がリークする (LoopbackCallbackServer は port=0 で起動するので衝突自体は
 * しないが、test プロセス全体で fd が積み上がる)。
 *
 * 順序: flows.clear() を close await の前に呼ぶ。理由は、close が完了する前に bg IIFE
 * が catch ブランチに入って `flows.get(id)` をしたときに、旧 entry が見えていると runId
 * guard を通過して状態を書き換えてしまう可能性があるため (実際には runId は同じなので
 * 通過する)。clear を先にすることで、bg は entry なし → preempted ログだけ出して終わる。
 */
export async function __resetAllFlowsForTest(): Promise<void> {
  const closes: Promise<void>[] = [];
  for (const f of flows.values()) {
    if (f.callbackHandle) {
      closes.push(
        f.callbackHandle.close().catch((closeErr) => {
          console.warn(`[oauth-flow] reset close failed: ${String(closeErr)}`);
        }),
      );
    }
  }
  flows.clear();
  await Promise.all(closes);
}
