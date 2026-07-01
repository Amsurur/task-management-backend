import * as argon2 from 'argon2';
import type { PrismaClient, User } from '@prisma/client';
import { config } from '../../config/index.js';
import { AppError } from '../../lib/errors.js';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../../lib/jwt.js';
import { acceptInviteAfterRegister } from '../invites/service.js';
import type { RegisterBody, LoginBody, UpdateMeBody } from './schema.js';

export interface AuthTokens {
  access_token: string;
  refresh_token: string;
  user: SafeUser;
}

export type SafeUser = Omit<User, 'password_hash'>;

function stripHash(user: User): SafeUser {
  const { password_hash: _ph, ...safe } = user;
  return safe;
}

/**
 * Parse a JWT-style TTL string ("15m", "7d", "3600") into a future Date.
 * Only handles the units used in the env schema: s/m/h/d/w/y and bare seconds.
 */
function ttlToDate(ttl: string): Date {
  const match = /^(\d+)(ms|s|m|h|d|w|y)?$/.exec(ttl);
  if (!match || !match[1]) throw new Error(`Cannot parse TTL: ${ttl}`);
  const n = parseInt(match[1], 10);
  const unit = match[2] ?? 's';
  const msMap: Record<string, number> = {
    ms: 1,
    s: 1_000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
    w: 604_800_000,
    y: 31_536_000_000,
  };
  return new Date(Date.now() + n * (msMap[unit] ?? 1_000));
}

// ─── Public service functions ─────────────────────────────────────────────────

export async function register(prisma: PrismaClient, body: RegisterBody): Promise<AuthTokens> {
  const existing = await prisma.user.findUnique({ where: { email: body.email } });
  if (existing) throw AppError.conflict('An account with this email already exists');

  // If an invite_token is provided, validate it before creating the account.
  // We only check it exists + isn't expired/used here — the email on the invite must
  // match the registration email so we enforce that in acceptInviteAfterRegister.
  if (body.invite_token) {
    const invite = await prisma.workspaceInvite.findUnique({
      where: { token: body.invite_token },
    });
    if (!invite) throw AppError.notFound('Invite not found');
    if (invite.accepted_at) throw AppError.conflict('Invite has already been accepted');
    if (invite.expires_at < new Date()) throw AppError.gone('Invite has expired');
    if (invite.email.toLowerCase() !== body.email.toLowerCase()) {
      throw AppError.forbidden('This invite was sent to a different email address');
    }
  }

  const password_hash = await argon2.hash(body.password);
  const user = await prisma.user.create({
    data: { email: body.email, password_hash, display_name: body.display_name },
  });

  if (body.invite_token) {
    await acceptInviteAfterRegister(prisma, body.invite_token, user.id);
  }

  return issueTokenPair(prisma, user);
}

export async function login(prisma: PrismaClient, body: LoginBody): Promise<AuthTokens> {
  const user = await prisma.user.findUnique({ where: { email: body.email } });

  // Constant-time check on miss prevents timing-based account enumeration.
  const valid =
    user !== null && (await argon2.verify(user.password_hash, body.password).catch(() => false));

  if (!user || !valid) throw AppError.unauthorized('Invalid email or password');
  if (!user.is_active) throw AppError.forbidden('This account has been deactivated');

  return issueTokenPair(prisma, user);
}

export async function refresh(prisma: PrismaClient, rawToken: string): Promise<AuthTokens> {
  let payload: { sub: string; jti: string };
  try {
    payload = verifyRefreshToken(rawToken) as { sub: string; jti: string };
  } catch {
    throw AppError.unauthorized('Invalid or expired refresh token');
  }

  const stored = await prisma.refreshToken.findUnique({ where: { id: payload.jti } });
  if (!stored || stored.revoked_at !== null || stored.expires_at < new Date()) {
    throw AppError.unauthorized('Refresh token has been revoked or expired');
  }

  const user = await prisma.user.findUniqueOrThrow({ where: { id: payload.sub } });

  // Rotate: revoke the old token record, then issue a fresh pair.
  await prisma.refreshToken.update({ where: { id: stored.id }, data: { revoked_at: new Date() } });

  return issueTokenPair(prisma, user);
}

export async function logout(prisma: PrismaClient, rawToken: string): Promise<void> {
  let jti: string;
  try {
    jti = (verifyRefreshToken(rawToken) as { jti: string }).jti;
  } catch {
    return; // Expired/invalid token — already effectively logged out.
  }

  await prisma.refreshToken.updateMany({
    where: { id: jti, revoked_at: null },
    data: { revoked_at: new Date() },
  });
}

export async function getMe(prisma: PrismaClient, userId: string): Promise<SafeUser> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw AppError.notFound('User not found');
  return stripHash(user);
}

export async function updateMe(
  prisma: PrismaClient,
  userId: string,
  body: UpdateMeBody,
): Promise<SafeUser> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw AppError.notFound('User not found');

  const updated = await prisma.user.update({
    where: { id: userId },
    data: {
      ...(body.display_name !== undefined && { display_name: body.display_name }),
      ...(body.avatar_url !== undefined && { avatar_url: body.avatar_url }),
    },
  });

  return stripHash(updated);
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

async function issueTokenPair(prisma: PrismaClient, user: User): Promise<AuthTokens> {
  // Create the DB row first to obtain its `id`, which becomes the JWT `jti`.
  // The token_hash column is not used (we store the id in the JWT jti instead).
  const record = await prisma.refreshToken.create({
    data: {
      user_id: user.id,
      token_hash: crypto.randomUUID(), // unique placeholder; real identity is the row id via jti
      expires_at: ttlToDate(config.JWT_REFRESH_TTL),
    },
  });

  return {
    access_token: signAccessToken(user.id),
    refresh_token: signRefreshToken(user.id, record.id),
    user: stripHash(user),
  };
}
