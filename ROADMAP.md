# Roadmap — Task Management Backend

> Single source of truth for build progress. Derived from `TZ-task-management-backend.md` §9.
> `/start` reads this to find the next task. `/stop` ticks off completed tasks and refreshes
> the **Current Status** block below.

## Current Status

- **Current Phase:** Phase 3 — Collaboration & polish (almost done)
- **Last Session:** 2026-07-01
- **Next Task:** Phase 3 → OAuth login

---

## Resolved Decisions

These lock the TZ §12 open questions (per `CLAUDE.md`). Do not re-litigate during the build.

- **Label scope:** project-level (not workspace-level).
- **Rich text:** issue/comment bodies stored as **markdown text** (not structured JSON).
- **Invites:** email invites deferred to **Phase 3**; MVP uses add-existing-user only.
- **Sub-issue depth:** **single level** (parent → children only, no deep nesting).
- **Soft delete:** issues and comments are soft-deletable (`deleted_at`); other entities hard-delete unless noted.

---

## Phase 0 — Foundations

- [x] `package.json` + `tsconfig.json` + npm scripts (`dev`, `build`, `test`, `lint`)
- [x] ESLint + Prettier config
- [x] Fastify skeleton — `src/app.ts` (instance + plugin registration), `src/server.ts` (bootstrap/listen)
- [x] Config/env parsing + validation at boot — `src/config/`
- [x] Prisma init + Postgres via `docker-compose` (db + app services)
- [x] Base plugins — pino logging, centralized error handler, `@fastify/swagger` at `/docs`
- [x] `GET /health` endpoint
- [x] Vitest + Supertest test harness
- [x] CI pipeline (lint + build + test)

## Phase 1 — MVP Core (launchable)

- [x] Prisma schema: User, Workspace, WorkspaceMember, Project, ProjectMember, State, Issue, IssueAssignee, Label, IssueLabel, Comment + first migration
- [x] Auth module — register, login, refresh (rotating), logout, `GET/PATCH /auth/me`; JWT access (~15m) + refresh tokens; argon2 hashing
- [x] Auth hook plugin (Bearer → user) + workspace membership/permission resolver hook
- [x] Workspaces module — CRUD + members (list/add/change-role/remove); creator → owner
- [x] Projects module — CRUD + members; seed default States on create
- [x] States module — list/create/update/delete (reassign issues on delete)
- [x] Labels module — project-scoped CRUD
- [x] Issues module — CRUD (title, state, priority, assignees, dates, sub-issues), assignees/labels attach-detach
- [x] Comments module — CRUD (markdown, soft-delete, edit/delete own or admin)
- [x] Issue list — basic filtering (`state[]`, `priority[]`, `assignee[]`, `label[]`, `search`, AND semantics) + cursor pagination
- [x] Integration tests: auth flow + multi-tenant isolation (no cross-workspace access)

## Phase 2 — Agile machinery

- [x] Cycles module — CRUD + add/remove issues + progress summary
- [x] Modules module — CRUD + add/remove issues (many-to-many) + progress
- [x] Issue links/relations — `blocks | blocked_by | relates_to | duplicates`
- [x] Full filtering + sorting (`sort_by`/`order`) + grouping (`group_by`) on issue list
- [x] Activity log — audit trail powering issue history feed

## Phase 3 — Collaboration & polish

- [x] Attachments — object storage (S3/MinIO), DB metadata only
- [x] Notifications — generated on assign/mention/comment events; list + mark-read
- [x] Email-based invites
- [ ] OAuth login

## Phase 4 — Pre-launch hardening

- [ ] Rate limiting (`@fastify/rate-limit`) on auth + write endpoints
- [ ] Security pass — `@fastify/helmet`, CORS per env, secret validation at boot
- [ ] Performance/index review (FKs + common filter columns)
- [ ] OpenAPI docs completeness pass
- [ ] Seed data
- [ ] Deployment config
- [ ] **Definition of Done check** (TZ §10): Phase 1 endpoints implemented/validated/authorized, multi-tenant isolation tested, docs live, core flows tested, `docker-compose up` one-command startup
