import { z } from 'zod';
import type { FastifySchema } from 'fastify';

// ─── Zod validators ───────────────────────────────────────────────────────────

export const CreateInviteBodySchema = z.object({
  email: z.string().email(),
  role: z.enum(['admin', 'member', 'guest']).default('member'),
});

export type CreateInviteBody = z.infer<typeof CreateInviteBodySchema>;

// ─── Fastify route schemas ────────────────────────────────────────────────────

const inviteShape = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    workspace_id: { type: 'string' },
    email: { type: 'string' },
    role: { type: 'string', enum: ['owner', 'admin', 'member', 'guest'] },
    status: { type: 'string', enum: ['pending', 'accepted', 'expired', 'revoked'] },
    invited_by_id: { type: 'string' },
    expires_at: { type: 'string', format: 'date-time' },
    accepted_at: { type: 'string', format: 'date-time', nullable: true },
    created_at: { type: 'string', format: 'date-time' },
    // Only returned on create — the absolute magic-link the invitee receives.
    accept_url: { type: 'string' },
  },
} as const;

const security = [{ bearerAuth: [] }];

export const createInviteSchema: FastifySchema = {
  tags: ['Invites'],
  summary: 'Invite a user to the workspace by email (admin+). Sends a magic-link email.',
  security,
  params: { type: 'object', properties: { workspaceSlug: { type: 'string' } } },
  body: {
    type: 'object',
    required: ['email'],
    properties: {
      email: { type: 'string', format: 'email' },
      role: { type: 'string', enum: ['admin', 'member', 'guest'] },
    },
  },
  response: { 201: inviteShape },
};

export const listInvitesSchema: FastifySchema = {
  tags: ['Invites'],
  summary: 'List invites for the workspace (admin+)',
  security,
  params: { type: 'object', properties: { workspaceSlug: { type: 'string' } } },
  response: { 200: { type: 'array', items: inviteShape } },
};

export const revokeInviteSchema: FastifySchema = {
  tags: ['Invites'],
  summary: 'Revoke a pending invite (admin+)',
  security,
  params: {
    type: 'object',
    properties: { workspaceSlug: { type: 'string' }, inviteId: { type: 'string' } },
  },
  response: { 204: { type: 'null' } },
};

// Public magic-link accept endpoint — returns an HTML confirmation page,
// so no JSON response schema is declared (Fastify serializes the raw string).
export const acceptInviteSchema: FastifySchema = {
  tags: ['Invites'],
  summary: 'Accept a workspace invite via magic-link (public). Returns an HTML page.',
  params: { type: 'object', properties: { token: { type: 'string' } } },
};
