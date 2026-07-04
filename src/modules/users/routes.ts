import type { FastifyInstance } from 'fastify';
import { authenticate } from '../../plugins/auth-hook.js';
import { listUsersSchema, getUserProfileSchema, presenceSchema } from './schema.js';
import { listUsersHandler, getUserProfileHandler, presenceHandler } from './controller.js';

/** Users directory + public profiles — `/api/v1/users`. Auth only. */
export async function userRoutes(app: FastifyInstance): Promise<void> {
  const auth = [authenticate];
  app.get('/', { schema: listUsersSchema, preHandler: auth }, listUsersHandler);
  // Static route before `/:userId` so "presence" isn't captured as a user id.
  app.get('/presence', { schema: presenceSchema, preHandler: auth }, presenceHandler);
  app.get('/:userId', { schema: getUserProfileSchema, preHandler: auth }, getUserProfileHandler);
}
