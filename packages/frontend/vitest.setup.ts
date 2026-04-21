// tsx テストで jest-dom の matcher (toBeInTheDocument など) を使えるようにする。
import '@testing-library/jest-dom/vitest';

import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// testing-library v16 + vitest では自動 cleanup が効かない環境があるので明示的に呼ぶ。
// 呼ばないと 1 テスト目の DOM が 2 テスト目に残って getBy* が多重マッチで落ちる。
afterEach(() => {
  cleanup();
});
