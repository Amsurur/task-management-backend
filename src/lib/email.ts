// Email sending utility.
//
// In dev/test the invite details are logged to stdout so tokens are visible
// without needing an SMTP server. In production, wire up a real transport here
// (nodemailer, Resend, SendGrid, etc.).

import { config } from '../config/index.js';

export interface InviteEmailPayload {
  to: string;
  workspaceName: string;
  inviterName: string;
  inviteUrl: string;
  expiresAt: Date;
}

export async function sendInviteEmail(payload: InviteEmailPayload): Promise<void> {
  if (config.NODE_ENV !== 'production') {
    // eslint-disable-next-line no-console
    console.info(
      [
        '',
        '┌─ [EMAIL STUB] Workspace Invite ─────────────────────────────',
        `│ To:         ${payload.to}`,
        `│ Workspace:  ${payload.workspaceName}`,
        `│ Invited by: ${payload.inviterName}`,
        `│ Accept URL: ${payload.inviteUrl}`,
        `│ Expires:    ${payload.expiresAt.toISOString()}`,
        '└─────────────────────────────────────────────────────────────',
        '',
      ].join('\n'),
    );
    return;
  }

  // Production: replace with a real provider (nodemailer, Resend, etc.)
  throw new Error(
    'Email sending is not configured. Set SMTP_* environment variables and implement sendInviteEmail.',
  );
}
