import { z } from 'zod';
import type { FastifySchema } from 'fastify';

// ─── Zod validators ──────────────────────────────────────────────────────────

export const RegisterBodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  display_name: z.string().min(1).max(100),
  // Clients (e.g. HTML forms) often send an empty string when the user leaves
  // the invite field blank. Treat "" / whitespace as "no invite" so a normal
  // first-time signup succeeds; a non-empty value must still be a valid UUID.
  invite_token: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.string().uuid().optional(),
  ),
});

export const LoginBodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const RefreshBodySchema = z.object({
  refresh_token: z.string().min(1),
});

export const UpdateMeBodySchema = z.object({
  display_name: z.string().min(1).max(100).optional(),
  avatar_url: z.string().url().optional().nullable(),
});

export type RegisterBody = z.infer<typeof RegisterBodySchema>;
export type LoginBody = z.infer<typeof LoginBodySchema>;
export type RefreshBody = z.infer<typeof RefreshBodySchema>;
export type UpdateMeBody = z.infer<typeof UpdateMeBodySchema>;

// ─── Fastify route schemas (for OpenAPI + request validation) ─────────────────

const userShape = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    email: { type: 'string' },
    display_name: { type: 'string' },
    avatar_url: { type: 'string', nullable: true },
    is_active: { type: 'boolean' },
    created_at: { type: 'string', format: 'date-time' },
    updated_at: { type: 'string', format: 'date-time' },
  },
} as const;

const tokenPair = {
  type: 'object',
  properties: {
    access_token: { type: 'string' },
    refresh_token: { type: 'string' },
    user: userShape,
  },
} as const;

export const registerRouteSchema: FastifySchema = {
  tags: ['Auth'],
  summary: 'Register a new user (optionally with an invite_token to auto-join a workspace)',
  body: {
    type: 'object',
    required: ['email', 'password', 'display_name'],
    properties: {
      email: { type: 'string', format: 'email' },
      password: { type: 'string', minLength: 8 },
      display_name: { type: 'string', minLength: 1, maxLength: 100 },
      // No `format: uuid` here so an empty string from a form isn't rejected at
      // the Fastify layer — the Zod schema normalizes "" to "no invite" and
      // still enforces UUID format for any real token.
      invite_token: { type: 'string' },
    },
  },
  response: {
    201: tokenPair,
  },
};

export const loginRouteSchema: FastifySchema = {
  tags: ['Auth'],
  summary: 'Login with email and password',
  body: {
    type: 'object',
    required: ['email', 'password'],
    properties: {
      email: { type: 'string', format: 'email' },
      password: { type: 'string', minLength: 1 },
    },
  },
  response: {
    200: tokenPair,
  },
};

export const refreshRouteSchema: FastifySchema = {
  tags: ['Auth'],
  summary: 'Rotate the refresh token and issue a new access token',
  body: {
    type: 'object',
    required: ['refresh_token'],
    properties: {
      refresh_token: { type: 'string' },
    },
  },
  response: {
    200: tokenPair,
  },
};

export const logoutRouteSchema: FastifySchema = {
  tags: ['Auth'],
  summary: 'Revoke the current refresh token',
  body: {
    type: 'object',
    required: ['refresh_token'],
    properties: {
      refresh_token: { type: 'string' },
    },
  },
  response: {
    204: { type: 'null', description: 'Logged out' },
  },
};

export const getMeRouteSchema: FastifySchema = {
  tags: ['Auth'],
  summary: 'Get the current authenticated user',
  security: [{ bearerAuth: [] }],
  response: { 200: userShape },
};

export const updateMeRouteSchema: FastifySchema = {
  tags: ['Auth'],
  summary: 'Update the current authenticated user',
  security: [{ bearerAuth: [] }],
  body: {
    type: 'object',
    properties: {
      display_name: { type: 'string', minLength: 1, maxLength: 100 },
      avatar_url: { type: 'string', nullable: true },
    },
  },
  response: { 200: userShape },
};
