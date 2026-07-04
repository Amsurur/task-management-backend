import type { FastifyRequest, FastifyReply } from 'fastify';
import { ListUsersQuerySchema, PresenceQuerySchema } from './schema.js';
import { listUsers, getUserProfile, getPresence } from './service.js';

export async function presenceHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const { ids } = PresenceQuerySchema.parse(request.query);
  const presence = await getPresence(request.server.prisma, ids);
  reply.send(presence);
}

export async function listUsersHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const { q, limit } = ListUsersQuerySchema.parse(request.query);
  const users = await listUsers(request.server.prisma, q, limit);
  reply.send(users);
}

export async function getUserProfileHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const { userId } = request.params as { userId: string };
  const profile = await getUserProfile(request.server.prisma, request.userId, userId);
  reply.send(profile);
}
