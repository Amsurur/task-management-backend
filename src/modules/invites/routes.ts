import type { FastifyInstance } from 'fastify';
import { authenticate } from '../../plugins/auth-hook.js';
import { requireWorkspaceMember } from '../../plugins/workspace-hook.js';
import {
  createInviteSchema,
  listInvitesSchema,
  revokeInviteSchema,
  acceptInviteSchema,
} from './schema.js';
import {
  createInviteHandler,
  listInvitesHandler,
  revokeInviteHandler,
  acceptInviteHandler,
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
  app.get('/:token/accept', { schema: acceptInviteSchema }, acceptInviteHandler);
}
