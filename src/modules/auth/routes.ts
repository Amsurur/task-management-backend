import type { FastifyInstance } from 'fastify';
import { authenticate } from '../../plugins/auth-hook.js';
import {
  registerRouteSchema,
  loginRouteSchema,
  refreshRouteSchema,
  logoutRouteSchema,
  getMeRouteSchema,
  updateMeRouteSchema,
  emailSignupRouteSchema,
  emailVerifyRouteSchema,
  emailLoginRouteSchema,
} from './schema.js';
import {
  registerHandler,
  loginHandler,
  refreshHandler,
  logoutHandler,
  getMeHandler,
  updateMeHandler,
  emailSignupHandler,
  emailVerifyHandler,
} from './controller.js';

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post('/register', { schema: registerRouteSchema }, registerHandler);
  app.post('/login', { schema: loginRouteSchema }, loginHandler);
  // Email + password with OTP verification (auth_tz.md §6).
  app.post('/email/signup', { schema: emailSignupRouteSchema }, emailSignupHandler);
  app.post('/email/verify', { schema: emailVerifyRouteSchema }, emailVerifyHandler);
  app.post('/email/login', { schema: emailLoginRouteSchema }, loginHandler);
  app.post('/refresh', { schema: refreshRouteSchema }, refreshHandler);
  app.post('/logout', { schema: logoutRouteSchema }, logoutHandler);
  app.get('/me', { schema: getMeRouteSchema, preHandler: [authenticate] }, getMeHandler);
  app.patch('/me', { schema: updateMeRouteSchema, preHandler: [authenticate] }, updateMeHandler);
}
