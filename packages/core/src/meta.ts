import type { EdgeType, NodeType } from './types';

// キャンバスに描画するときの色・ラベル・アイコン・ファイル命名プレフィックス。
// UI ラベルは日本語で固定 (ADR-0001)。
export interface NodeMeta {
  label: string;
  color: string;
  accent: string;
  icon: string;
  filePrefix: string;
}

export const NODE_META: Record<NodeType, NodeMeta> = {
  requirement: {
    label: '要求',
    color: '#5b8def',
    accent: '#8fb0f5',
    icon: '◆',
    filePrefix: 'req',
  },
  usecase: {
    label: 'UC',
    color: '#4caf7a',
    accent: '#7fc79d',
    icon: '▶',
    filePrefix: 'uc',
  },
  userstory: {
    label: 'ストーリー',
    color: '#3fb8c9',
    accent: '#7dd3e0',
    icon: '✎',
    filePrefix: 'story',
  },
  question: {
    label: '論点',
    color: '#e07a4a',
    accent: '#f0a07a',
    icon: '?',
    filePrefix: 'q',
  },
  coderef: {
    label: 'コード',
    color: '#8b8b8b',
    accent: '#b0b0b0',
    icon: '⌘',
    filePrefix: 'code',
  },
  issue: {
    label: '課題',
    color: '#d9a441',
    accent: '#e6bf75',
    icon: '!',
    filePrefix: 'issue',
  },
  proposal: {
    label: 'AI提案',
    color: '#a070c8',
    accent: '#c4a3dc',
    icon: '✦',
    filePrefix: 'prop',
  },
};

// SVG の dash 配列と色で表現する線種。
// 色は種別の意味に合わせ、混雑したキャンバスでも種別を識別できるよう差別化する。
export interface EdgeMeta {
  label: string;
  dash: string;
  color: string;
}

export const EDGE_META: Record<EdgeType, EdgeMeta> = {
  // 充足: 主幹の関係なので一番目立つ実線・水色寄り
  satisfy: { label: '充足', dash: '', color: '#4fa3ff' },
  // 分解: 階層的包含。オレンジで構造線を示す
  contain: { label: '分解', dash: '10,3,2,3', color: '#e08e48' },
  // 派生: 由来。紫で論理的導出を示す
  derive: { label: '派生', dash: '6,4', color: '#b37dff' },
  // 詳細化: 同階層の深堀り。緑で段階を示す
  refine: { label: '詳細化', dash: '2,4', color: '#5ac8a0' },
  // 検証: 品質保証。黄色で注意を示す
  verify: { label: '検証', dash: '4,2,1,2', color: '#e0c045' },
  // 関連: 弱い紐付け。グレーで背景化
  trace: { label: '関連', dash: '1,3', color: '#6e7681' },
};
