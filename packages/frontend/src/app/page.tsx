'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { NewProjectDialog } from '@/components/dialog/new-project-dialog';
import { ProjectImportDialog } from '@/components/dialog/project-import-dialog';
import { type RegistryProjectDto, fetchRegistryProjects, unregisterProjectApi } from '@/lib/api';

export default function Page() {
  const [projects, setProjects] = useState<RegistryProjectDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [showImport, setShowImport] = useState(false);

  const reload = async () => {
    setError(null);
    try {
      const list = await fetchRegistryProjects();
      setProjects(list);
    } catch (err) {
      setError(String((err as Error).message ?? err));
    }
  };

  useEffect(() => {
    void reload();
  }, []);

  const onUnregister = async (id: string) => {
    try {
      await unregisterProjectApi(id);
      await reload();
    } catch (err) {
      setError(String((err as Error).message ?? err));
    }
  };

  return (
    <main style={MAIN}>
      <div style={CONTAINER}>
        <header style={HEADER}>
          <h1 style={H1}>Tally</h1>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" onClick={() => setShowNew(true)} style={PRIMARY_BTN}>
              + 新規プロジェクト
            </button>
            <button type="button" onClick={() => setShowImport(true)} style={CANCEL_BTN}>
              既存を読み込む
            </button>
          </div>
        </header>

        {error && (
          <div role="alert" style={ERROR}>
            {error}
          </div>
        )}
        {projects === null && !error && <div style={MUTED}>読み込み中…</div>}
        {projects !== null && projects.length === 0 && (
          <div style={MUTED}>
            プロジェクトが登録されていません。「+
            新規プロジェクト」または「既存を読み込む」から開始してください。
          </div>
        )}

        <ul style={LIST}>
          {(projects ?? []).map((p) => (
            <li key={p.id} style={ITEM}>
              <div style={ITEM_MAIN}>
                <Link href={`/projects/${encodeURIComponent(p.id)}`} style={LINK_TITLE}>
                  {p.name}
                </Link>
                {p.description && <div style={DESC}>{p.description}</div>}
                <div style={DIR}>{p.projectDir}</div>
                <div style={CB_SUMMARY}>
                  codebases:{' '}
                  {p.codebases.length === 0 ? '未設定' : p.codebases.map((c) => c.id).join(', ')}
                </div>
              </div>
              <div style={ITEM_ACTIONS}>
                <button type="button" onClick={() => void onUnregister(p.id)} style={LINK}>
                  レジストリから外す
                </button>
              </div>
            </li>
          ))}
        </ul>
      </div>

      <NewProjectDialog
        open={showNew}
        onClose={() => {
          setShowNew(false);
          void reload();
        }}
      />
      <ProjectImportDialog
        open={showImport}
        onClose={() => {
          setShowImport(false);
          void reload();
        }}
      />
    </main>
  );
}

const MAIN: React.CSSProperties = {
  minHeight: '100vh',
  background: '#0d1117',
  color: '#e6edf3',
  fontFamily:
    "system-ui, -apple-system, 'Segoe UI', 'Hiragino Sans', 'Yu Gothic UI', sans-serif",
  padding: 24,
};
const CONTAINER: React.CSSProperties = {
  maxWidth: 960,
  margin: '0 auto',
};
const HEADER: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  marginBottom: 16,
};
const H1 = { margin: 0, fontSize: 20 };
const LIST: React.CSSProperties = {
  listStyle: 'none',
  margin: 0,
  padding: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
};
const ITEM: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'flex-start',
  border: '1px solid #30363d',
  borderRadius: 6,
  padding: 12,
  background: '#0d1117',
};
const ITEM_MAIN: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  flex: 1,
};
const ITEM_ACTIONS: React.CSSProperties = { display: 'flex', gap: 8 };
const LINK_TITLE: React.CSSProperties = { fontSize: 14, color: '#58a6ff', textDecoration: 'none' };
const DESC = { fontSize: 12, color: '#8b949e' };
const DIR = { fontSize: 11, color: '#6e7681', fontFamily: 'ui-monospace, monospace' };
const CB_SUMMARY = { fontSize: 11, color: '#6e7681' };
const MUTED = { color: '#8b949e', fontSize: 13, padding: 24 };
const ERROR = {
  color: '#f85149',
  fontSize: 12,
  padding: '6px 8px',
  border: '1px solid #6e2130',
  borderRadius: 6,
  background: '#2b1419',
  marginBottom: 12,
};
const LINK: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: '#58a6ff',
  fontSize: 12,
  cursor: 'pointer',
  textDecoration: 'underline',
  padding: 0,
};
const CANCEL_BTN: React.CSSProperties = {
  background: '#21262d',
  color: '#e6edf3',
  border: '1px solid #30363d',
  borderRadius: 6,
  padding: '6px 12px',
  fontSize: 12,
  cursor: 'pointer',
};
const PRIMARY_BTN: React.CSSProperties = {
  ...CANCEL_BTN,
  background: '#238636',
  color: '#fff',
  border: '1px solid #2ea043',
};
