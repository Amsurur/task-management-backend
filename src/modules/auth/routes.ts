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
  googleRedirectRouteSchema,
  googleCallbackRouteSchema,
  githubRedirectRouteSchema,
  githubCallbackRouteSchema,
  telegramInitRouteSchema,
  telegramWebhookRouteSchema,
  telegramStatusRouteSchema,
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
  googleRedirectHandler,
  googleCallbackHandler,
  githubRedirectHandler,
  githubCallbackHandler,
  telegramInitHandler,
  telegramWebhookHandler,
  telegramStatusHandler,
} from './controller.js';

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post('/register', { schema: registerRouteSchema }, registerHandler);
  app.post('/login', { schema: loginRouteSchema }, loginHandler);
  // Email + password with OTP verification (auth_tz.md §6).
  app.post('/email/signup', { schema: emailSignupRouteSchema }, emailSignupHandler);
  app.post('/email/verify', { schema: emailVerifyRouteSchema }, emailVerifyHandler);
  app.post('/email/login', { schema: emailLoginRouteSchema }, loginHandler);
  // Google OAuth 2.0 (auth_tz.md §3).
  app.get('/google', { schema: googleRedirectRouteSchema }, googleRedirectHandler);
  app.get('/google/callback', { schema: googleCallbackRouteSchema }, googleCallbackHandler);
  // GitHub OAuth 2.0 (auth_tz.md §4).
  app.get('/github', { schema: githubRedirectRouteSchema }, githubRedirectHandler);
  app.get('/github/callback', { schema: githubCallbackRouteSchema }, githubCallbackHandler);
  // Telegram deep-link login (auth_tz.md §7).
  app.post('/telegram/init', { schema: telegramInitRouteSchema }, telegramInitHandler);
  app.post('/telegram/webhook', { schema: telegramWebhookRouteSchema }, telegramWebhookHandler);
  app.get('/telegram/status', { schema: telegramStatusRouteSchema }, telegramStatusHandler);
  app.post('/refresh', { schema: refreshRouteSchema }, refreshHandler);
  app.post('/logout', { schema: logoutRouteSchema }, logoutHandler);
  app.get('/me', { schema: getMeRouteSchema, preHandler: [authenticate] }, getMeHandler);
  app.patch('/me', { schema: updateMeRouteSchema, preHandler: [authenticate] }, updateMeHandler);
}
