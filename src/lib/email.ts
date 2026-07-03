// Email delivery.
//
// A thin wrapper over nodemailer for the one transactional email the MVP sends:
// the workspace invite (magic-link). Behaviour is driven entirely by the SMTP_*
// config validated at boot:
//
//   • SMTP_HOST set     → a real email is sent via nodemailer.
//   • SMTP_HOST unset in dev/test → the message is printed to the console so the
//     link is still testable without a mail server.
//   • SMTP_HOST unset in production → we throw, so a missing config surfaces
//     loudly instead of silently dropping invites.

import nodemailer, { type Transporter } from 'nodemailer';
import { config, isProd } from '../config/index.js';

export interface InviteEmailParams {
  /** Recipient email address. */
  to: string;
  /** Human-readable workspace name the invitee is being added to. */
  workspaceName: string;
  /** Display name of the member who created the invite. */
  inviterName: string;
  /** Absolute magic-link URL the recipient clicks to accept. */
  acceptUrl: string;
  /** Role the invitee will receive on acceptance. */
  role: string;
}

// Lazily created and memoized. `undefined` = not yet initialized;
// `null` = initialized and SMTP is not configured.
let cachedTransporter: Transporter | null | undefined;

function getTransporter(): Transporter | null {
  if (cachedTransporter !== undefined) return cachedTransporter;

  if (!config.SMTP_HOST) {
    cachedTransporter = null;
    return null;
  }

  cachedTransporter = nodemailer.createTransport({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    secure: config.SMTP_SECURE,
    auth:
      config.SMTP_USER && config.SMTP_PASS
        ? { user: config.SMTP_USER, pass: config.SMTP_PASS }
        : undefined,
  });
  return cachedTransporter;
}

/** True when a real mail transport is configured. */
export function isEmailConfigured(): boolean {
  return Boolean(config.SMTP_HOST);
}

function renderInviteEmail(params: InviteEmailParams): {
  subject: string;
  html: string;
  text: string;
} {
  const subject = `You've been invited to join "${params.workspaceName}"`;

  const text =
    `${params.inviterName} invited you to join the "${params.workspaceName}" workspace ` +
    `as ${params.role}.\n\n` +
    `Accept the invitation by opening this link:\n${params.acceptUrl}\n\n` +
    `If you weren't expecting this, you can safely ignore this email.`;

  const html = `<!doctype html>
<html>
  <body style="font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; color: #1f2937; line-height: 1.5;">
    <h2 style="margin: 0 0 12px;">You've been invited 🎉</h2>
    <p><strong>${escapeHtml(params.inviterName)}</strong> invited you to join the
      <strong>${escapeHtml(params.workspaceName)}</strong> workspace as
      <strong>${escapeHtml(params.role)}</strong>.</p>
    <p style="margin: 24px 0;">
      <a href="${escapeHtml(params.acceptUrl)}"
         style="background: #4f46e5; color: #fff; padding: 12px 20px; border-radius: 8px; text-decoration: none; display: inline-block;">
        Accept invitation
      </a>
    </p>
    <p style="color: #6b7280; font-size: 13px;">Or paste this link into your browser:<br>
      <a href="${escapeHtml(params.acceptUrl)}">${escapeHtml(params.acceptUrl)}</a></p>
    <p style="color: #9ca3af; font-size: 12px;">If you weren't expecting this, you can safely ignore this email.</p>
  </body>
</html>`;

  return { subject, html, text };
}

/**
 * Send a workspace invite email. See the module header for the SMTP/dev/prod
 * behaviour matrix.
 */
export async function sendInviteEmail(params: InviteEmailParams): Promise<void> {
  const { subject, html, text } = renderInviteEmail(params);
  const transporter = getTransporter();

  if (transporter) {
    const from = config.SMTP_FROM ?? config.SMTP_USER ?? 'no-reply@localhost';
    await transporter.sendMail({ from, to: params.to, subject, html, text });
    return;
  }

  if (isProd) {
    throw new Error(
      'Cannot send invite email: SMTP is not configured (set SMTP_HOST and related SMTP_* env vars).',
    );
  }

  // Dev/test: no mail server — print the essentials so the flow stays testable.
  // eslint-disable-next-line no-console
  console.info(
    `\n──────── [email:dev] ────────\nTo:      ${params.to}\nSubject: ${subject}\n${text}\n─────────────────────────────\n`,
  );
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
