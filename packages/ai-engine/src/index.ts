// WS サーバを起動する main 関数。実行は scripts から tsx でこのファイルを走らせる。
import { query } from '@anthropic-ai/claude-agent-sdk';

import { loadConfig } from './config';
import { startServer } from './server';

export const PACKAGE_NAME = '@tally/ai-engine';
export type { ChatRunnerDeps } from './chat-runner';
export { ChatRunner } from './chat-runner';
export { loadConfig } from './config';
export { startServer } from './server';
export type { AgentEvent, ChatEvent } from './stream';

// tsx で直接呼ばれたときだけ起動する (vitest などで import されたときは起動しない)。
if (process.argv[1]?.endsWith('/src/index.ts')) {
  const cfg = loadConfig(process.env);
  // SDK 実 API の Options 型はこちらで扱わないため、SdkLike に合わせて never キャストで受ける。
  const sdk = { query: query as never };
  startServer({ port: cfg.port, sdk }).then((handle) => {
    // eslint-disable-next-line no-console
    console.log(`[ai-engine] listening on ws://localhost:${handle.port}/agent`);
  });
}
