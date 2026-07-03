import type { FastifyRequest, FastifyReply } from 'fastify';
import * as inviteService from './service.js';
import type { AcceptResult } from './service.js';
import { CreateInviteBodySchema } from './schema.js';

export async function createInviteHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const body = CreateInviteBodySchema.parse(request.body);
  const invite = await inviteService.createInvite(
    request.server.prisma,
    request.workspace.id,
    request.userId,
    body,
  );
  reply.code(201).send(invite);
}

export async function listInvitesHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const invites = await inviteService.listInvites(request.server.prisma, request.workspace.id);
  reply.send(invites);
}

export async function revokeInviteHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const { inviteId } = request.params as { inviteId: string };
  await inviteService.revokeInvite(request.server.prisma, request.workspace.id, inviteId);
  reply.code(204).send();
}

// Public magic-link endpoint — renders a human-facing HTML confirmation page
// rather than JSON, since the recipient opens this URL directly in a browser.
export async function acceptInviteHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const { token } = request.params as { token: string };
  const result = await inviteService.acceptInvite(request.server.prisma, token);
  const { status, html } = renderAcceptPage(result);
  reply.code(status).type('text/html; charset=utf-8').send(html);
}

function renderAcceptPage(result: AcceptResult): { status: number; html: string } {
  let status = 200;
  let heading: string;
  let message: string;
  let tone: 'ok' | 'warn' | 'error' = 'ok';

  switch (result.outcome) {
    case 'joined':
      heading = "🎉 You're in!";
      message = `You have joined the <strong>${escapeHtml(result.workspaceName)}</strong> workspace. You can now sign in and start collaborating.`;
      break;
    case 'already_member':
      heading = '✅ Already a member';
      message = `You are already a member of the <strong>${escapeHtml(result.workspaceName)}</strong> workspace. Just sign in to continue.`;
      break;
    case 'needs_registration':
      heading = '📝 One more step';
      message = `You've been invited to <strong>${escapeHtml(result.workspaceName)}</strong>. Create an account with <strong>${escapeHtml(result.email)}</strong> first, then open this link again to join automatically.`;
      tone = 'warn';
      break;
    case 'expired':
      status = 410;
      heading = '⌛ Invitation expired';
      message = 'This invitation has expired. Ask a workspace admin to send you a new one.';
      tone = 'warn';
      break;
    case 'revoked':
      status = 410;
      heading = '🚫 Invitation revoked';
      message = 'This invitation has been revoked and can no longer be used.';
      tone = 'error';
      break;
    case 'invalid':
    default:
      status = 404;
      heading = '❔ Invalid invitation';
      message =
        'This invitation link is not valid. Please double-check the link or request a new invite.';
      tone = 'error';
      break;
  }

  const accent = tone === 'ok' ? '#16a34a' : tone === 'warn' ? '#d97706' : '#dc2626';

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(stripTags(heading))}</title>
  </head>
  <body style="margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center; background:#f3f4f6; font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;">
    <main style="max-width:440px; background:#fff; border-radius:16px; padding:40px; box-shadow:0 10px 30px rgba(0,0,0,0.08); border-top:4px solid ${accent};">
      <h1 style="margin:0 0 12px; font-size:24px; color:#111827;">${heading}</h1>
      <p style="margin:0; color:#4b5563; line-height:1.6;">${message}</p>
    </main>
  </body>
</html>`;

  return { status, html };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function stripTags(value: string): string {
  return value.replace(/<[^>]*>/g, '');
}
