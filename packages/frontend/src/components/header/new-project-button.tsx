'use client';

import { useState } from 'react';

import { NewProjectDialog } from '@/components/dialog/new-project-dialog';

// トップページの「+ 新規プロジェクト」ボタン。クリックで NewProjectDialog を開く。
export function NewProjectButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} style={BUTTON_STYLE}>
        + 新規プロジェクト
      </button>
      <NewProjectDialog open={open} onClose={() => setOpen(false)} />
    </>
  );
}

const BUTTON_STYLE = {
  background: '#238636',
  color: '#fff',
  border: '1px solid #2ea043',
  borderRadius: 6,
  padding: '8px 14px',
  fontSize: 13,
  cursor: 'pointer',
  fontWeight: 600,
};
