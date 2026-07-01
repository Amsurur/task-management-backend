import type { FastifyRequest, FastifyReply } from 'fastify';
import * as inviteService from './service.js';

export async function getInviteHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const { token } = request.params as { token: string };
  const invite = await inviteService.getInvite(request.server.prisma, token);
  reply.send(invite);
}

export async function acceptInviteHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const { token } = request.params as { token: string };
  const member = await inviteService.acceptInvite(request.server.prisma, token, request.userId);
  reply.send(member);
}
