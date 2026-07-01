# Auth Roadmap — Multi-provider Authentication

> Single source of truth for the **authentication system** build. Derived from `auth_tz.md`.
> `/start-auth` reads this to find the next unchecked task, works the **current phase**, ticks
> off (`- [x]`) each finished item, and commits when the phase is fully done — then waits for
> the next `/start-auth`.
>
> This is separate from the product `ROADMAP.md` (`/start` / `/stop`). Do not mix the two.

## Current Status

- **Current Phase:** Phase A0 — Data model & session foundations
- **Last Session:** 2026-07-01 (roadmap created; no auth code written yet)
- **Next Task:** Phase A0 → migrate `User` (nullable `email` / `password_hash`, add `email_verified`)

---

## Resolved Decisions

Locked from `auth_tz.md` §9 and §1. Do not re-litigate during the build.

- **Account vs. identity:** `users` (the account) and `auth_identities` (login methods) are
  separate. One user may have many identities. Account identity is `email` when present;
  Telegram-only accounts are identified by `telegram_id`.
- **Find-or-create** for every OAuth/Telegram login (never "already exists" / "not found").
  The **only** exception is email+password login (honest "invalid credentials" on miss).
- **Auto-merge by email** is allowed only when the provider marks the email verified
  (Google/GitHub verified). Unverified emails never auto-merge.
- **Sessions:** JWT access token **3 hours**; refresh token **~30 days** in an `httpOnly`
  cookie. Refresh rotates; logout invalidates refresh. (Supersedes the product roadmap's ~15m.)
- **Email OTP:** 6 digits, 10-minute TTL, max 5 attempts then invalidate.
- **OTP send rate limit:** at most 1 / 60s and 5 / hour per email.
- **Telegram login token:** 10-minute TTL, one-time, bound to the initiating browser session.
- **Passwords:** argon2id (or bcrypt cost ≥ 12), minimum 8 characters.
- **CSRF:** every OAuth flow carries a `state` parameter that is verified on callback.
- **No phone number** collected on the site (unverifiable); if ever needed the bot asks via
  "share contact".

---

## Phase A0 — Data model & session foundations

- [ ] Migrate `User`: make `email` nullable (keep unique), make `password_hash` nullable, add `email_verified Boolean @default(false)`
- [ ] Reconcile existing `register` / `login` / `getMe` with now-nullable `email` / `password_hash` (no runtime breakage)
- [ ] `AuthProvider` enum (`email | google | github | telegram`) + `AuthIdentity` model (`user_id`, `provider`, `provider_user_id`, `provider_email`, `created_at`, `UNIQUE(provider, provider_user_id)`)
- [ ] `EmailOtp` model (`email`, `code_hash`, `purpose` signup|login, `expires_at`, `attempts`, `consumed_at`)
- [ ] `TelegramLoginToken` model (`token`, `session_id`, `telegram_id`, `status` pending|confirmed|expired|used, `expires_at`)
- [ ] Migration applied + `prisma generate`
- [ ] Config/env additions (validated at boot): Google client id/secret + callback, GitHub client id/secret + callback, Telegram bot token/username, session cookie name/domain/secure flags, frontend redirect URL
- [ ] Session change: access-token TTL → **3h**; set refresh token as `httpOnly` cookie (via `@fastify/cookie`); `/auth/refresh` and `/auth/logout` read the cookie
- [ ] Reusable `state`/CSRF helper + `find-or-create identity` service helper shared by all providers

## Phase A1 — Email + password (OTP verification)

- [ ] Email sender abstraction (`lib/mailer`) — dev logs to console, prod SMTP/provider behind env
- [ ] `POST /auth/email/signup` — create user inactive + `email_verified=false`, generate 6-digit OTP (store `code_hash`), send email; if email already exists, do **not** duplicate — route to verify-into-existing
- [ ] `POST /auth/email/verify` — check OTP (expiry, ≤5 attempts, single-use) → set `email_verified=true`, activate, issue session
- [ ] Update `POST /auth/email/login` — honest "invalid email or password" on miss; if account has no `password_hash`, return "sign in with Google/GitHub" + offer to set a password
- [ ] OTP send rate limit (1 / 60s, 5 / hour per email) + attempt/expiry invalidation
- [ ] `email` identity row created/ensured on successful signup

## Phase A2 — Google OAuth

- [ ] `GET /auth/google` — redirect to Google with `state` (CSRF) stored server-side/cookie
- [ ] `GET /auth/google/callback` — verify `state`, exchange `code`, read `sub` / `email` / `name` / `picture`
- [ ] Find-or-create: identity by (`google`, `sub`) → else user by verified `email` (auto-merge) → else create; issue session, redirect to frontend
- [ ] `google` identity row persisted with `provider_email`

## Phase A3 — GitHub OAuth

- [ ] `GET /auth/github` — redirect with `state`, scope `read:user user:email`
- [ ] `GET /auth/github/callback` — verify `state`, exchange `code` for `access_token`, `GET /user` + `GET /user/emails` (primary + verified)
- [ ] Same find-or-create + auto-merge-by-verified-email logic as Google; issue session
- [ ] `github` identity row persisted

## Phase A4 — Telegram deep-link login

- [ ] `POST /auth/telegram/init` — create `TelegramLoginToken` (`pending`) bound to browser session; return `https://t.me/<bot>?start=<token>` deep-link
- [ ] Bot update handler — receive `/start <token>` with `telegram_id`; reply with confirm inline-button; on confirm set token `confirmed` + attach `telegram_id`
- [ ] `GET /auth/telegram/status?token=` — polling endpoint; on `confirmed` find-or-create by `telegram_id` (no email), mark token `used`, issue session
- [ ] Token lifecycle enforced: 10-min TTL, one-time, session-bound, expiry sweep

## Phase A5 — Connected-accounts management

- [ ] `GET /auth/identities` — list the logged-in user's linked login methods
- [ ] `POST /auth/identities/:provider/link` — link a new OAuth/Telegram identity to the current account; reject if that identity already belongs to another user
- [ ] `DELETE /auth/identities/:provider` — unlink, with hard guard: **cannot remove the last remaining login method**

## Phase A6 — Hardening & tests

- [ ] Verify `state`/CSRF on all OAuth flows; secrets only from validated env
- [ ] Enforce argon2id params + min-8-char password rule centrally
- [ ] Rate limits verified on auth + OTP endpoints (`@fastify/rate-limit`)
- [ ] Integration tests: find-or-create, merge-by-verified-email, unlink-last guard, OTP expiry/attempts/single-use, Telegram token lifecycle, refresh-cookie rotation
- [ ] OpenAPI/Swagger docs complete for every `/auth/*` endpoint
