import { FileSystemProjectStore, listProjects, touchProject } from '@tally/storage';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ProjectHeaderActions } from '@/components/header/project-header-actions';

import { CanvasClient } from './canvas-client';

async function loadProjectById(id: string) {
  const list = await listProjects();
  const entry = list.find((p) => p.id === id);
  if (!entry) return null;
  const store = new FileSystemProjectStore(entry.path);
  const project = await store.loadProject();
  if (project) await touchProject(id);
  return project;
}

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function ProjectPage({ params }: PageProps) {
  const { id } = await params;
  const project = await loadProjectById(decodeURIComponent(id));
  if (!project) notFound();

  return (
    <main
      style={{
        height: '100vh',
        width: '100vw',
        display: 'flex',
        flexDirection: 'column',
        background: '#0d1117',
        color: '#e6edf3',
        fontFamily:
          "system-ui, -apple-system, 'Segoe UI', 'Hiragino Sans', 'Yu Gothic UI', sans-serif",
      }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          padding: '12px 20px',
          borderBottom: '1px solid #30363d',
          background: '#0d1117',
        }}
      >
        <Link href="/" style={{ color: '#8b949e', textDecoration: 'none', fontSize: 13 }}>
          ← プロジェクト一覧
        </Link>
        <h1 style={{ fontSize: 18, margin: 0, fontWeight: 700 }}>{project.name}</h1>
        <span style={{ color: '#8b949e', fontSize: 12 }}>
          ノード {project.nodes.length} / エッジ {project.edges.length}
        </span>
        <ProjectHeaderActions />
      </header>
      <div style={{ flex: 1, minHeight: 0 }}>
        <CanvasClient project={project} />
      </div>
    </main>
  );
}
