// メール送信のダミー。実運用では SES / SendGrid 等に差し替える。
export interface MailPayload {
  to: string;
  subject: string;
  body: string;
}

export async function sendMail(payload: MailPayload): Promise<void> {
  console.log('[mailer] sending mail to', payload.to, 'subject:', payload.subject);
}
