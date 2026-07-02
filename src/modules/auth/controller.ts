import type { FastifyRequest, FastifyReply } from 'fastify';
import * as authService from './service.js';
import { AppError } from '../../lib/errors.js';
import {
  setRefreshCookie,
  clearRefreshCookie,
  readRefreshCookie,
} from '../../lib/session-cookie.js';
import {
  RegisterBodySchema,
  LoginBodySchema,
  RefreshBodySchema,
  UpdateMeBodySchema,
  EmailSignupBodySchema,
  EmailVerifyBodySchema,
} from './schema.js';

export async function registerHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const body = RegisterBodySchema.parse(request.body);
  const result = await authService.register(request.server.prisma, body);
  setRefreshCookie(reply, result.refresh_token);
  reply.code(201).send(result);
}

export async function loginHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const body = LoginBodySchema.parse(request.body);
  const result = await authService.login(request.server.prisma, body);
  setRefreshCookie(reply, result.refresh_token);
  reply.send(result);
}

export async function emailSignupHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const body = EmailSignupBodySchema.parse(request.body);
  const result = await authService.emailSignup(request.server.prisma, body);
  reply.send(result);
}

export async function emailVerifyHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const body = EmailVerifyBodySchema.parse(request.body);
  const result = await authService.emailVerify(request.server.prisma, body);
  setRefreshCookie(reply, result.refresh_token);
  reply.send(result);
}

export async function refreshHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  // Prefer the httpOnly cookie (browsers); fall back to the body for API/mobile
  // clients that can't use cookies. The token is also returned in the body so
  // those clients can rotate it.
  const { refresh_token: bodyToken } = RefreshBodySchema.parse(request.body ?? {});
  const token = readRefreshCookie(request.cookies) ?? bodyToken;
  if (!token) throw AppError.unauthorized('No refresh token provided');

  const result = await authService.refresh(request.server.prisma, token);
  setRefreshCookie(reply, result.refresh_token);
  reply.send(result);
}

export async function logoutHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { refresh_token: bodyToken } = RefreshBodySchema.parse(request.body ?? {});
  const token = readRefreshCookie(request.cookies) ?? bodyToken;
  if (token) await authService.logout(request.server.prisma, token);
  clearRefreshCookie(reply);
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
