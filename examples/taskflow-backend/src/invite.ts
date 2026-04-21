import { sendMail } from './mailer';

// チーム招待: プロジェクト管理者が新規メンバーを招待するための最小実装。
// Phase 5a 手動 E2E の「UC → 関連コード探索」対象として Grep / Read で辿れる粒度を提供する。
export interface InviteRequest {
  projectId: string;
  inviterUserId: string;
  email: string;
}

export interface InviteRecord extends InviteRequest {
  id: string;
  token: string;
  createdAt: string;
  acceptedAt?: string;
}

export async function createInvite(req: InviteRequest): Promise<InviteRecord> {
  const token = generateInviteToken();
  const record: InviteRecord = {
    id: `inv-${Date.now()}`,
    token,
    createdAt: new Date().toISOString(),
    ...req,
  };
  await sendMail({
    to: req.email,
    subject: 'TaskFlow への招待',
    body: `以下のリンクから参加してください: https://taskflow.example/invite/${token}`,
  });
  return record;
}

function generateInviteToken(): string {
  // MVP: 衝突確率は現実的に十分低い。乱数源は将来 crypto.randomBytes に差し替える想定。
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}

export async function acceptInvite(token: string): Promise<{ ok: boolean }> {
  // TODO: トークンから招待レコードを引き、ユーザーをプロジェクトに追加する。
  void token;
  return { ok: true };
}
