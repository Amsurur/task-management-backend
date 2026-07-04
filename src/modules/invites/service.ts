import { randomBytes } from 'node:crypto';
import type { PrismaClient, WorkspaceInvite } from '@prisma/client';
import { AppError } from '../../lib/errors.js';
import { sendInviteEmail } from '../../lib/email.js';
import { config } from '../../config/index.js';
import type { CreateInviteBody } from './schema.js';

/** How long an invite stays valid before it must be re-issued. */
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export type InviteWithUrl = WorkspaceInvite & { accept_url: string };

/** Outcome of a magic-link accept attempt, consumed by the HTML renderer. */
export type AcceptResult =
  | { outcome: 'invalid' }
  | { outcome: 'expired' }
  | { outcome: 'revoked' }
  | { outcome: 'needs_registration'; email: string; workspaceName: string }
  | { outcome: 'already_member'; workspaceName: string; workspaceSlug: string }
  | { outcome: 'joined'; workspaceName: string; workspaceSlug: string };

function generateToken(): string {
  // 32 random bytes → 43-char URL-safe string. Opaque; only meaningful as a
  // lookup key on WorkspaceInvite.token.
  return randomBytes(32).toString('base64url');
}

/**
 * Build the invite link the recipient receives by email. It points at the
 * frontend SPA (`/invite/<token>`), which shows the invitation and lets the
 * person register or accept — landing them in the actual app, not a backend page.
 */
export function buildAcceptUrl(token: string): string {
  return `${config.FRONTEND_URL.replace(/\/$/, '')}/invite/${token}`;
}

/** Invite details the frontend renders on its `/invite/:token` page. */
export interface InviteInfo {
  status: 'pending' | 'accepted' | 'expired' | 'revoked' | 'invalid';
  email?: string;
  role?: string;
  expired?: boolean;
  workspace?: { name: string; slug: string };
  inviter_name?: string;
}

/** Look up an invite by its opaque token (public — the token is the credential). */
export async function getInviteByToken(prisma: PrismaClient, token: string): Promise<InviteInfo> {
  const invite = await prisma.workspaceInvite.findUnique({
    where: { token },
    include: { workspace: true, invited_by: { select: { display_name: true } } },
  });
  if (!invite) return { status: 'invalid' };

  const expired = invite.expires_at < new Date();
  const status = expired && invite.status === 'pending' ? 'expired' : invite.status;
  return {
    status,
    email: invite.email,
    role: invite.role,
    expired,
    workspace: { name: invite.workspace.name, slug: invite.workspace.slug },
    inviter_name: invite.invited_by.display_name,
  };
}

/**
 * Accept an invite as the currently-authenticated user (used by the frontend
 * after login/registration). The user's email must match the invite's email, so
 * you can't hijack an invitation sent to someone else. Idempotent.
 */
export async function acceptInviteForUser(
  prisma: PrismaClient,
  userId: string,
  token: string,
): Promise<{ workspaceSlug: string; workspaceName: string }> {
  const invite = await prisma.workspaceInvite.findUnique({
    where: { token },
    include: { workspace: true },
  });
  if (!invite) throw AppError.notFound('Invite not found');
  if (invite.status === 'revoked') throw AppError.gone('This invitation has been revoked');
  if (invite.status !== 'accepted' && invite.expires_at < new Date()) {
    if (invite.status === 'pending') {
      await prisma.workspaceInvite.update({ where: { id: invite.id }, data: { status: 'expired' } });
    }
    throw AppError.gone('This invitation has expired');
  }

  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (user.email.toLowerCase() !== invite.email.toLowerCase()) {
    throw AppError.forbidden('This invitation was sent to a different email address');
  }

  const existing = await prisma.workspaceMember.findUnique({
    where: { workspace_id_user_id: { workspace_id: invite.workspace_id, user_id: userId } },
  });
  if (!existing) {
    await prisma.$transaction([
      prisma.workspaceMember.create({
        data: { workspace_id: invite.workspace_id, user_id: userId, role: invite.role },
      }),
      prisma.workspaceInvite.update({
        where: { id: invite.id },
        data: { status: 'accepted', accepted_at: new Date() },
      }),
    ]);
  } else if (invite.status !== 'accepted') {
    await prisma.workspaceInvite.update({
      where: { id: invite.id },
      data: { status: 'accepted', accepted_at: new Date() },
    });
  }

  return { workspaceSlug: invite.workspace.slug, workspaceName: invite.workspace.name };
}

export async function createInvite(
  prisma: PrismaClient,
  workspaceId: string,
  invitedById: string,
  body: CreateInviteBody,
): Promise<InviteWithUrl> {
  const email = body.email.toLowerCase();

  // If a user with this email already belongs to the workspace, there's nothing
  // to invite.
  const existingUser = await prisma.user.findUnique({ where: { email } });
  if (existingUser) {
    const membership = await prisma.workspaceMember.findUnique({
      where: { workspace_id_user_id: { workspace_id: workspaceId, user_id: existingUser.id } },
    });
    if (membership) throw AppError.conflict('That user is already a member of this workspace');
  }

  const [workspace, inviter] = await Promise.all([
    prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId } }),
    prisma.user.findUniqueOrThrow({ where: { id: invitedById } }),
  ]);

  const token = generateToken();
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS);

  // Reuse a pending invite for the same (workspace, email) rather than piling up
  // duplicates — regenerate its token and expiry (i.e. "resend").
  const pending = await prisma.workspaceInvite.findFirst({
    where: { workspace_id: workspaceId, email, status: 'pending' },
  });

  const invite = pending
    ? await prisma.workspaceInvite.update({
        where: { id: pending.id },
        data: {
          role: body.role,
          token,
          expires_at: expiresAt,
          invited_by_id: invitedById,
        },
      })
    : await prisma.workspaceInvite.create({
        data: {
          workspace_id: workspaceId,
          email,
          role: body.role,
          token,
          invited_by_id: invitedById,
          expires_at: expiresAt,
        },
      });

  const acceptUrl = buildAcceptUrl(token);
  await sendInviteEmail({
    to: email,
    workspaceName: workspace.name,
    inviterName: inviter.display_name,
    acceptUrl,
    role: body.role,
  });

  return { ...invite, accept_url: acceptUrl };
}

