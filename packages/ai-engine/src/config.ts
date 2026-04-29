export interface AiEngineConfig {
  port: number;
}

// ai-engine の環境依存設定を 1 箇所に集約する。
// 認証情報は扱わない (Claude Code OAuth トークンを SDK が暗黙で拾う)。
export function loadConfig(env: NodeJS.ProcessEnv): AiEngineConfig {
  const raw = env.AI_ENGINE_PORT;
  // default 3322: 3321 (frontend) の隣。3000/4000/4001/5050 等は他プロジェクトと衝突しがち。
  // env AI_ENGINE_PORT で上書き可能。
  if (raw === undefined || raw === '') return { port: 3322 };
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`AI_ENGINE_PORT が不正: ${raw}`);
  }
  return { port: n };
}
