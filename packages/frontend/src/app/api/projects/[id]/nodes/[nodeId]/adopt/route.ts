import type { AdoptableType } from '@tally/core';
import { FileSystemProjectStore } from '@tally/storage';
import { NextResponse } from 'next/server';

import { resolveProjectById } from '@/lib/project-resolver';

interface RouteContext {
  params: Promise<{ id: string; nodeId: string }>;
}

// proposal → 採用可能 NodeType の集合 (proposal 自身は除外)。
const ADOPTABLE_TYPES: readonly AdoptableType[] = [
  'requirement',
  'usecase',
  'userstory',
  'question',
  'coderef',
  'issue',
];

function isAdoptable(v: unknown): v is AdoptableType {
  return typeof v === 'string' && (ADOPTABLE_TYPES as readonly string[]).includes(v);
}

export async function POST(req: Request, context: RouteContext): Promise<NextResponse> {
  const { id, nodeId } = await context.params;
  const handle = await resolveProjectById(id);
  if (!handle) return NextResponse.json({ error: 'project not found', id }, { status: 404 });

  const raw = await req.json().catch(() => null);
  if (raw === null || typeof raw !== 'object') {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }
  const { adoptAs, additional } = raw as { adoptAs?: unknown; additional?: unknown };
  if (!isAdoptable(adoptAs)) {
    return NextResponse.json({ error: 'invalid adoptAs' }, { status: 400 });
  }
  const extra =
    additional && typeof additional === 'object' ? (additional as Record<string, unknown>) : {};

  const store = new FileSystemProjectStore(handle.workspaceRoot);
  const exists = await store.getNode(nodeId);
  if (!exists) return NextResponse.json({ error: 'node not found' }, { status: 404 });
  try {
    const adopted = await store.transmuteNode(nodeId, adoptAs, extra);
    return NextResponse.json(adopted);
  } catch (err) {
    // storage 側は `proposal 以外は採用対象外` / `存在しないノード` を throw するが、
    // この時点で getNode は通っているので前者のみ発生し得る。スキーマ違反も同じく 400。
    return NextResponse.json({ error: String(err) }, { status: 400 });
  }
}
