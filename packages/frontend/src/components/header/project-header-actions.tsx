'use client';

import { useState } from 'react';

import { IngestDocumentDialog } from '@/components/dialog/ingest-document-dialog';
import { ProjectSettingsDialog } from '@/components/dialog/project-settings-dialog';
import { useCanvasStore } from '@/lib/store';

// ヘッダ右側のアクション群。「要求書から取り込む」「ボードをクリア」ボタンと設定歯車ボタン。
// ダイアログ側がストアを読むため、このコンポーネントは open 状態のみ管理。
export function ProjectHeaderActions() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [ingestOpen, setIngestOpen] = useState(false);
  const [clearing, setClearing] = useState(false);
  const clearBoard = useCanvasStore((s) => s.clearBoard);
  const projectMeta = useCanvasStore((s) => s.projectMeta);

  const onClear = async () => {
    const name = projectMeta?.name ?? 'このプロジェクト';
    if (
      !window.confirm(
        `「${name}」のノード・エッジ・チャットを全て削除します。project.yaml は保持されますが、内容は戻せません。続けますか？`,
      )
    ) {
      return;
    }
    setClearing(true);
    try {
      await clearBoard();
    } finally {
      setClearing(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setIngestOpen(true)}
        style={INGEST_BUTTON_STYLE}
      >
        要求書から取り込む
      </button>
      <button
        type="button"
        onClick={() => {
          onClear().catch(console.error);
        }}
        disabled={clearing}
        title="ノード・エッジ・チャットを全削除 (project.yaml は維持)"
        style={CLEAR_BUTTON_STYLE}
      >
        {clearing ? 'クリア中…' : 'ボードをクリア'}
      </button>
      <button
        type="button"
        aria-label="プロジェクト設定"
        title="プロジェクト設定"
        onClick={() => setSettingsOpen(true)}
        style={SETTINGS_BUTTON_STYLE}
      >
        ⚙
      </button>
      <IngestDocumentDialog open={ingestOpen} onClose={() => setIngestOpen(false)} />
      <ProjectSettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </>
  );
}

const INGEST_BUTTON_STYLE = {
  background: 'transparent',
  border: '1px solid #30363d',
  color: '#e6edf3',
  borderRadius: 6,
  padding: '4px 10px',
  fontSize: 12,
  cursor: 'pointer',
  marginLeft: 'auto',
};

const CLEAR_BUTTON_STYLE = {
  background: 'transparent',
  border: '1px solid #5c1e28',
  color: '#f85149',
  borderRadius: 6,
  padding: '4px 10px',
  fontSize: 12,
  cursor: 'pointer',
  marginLeft: 8,
};

const SETTINGS_BUTTON_STYLE = {
  background: 'transparent',
  border: '1px solid #30363d',
  color: '#e6edf3',
  borderRadius: 6,
  padding: '4px 8px',
  fontSize: 14,
  cursor: 'pointer',
  marginLeft: 8,
};
