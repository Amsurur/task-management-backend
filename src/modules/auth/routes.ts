import type { FastifyInstance } from 'fastify';
import { authenticate } from '../../plugins/auth-hook.js';
import {
  registerRouteSchema,
  loginRouteSchema,
  refreshRouteSchema,
  logoutRouteSchema,
  getMeRouteSchema,
  updateMeRouteSchema,
  changePasswordRouteSchema,
} from './schema.js';
import {
  registerHandler,
  loginHandler,
  refreshHandler,
  logoutHandler,
  getMeHandler,
  updateMeHandler,
  changePasswordHandler,
} from './controller.js';

export async function authRoutes(app: FastifyInstance): Promise<void> {
  // Brute-force-sensitive endpoints get a strict per-IP limit (see app.ts for the global default).
  const strictLimit = { rateLimit: { max: 10, timeWindow: '1 minute' } };

  app.post('/register', { schema: registerRouteSchema, config: strictLimit }, registerHandler);
  app.post('/login', { schema: loginRouteSchema, config: strictLimit }, loginHandler);
  app.post('/refresh', { schema: refreshRouteSchema, config: strictLimit }, refreshHandler);
  app.post('/logout', { schema: logoutRouteSchema }, logoutHandler);
  app.get('/me', { schema: getMeRouteSchema, preHandler: [authenticate] }, getMeHandler);
  app.patch('/me', { schema: updateMeRouteSchema, preHandler: [authenticate] }, updateMeHandler);
  app.post(
    '/change-password',
    { schema: changePasswordRouteSchema, config: strictLimit, preHandler: [authenticate] },
    changePasswordHandler,
  );
}
