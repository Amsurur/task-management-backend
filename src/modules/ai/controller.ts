import type { FastifyRequest, FastifyReply } from 'fastify';
import { AppError } from '../../lib/errors.js';
import { AiChatBodySchema } from './schema.js';
import { aiChat } from './service.js';

export async function aiChatHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const body = AiChatBodySchema.parse(request.body);
  const authorization = request.headers.authorization;
  if (!authorization) throw AppError.unauthorized('Missing Authorization header');

  const result = await aiChat(request.server, authorization, body.message, body.history ?? []);
  reply.send(result);
}
