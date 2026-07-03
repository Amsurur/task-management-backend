import type { FastifyInstance } from 'fastify';
import { authenticate } from '../../plugins/auth-hook.js';
import { listUsersSchema, getUserProfileSchema } from './schema.js';
import { listUsersHandler, getUserProfileHandler } from './controller.js';

/** Users directory + public profiles — `/api/v1/users`. Auth only. */
export async function userRoutes(app: FastifyInstance): Promise<void> {
  const auth = [authenticate];
  app.get('/', { schema: listUsersSchema, preHandler: auth }, listUsersHandler);
  app.get('/:userId', { schema: getUserProfileSchema, preHandler: auth }, getUserProfileHandler);
}
