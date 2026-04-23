'use client';

import { useCanvasStore } from '@/lib/store';

// 各ノード種別コンポーネントで共通の「折りたたみ状態とトグル」を返す hook。
// 折りたたみは UI 状態のみで YAML には永続化しない。キー未設定は折りたたみ扱い。
export function useNodeAccordion(id: string): {
  collapsed: boolean;
  toggle: () => void;
} {
  const collapsed = useCanvasStore((s) => !s.expandedNodes[id]);
  const toggleNodeExpanded = useCanvasStore((s) => s.toggleNodeExpanded);
  return {
    collapsed,
    toggle: () => toggleNodeExpanded(id),
  };
}
