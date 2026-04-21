'use client';

import { useMemo, useState } from 'react';

import type { Codebase } from '@tally/core';

import { useCanvasStore } from '@/lib/store';

export interface CodebaseSelectorState {
  codebases: Codebase[];
  selected: Codebase | null;
  pick: (id: string) => void;
  disabled: boolean;
  tooltip: string | undefined;
}

// AI アクションボタン共通: 「どの codebase を使うか」を管理する hook。
// - 0 件: disabled=true, tooltip='コードベースを追加してください'
// - 1 件: そのまま自動選択
// - 2 件以上: explicitId で切り替え可能 (未選択時は先頭をデフォルト)
export function useCodebaseSelector(): CodebaseSelectorState {
  const codebases = useCanvasStore((s) => s.projectMeta?.codebases ?? []);
  const [explicitId, setExplicitId] = useState<string | null>(null);

  const selected = useMemo<Codebase | null>(() => {
    if (codebases.length === 0) return null;
    if (codebases.length === 1) return codebases[0] ?? null;
    const picked =
      explicitId !== null ? codebases.find((c) => c.id === explicitId) : undefined;
    return picked ?? codebases[0] ?? null;
  }, [codebases, explicitId]);

  return {
    codebases,
    selected,
    pick: (id: string) => setExplicitId(id),
    disabled: codebases.length === 0,
    tooltip: codebases.length === 0 ? 'コードベースを追加してください' : undefined,
  };
}
