import type { FastifyInstance } from 'fastify';
import { authenticate } from '../../plugins/auth-hook.js';
import { getInviteSchema, acceptInviteSchema } from './schema.js';
import { getInviteHandler, acceptInviteHandler } from './controller.js';

export async function inviteRoutes(app: FastifyInstance): Promise<void> {
  // Public — no auth required to inspect an invite before deciding to register/login.
  app.get('/:token', { schema: getInviteSchema }, getInviteHandler);

  // Auth required — the accepting user must be logged in.
  app.post(
    '/:token/accept',
    { schema: acceptInviteSchema, preHandler: [authenticate] },
    acceptInviteHandler,
  );
}
