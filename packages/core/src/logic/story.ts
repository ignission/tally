import type { UserStoryNode } from '../types';

export interface StoryProgress {
  acceptance: { total: number; done: number; ratio: number };
  tasks: { total: number; done: number; ratio: number };
}

// ストーリーの進捗を受け入れ基準とタスクそれぞれで計算する。
// total が 0 のときは比率を 0 とする (未定義より扱いが単純)。
export function computeStoryProgress(node: UserStoryNode): StoryProgress {
  const ac = node.acceptanceCriteria ?? [];
  const tasks = node.tasks ?? [];

  const acDone = ac.filter((item) => item.done).length;
  const taskDone = tasks.filter((item) => item.done).length;

  return {
    acceptance: {
      total: ac.length,
      done: acDone,
      ratio: ac.length === 0 ? 0 : acDone / ac.length,
    },
    tasks: {
      total: tasks.length,
      done: taskDone,
      ratio: tasks.length === 0 ? 0 : taskDone / tasks.length,
    },
  };
}

// 受け入れ基準・タスクのすべてが完了している場合に true。
// どちらも空のストーリーは「完了していない」と判定 (まだ中身が書かれていない)。
export function isStoryComplete(node: UserStoryNode): boolean {
  const ac = node.acceptanceCriteria ?? [];
  const tasks = node.tasks ?? [];
  if (ac.length === 0 && tasks.length === 0) return false;
  return ac.every((item) => item.done) && tasks.every((item) => item.done);
}
