import { unregisterProject } from '@tally/storage';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await ctx.params;
  await unregisterProject(id);
  return new NextResponse(null, { status: 204 });
}
