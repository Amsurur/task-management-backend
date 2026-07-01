// OAuth `state` parameter — CSRF protection for the redirect flows (auth_tz.md §9).
//
// Stateless design: a random nonce plus the time it was issued, authenticated by an
// HMAC keyed on the access-token secret. The route puts the token in the outgoing
// `state` query param (and typically mirrors it in a short-lived cookie); on callback
// `verifyState` checks the signature and freshness — no server-side storage needed.
//
// This only proves the callback's `state` was minted by us and is recent. Binding it
// to the specific browser (double-submit cookie) is the route's job on top of this.

import crypto from 'node:crypto';
import { config } from '../config/index.js';

const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes

function sign(payload: string): string {
  return crypto.createHmac('sha256', config.JWT_ACCESS_SECRET).update(payload).digest('base64url');
}

/** Mint a fresh, self-authenticating state token. */
export function createState(): string {
  const nonce = crypto.randomBytes(16).toString('base64url');
  const issued = Date.now().toString(36);
  const payload = `${nonce}.${issued}`;
  return `${payload}.${sign(payload)}`;
}

/** True iff `state` was produced by `createState` and is within the TTL. */
export function verifyState(state: string | undefined | null): boolean {
  if (!state) return false;
  const parts = state.split('.');
  if (parts.length !== 3) return false;
  const [nonce, issued, sig] = parts;
  if (!nonce || !issued || !sig) return false;
  const expected = sign(`${nonce}.${issued}`);

  const given = Buffer.from(sig);
  const want = Buffer.from(expected);
  if (given.length !== want.length || !crypto.timingSafeEqual(given, want)) return false;

  const issuedMs = parseInt(issued, 36);
  if (!Number.isFinite(issuedMs)) return false;
  return Date.now() - issuedMs <= STATE_TTL_MS;
}
