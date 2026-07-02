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

// `refresh_token` is optional: browsers send it via the httpOnly cookie, so the
// body may be empty. The controller enforces "cookie or body must be present".
export const RefreshBodySchema = z.object({
  refresh_token: z.string().min(1).optional(),
});

export const UpdateMeBodySchema = z.object({
  display_name: z.string().min(1).max(100).optional(),
  avatar_url: z.string().url().optional().nullable(),
});

// Email+password signup — same fields as register, but no invite_token (OTP flow).
export const EmailSignupBodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  display_name: z.string().min(1).max(100),
});

// Confirm a signup OTP: the email it was sent to + the 6-digit code.
export const EmailVerifyBodySchema = z.object({
  email: z.string().email(),
  code: z.string().regex(/^\d{6}$/, 'Code must be 6 digits'),
});

// Google OAuth callback query params. All optional: Google sends `code` + `state`
// on success, or `error` (e.g. `access_denied`) when the user declines consent.
export const GoogleCallbackQuerySchema = z.object({
  code: z.string().min(1).optional(),
  state: z.string().min(1).optional(),
  error: z.string().min(1).optional(),
});

export type RegisterBody = z.infer<typeof RegisterBodySchema>;
export type LoginBody = z.infer<typeof LoginBodySchema>;
export type RefreshBody = z.infer<typeof RefreshBodySchema>;
export type UpdateMeBody = z.infer<typeof UpdateMeBodySchema>;
export type EmailSignupBody = z.infer<typeof EmailSignupBodySchema>;
export type EmailVerifyBody = z.infer<typeof EmailVerifyBodySchema>;
export type GoogleCallbackQuery = z.infer<typeof GoogleCallbackQuerySchema>;

// ─── Fastify route schemas (for OpenAPI + request validation) ─────────────────

const userShape = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    email: { type: 'string', nullable: true },
    email_verified: { type: 'boolean' },
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

const otpChallenge = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['otp_sent'] },
    email: { type: 'string' },
  },
} as const;

export const emailSignupRouteSchema: FastifySchema = {
  tags: ['Auth'],
  summary: 'Start email+password signup — creates an inactive account and emails a 6-digit OTP',
  description:
    'Creates the account inactive + unverified and sends a verification code. If the email already exists it is not duplicated; a code is still sent so the owner can verify into the existing account.',
  body: {
    type: 'object',
    required: ['email', 'password', 'display_name'],
    properties: {
      email: { type: 'string', format: 'email' },
      password: { type: 'string', minLength: 8 },
      display_name: { type: 'string', minLength: 1, maxLength: 100 },
    },
  },
  response: {
    200: otpChallenge,
  },
};

export const emailVerifyRouteSchema: FastifySchema = {
  tags: ['Auth'],
  summary: 'Confirm a signup OTP — verifies + activates the account and issues a session',
  body: {
    type: 'object',
    required: ['email', 'code'],
    properties: {
      email: { type: 'string', format: 'email' },
      code: { type: 'string', pattern: '^\\d{6}$' },
    },
  },
  response: {
    200: tokenPair,
  },
};

export const emailLoginRouteSchema: FastifySchema = {
  tags: ['Auth'],
  summary: 'Login with email and password',
  description:
    'Honest "invalid email or password" on miss. Accounts with no password are guided to their OAuth provider; unverified accounts are guided to verify first.',
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

export const googleRedirectRouteSchema: FastifySchema = {
  tags: ['Auth'],
  summary: 'Begin Google OAuth — redirects to the Google consent screen',
  description:
    'Mints a CSRF `state`, stores it in a short-lived httpOnly cookie, and 302-redirects the browser to Google.',
  response: {
    302: { type: 'null', description: 'Redirect to Google' },
  },
};

export const googleCallbackRouteSchema: FastifySchema = {
  tags: ['Auth'],
  summary: 'Google OAuth callback — verifies state, exchanges the code, issues a session',
  description:
    'Verifies the `state` against the browser cookie (CSRF), exchanges the authorization code for the Google profile, find-or-creates the account (auto-merging by verified email), sets the refresh cookie and redirects to the frontend with an access token in the URL fragment. Failures redirect to the frontend with an `error` fragment.',
  querystring: {
    type: 'object',
    properties: {
      code: { type: 'string' },
      state: { type: 'string' },
      error: { type: 'string' },
    },
  },
  response: {
    302: { type: 'null', description: 'Redirect to the frontend (or an error page)' },
  },
};

export const refreshRouteSchema: FastifySchema = {
  tags: ['Auth'],
  summary: 'Rotate the refresh token and issue a new access token',
  description:
    'Reads the refresh token from the httpOnly cookie (browsers) or the request body (API/mobile clients). Sets a rotated refresh cookie on success.',
  body: {
    type: 'object',
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
  description:
    'Revokes the refresh token from the httpOnly cookie (browsers) or the request body, and clears the refresh cookie.',
  body: {
    type: 'object',
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
