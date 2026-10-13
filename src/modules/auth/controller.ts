import type { FastifyRequest, FastifyReply } from 'fastify';
import * as authService from './service.js';
import {
  RegisterBodySchema,
  LoginBodySchema,
  RefreshBodySchema,
  UpdateMeBodySchema,
  ChangePasswordBodySchema,
} from './schema.js';

export async function registerHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const body = RegisterBodySchema.parse(request.body);
  const result = await authService.register(request.server.prisma, body);
  reply.code(201).send(result);
}

export async function loginHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const body = LoginBodySchema.parse(request.body);
  const result = await authService.login(request.server.prisma, body);
  reply.send(result);
}

export async function refreshHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { refresh_token } = RefreshBodySchema.parse(request.body);
  const result = await authService.refresh(request.server.prisma, refresh_token);
  reply.send(result);
}

export async function logoutHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { refresh_token } = RefreshBodySchema.parse(request.body);
  await authService.logout(request.server.prisma, refresh_token);
  reply.code(204).send();
}

// GET /me and PATCH /me use the `authenticate` preHandler (set in routes.ts).
// By the time these handlers run, request.userId is guaranteed to be set.

export async function getMeHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const user = await authService.getMe(request.server.prisma, request.userId);
  reply.send(user);
}

export async function updateMeHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const body = UpdateMeBodySchema.parse(request.body);
  const user = await authService.updateMe(request.server.prisma, request.userId, body);
  reply.send(user);
}

export async function changePasswordHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const body = ChangePasswordBodySchema.parse(request.body);
  await authService.changePassword(request.server.prisma, request.userId, body);
  reply.code(204).send();
}
