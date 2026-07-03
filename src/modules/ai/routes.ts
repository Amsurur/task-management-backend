import type { FastifyInstance } from 'fastify';
import { authenticate } from '../../plugins/auth-hook.js';
import { aiChatRouteSchema } from './schema.js';
import { aiChatHandler } from './controller.js';

/** AI assistant — `/api/v1/ai`. Auth only (operates as the authenticated user). */
export async function aiRoutes(app: FastifyInstance): Promise<void> {
  app.post('/chat', { schema: aiChatRouteSchema, preHandler: [authenticate] }, aiChatHandler);
}
