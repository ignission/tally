import { listWorkspaceCandidates } from '@tally/storage';
import { NextResponse } from 'next/server';

// 新規プロジェクトダイアログで使う workspaceRoot 候補一覧。
// ghq list -p + TALLY_WORKSPACE 配下のディレクトリを、hasTally フラグ付きで返す。
export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  const candidates = await listWorkspaceCandidates();
  return NextResponse.json({ candidates });
}