export async function listInvites(
  prisma: PrismaClient,
  workspaceId: string,
): Promise<WorkspaceInvite[]> {
  return prisma.workspaceInvite.findMany({
    where: { workspace_id: workspaceId },
    orderBy: { created_at: 'desc' },
  });
}

export async function revokeInvite(
  prisma: PrismaClient,
  workspaceId: string,
  inviteId: string,
): Promise<void> {
  const invite = await prisma.workspaceInvite.findFirst({
    where: { id: inviteId, workspace_id: workspaceId },
  });
  if (!invite) throw AppError.notFound('Invite not found');
  if (invite.status !== 'pending') {
    throw AppError.conflict('Only pending invites can be revoked');
  }
  await prisma.workspaceInvite.update({
    where: { id: inviteId },
    data: { status: 'revoked' },
  });
}

/**
 * Consume an invite for a freshly-registered user. Called from the auth
 * `register` flow after the invite has already been validated (exists, pending,
 * unexpired, email matches). Adds the user to the workspace and marks the invite
 * accepted. Idempotent on membership: if the user is somehow already a member we
 * only flip the invite status.
 */
export async function acceptInviteAfterRegister(
  prisma: PrismaClient,
  token: string,
  userId: string,
): Promise<void> {
  const invite = await prisma.workspaceInvite.findUnique({ where: { token } });
  if (!invite) throw AppError.notFound('Invite not found');
  if (invite.status !== 'pending') {
    throw AppError.conflict('Invite is no longer pending');
  }

  const existingMembership = await prisma.workspaceMember.findUnique({
    where: { workspace_id_user_id: { workspace_id: invite.workspace_id, user_id: userId } },
  });

  if (existingMembership) {
    await prisma.workspaceInvite.update({
      where: { id: invite.id },
      data: { status: 'accepted', accepted_at: new Date() },
    });
    return;
  }

  await prisma.$transaction([
    prisma.workspaceMember.create({
      data: { workspace_id: invite.workspace_id, user_id: userId, role: invite.role },
    }),
    prisma.workspaceInvite.update({
      where: { id: invite.id },
      data: { status: 'accepted', accepted_at: new Date() },
    }),
  ]);
}

/**
 * Magic-link accept. Public (no auth): the token is the credential. Resolves the
 * invitee by the invite's email and, if they have a registered account, adds
 * them to the workspace. Returns a discriminated result the route renders as an
 * HTML confirmation page. Never throws for expected states — it returns them.
 */
export async function acceptInvite(prisma: PrismaClient, token: string): Promise<AcceptResult> {
  const invite = await prisma.workspaceInvite.findUnique({
    where: { token },
    include: { workspace: true },
  });

  if (!invite) return { outcome: 'invalid' };
  if (invite.status === 'revoked') return { outcome: 'revoked' };
  if (invite.status === 'accepted') {
    // Idempotent: an already-accepted invite just reports membership.
    return {
      outcome: 'already_member',
      workspaceName: invite.workspace.name,
      workspaceSlug: invite.workspace.slug,
    };
  }
  if (invite.expires_at < new Date()) {
    if (invite.status === 'pending') {
      await prisma.workspaceInvite.update({
        where: { id: invite.id },
        data: { status: 'expired' },
      });
    }
    return { outcome: 'expired' };
  }

  const user = await prisma.user.findUnique({ where: { email: invite.email } });
  if (!user) {
    // No account yet — the invite stays pending so it works after they register.
    return {
      outcome: 'needs_registration',
      email: invite.email,
      workspaceName: invite.workspace.name,
    };
  }

  const existingMembership = await prisma.workspaceMember.findUnique({
    where: { workspace_id_user_id: { workspace_id: invite.workspace_id, user_id: user.id } },
  });

  if (existingMembership) {
    await prisma.workspaceInvite.update({
      where: { id: invite.id },
      data: { status: 'accepted', accepted_at: new Date() },
    });
    return {
      outcome: 'already_member',
      workspaceName: invite.workspace.name,
      workspaceSlug: invite.workspace.slug,
    };
  }

  await prisma.$transaction([
    prisma.workspaceMember.create({
      data: { workspace_id: invite.workspace_id, user_id: user.id, role: invite.role },
    }),
    prisma.workspaceInvite.update({
      where: { id: invite.id },
      data: { status: 'accepted', accepted_at: new Date() },
    }),
  ]);

  return {
    outcome: 'joined',
    workspaceName: invite.workspace.name,
    workspaceSlug: invite.workspace.slug,
  };
}
