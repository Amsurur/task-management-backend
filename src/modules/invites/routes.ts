import type { FastifyInstance } from 'fastify';
import { authenticate } from '../../plugins/auth-hook.js';
import { requireWorkspaceMember } from '../../plugins/workspace-hook.js';
import {
  createInviteSchema,
  listInvitesSchema,
  revokeInviteSchema,
  acceptInviteSchema,
  getInviteInfoSchema,
  acceptInvitePostSchema,
} from './schema.js';
import {
  createInviteHandler,
  listInvitesHandler,
  revokeInviteHandler,
  acceptInviteHandler,
  getInviteInfoHandler,
  acceptInvitePostHandler,
} from './controller.js';

/**
 * Workspace-scoped invite management (admin+). Registered under
 * `/api/v1/workspaces/:workspaceSlug/invites`.
 */
export async function workspaceInviteRoutes(app: FastifyInstance): Promise<void> {
  const admin = [authenticate, requireWorkspaceMember('admin')];

  app.post('/', { schema: createInviteSchema, preHandler: admin }, createInviteHandler);
  app.get('/', { schema: listInvitesSchema, preHandler: admin }, listInvitesHandler);
  app.delete('/:inviteId', { schema: revokeInviteSchema, preHandler: admin }, revokeInviteHandler);
}

/**
 * Public magic-link accept endpoint. No auth: the opaque token is the
 * credential. Registered under `/api/v1/invites`.
 */
export async function publicInviteRoutes(app: FastifyInstance): Promise<void> {
  // Frontend fetches invite details to render its /invite/:token page.
  app.get('/:token', { schema: getInviteInfoSchema }, getInviteInfoHandler);
  // Legacy browser magic-link (opens an HTML confirmation page directly).
  app.get('/:token/accept', { schema: acceptInviteSchema }, acceptInviteHandler);
  // Frontend calls this (with the user's token) after login/registration to join.
  app.post(
    '/:token/accept',
    { schema: acceptInvitePostSchema, preHandler: [authenticate] },
    acceptInvitePostHandler,
  );
}
