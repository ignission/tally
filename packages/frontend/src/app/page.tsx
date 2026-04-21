import Link from 'next/link';

import { NewProjectButton } from '@/components/header/new-project-button';
import { discoverProjects } from '@/lib/project-resolver';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const projects = await discoverProjects();

  return (
    <main
      style={{
        minHeight: '100vh',
        padding: '64px 48px',
        background: '#0d1117',
        color: '#e6edf3',
        fontFamily:
          "system-ui, -apple-system, 'Segoe UI', 'Hiragino Sans', 'Yu Gothic UI', sans-serif",
      }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 12,
          marginBottom: 32,
        }}
      >
        <h1 style={{ fontSize: 40, margin: 0, letterSpacing: '-0.02em' }}>Tally</h1>
        <span style={{ color: '#8b949e', fontSize: 14 }}>プロジェクト一覧</span>
        <div style={{ marginLeft: 'auto' }}>
          <NewProjectButton />
        </div>
      </header>

      {projects.length === 0 ? (
        <EmptyState />
      ) : (
        <ul
          style={{
            listStyle: 'none',
            margin: 0,
            padding: 0,
            display: 'grid',
            gap: 12,
            maxWidth: 720,
          }}
        >
          {projects.map((p) => (
            <li key={p.workspaceRoot}>
              <Link
                href={`/projects/${encodeURIComponent(p.id)}`}
                style={{
                  display: 'block',
                  padding: 16,
                  borderRadius: 10,
                  border: '1px solid #30363d',
                  background: '#161b22',
                  color: 'inherit',
                  textDecoration: 'none',
                }}
              >
                <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>{p.meta.name}</div>
                {p.meta.description && (
                  <div style={{ fontSize: 13, color: '#c8d1da', whiteSpace: 'pre-wrap' }}>
                    {p.meta.description}
                  </div>
                )}
                <div
                  style={{
                    marginTop: 8,
                    fontSize: 11,
                    color: '#8b949e',
                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                  }}
                >
                  {p.workspaceRoot}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

function EmptyState() {
  return (
    <section
      style={{
        maxWidth: 720,
        padding: 24,
        borderRadius: 12,
        border: '1px dashed #30363d',
        background: '#161b22',
      }}
    >
      <h2 style={{ margin: 0, fontSize: 18, color: '#8b949e' }}>プロジェクトが見つかりません</h2>
      <p style={{ marginTop: 12, lineHeight: 1.7 }}>
        Tally は以下のいずれかから <code>.tally/</code> ディレクトリを探します:
      </p>
      <ul style={{ lineHeight: 1.8, margin: 0 }}>
        <li>
          環境変数 <code>TALLY_WORKSPACE</code> で指定されたディレクトリ (自身 or
          直下のサブディレクトリ)
        </li>
        <li>
          <code>ghq list -p</code> で列挙される全リポジトリ
        </li>
      </ul>
      <p style={{ marginTop: 12, fontSize: 12, color: '#8b949e' }}>
        サンプルを動かす場合: <code>TALLY_WORKSPACE=./examples</code> で dev を起動。
      </p>
    </section>
  );
}
