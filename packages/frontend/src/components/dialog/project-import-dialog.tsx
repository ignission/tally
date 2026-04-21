'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { importProject } from '@/lib/api';
import { FolderBrowserDialog } from './folder-browser-dialog';

interface Props {
  open: boolean;
  onClose: () => void;
}

export function ProjectImportDialog({ open, onClose }: Props) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  const onConfirm = async (projectDir: string) => {
    setError(null);
    try {
      const res = await importProject(projectDir);
      router.push(`/projects/${encodeURIComponent(res.id)}`);
    } catch (err) {
      setError(String((err as Error).message ?? err));
    }
  };

  if (!open) return null;

  return (
    <>
      <FolderBrowserDialog
        open
        purpose="import-project"
        onConfirm={(p) => void onConfirm(p)}
        onClose={onClose}
      />
      {error && (
        <div role="alert" style={{
          position: 'fixed', bottom: 16, left: '50%', transform: 'translateX(-50%)',
          background: '#2b1419', color: '#f85149', padding: '8px 12px',
          border: '1px solid #6e2130', borderRadius: 6, fontSize: 12, zIndex: 2000,
        }}>
          {error}
        </div>
      )}
    </>
  );
}
