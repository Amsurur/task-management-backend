# Frontend Tasks — Task Management Web Client

> Consumes the existing REST API (`/api/v1`). Stack: **React + TypeScript**.
> Team: **2 members** — **Dev A** (Core / Issues track) and **Dev B** (Collaboration / Settings track).
> Tickets are sized to be assignable per day. Each has acceptance criteria (AC).

## Recommended stack (locks shared decisions)

| Concern            | Choice                                                    |
| ------------------ | --------------------------------------------------------- |
| Build              | Vite + React 18 + TypeScript                              |
| Routing            | React Router v6                                           |
| Server state       | TanStack Query (React Query)                              |
| Client state       | Zustand (auth/session, UI)                                |
| Forms + validation | React Hook Form + Zod                                     |
| HTTP               | Axios instance w/ interceptors (Bearer + refresh)         |
| Styling            | Tailwind CSS + a small component layer (Radix primitives) |
| Markdown           | `react-markdown` (issue/comment bodies are markdown)      |
| Testing            | Vitest + React Testing Library + MSW (mock API)           |

---

## Scope map (epics)

| #   | Scope                                                                                    | Owner              |
| --- | ---------------------------------------------------------------------------------------- | ------------------ |
| S0  | Foundation & infra (Vite, router, API client, auth-token plumbing, design tokens)        | **Both (Day 1–2)** |
| S1  | Auth & account (register, login, refresh, logout, profile)                               | Dev A              |
| S2  | Issues — list, board, filters, sorting, grouping                                         | Dev A              |
| S3  | Issue detail (fields, sub-issues, relations, comments, activity, attachments)            | Dev A              |
| S4  | Design system / shared UI kit (buttons, inputs, modal, toast, table, empty/error states) | Dev B              |
| S5  | Workspaces & members                                                                     | Dev B              |
| S6  | Projects + settings (states, labels, members)                                            | Dev B              |
| S7  | Cycles & Modules                                                                         | Dev B              |
| S8  | Notifications                                                                            | Dev B              |

---

# Dev A — Core / Issues track

### S0 — Foundation (paired with Dev B, Day 1–2)

- **A0.1 — Project scaffold.** Vite + React + TS, Tailwind, ESLint/Prettier matching backend repo style, folder structure (`src/api`, `src/features`, `src/components`, `src/routes`, `src/lib`).
  - AC: `npm run dev` serves a blank app; lint passes; path aliases work.
- **A0.2 — API client + auth plumbing.** Axios instance, base URL from env, request interceptor adds `Authorization: Bearer`, response interceptor catches 401 → calls refresh endpoint → retries; logout on refresh failure.
  - AC: a protected request auto-refreshes once on expiry; second 401 redirects to login.
- **A0.3 — Auth/session store + protected routes.** Zustand store holds access token + current user; `<RequireAuth>` route guard; persist refresh token per backend contract.
  - AC: reload keeps session; unauthenticated user hitting a protected route is redirected to `/login`.

### S1 — Auth & account

- **A1.1 — Register page.** Form (email, password, name) → `POST /auth/register`; Zod validation; error envelope (`error.code/message`) surfaced inline.
  - AC: valid submit logs in and routes to workspace picker; duplicate email shows field error.
- **A1.2 — Login page.** `POST /auth/login`; "remember me"; redirect to intended route after login.
  - AC: wrong credentials show a non-leaky error; success stores tokens.
- **A1.3 — Logout.** Calls logout endpoint (revokes refresh), clears store, redirects.
  - AC: after logout, back button does not expose protected data.
- **A1.4 — Profile page.** `GET/PATCH /auth/me` — view + edit name; change password flow.
  - AC: edit persists and reflects in header; password never rendered/logged.

### S2 — Issues list & views

- **A2.1 — Issue list (table view).** Fetch issues for a project with cursor pagination (`cursor`+`limit`); columns: key (`MOB-123`), title, state, priority, assignees, due date.
  - AC: infinite/"load more" works via cursor; loading + empty states present.
- **A2.2 — Filter bar.** Combinable params `state[]`, `priority[]`, `assignee[]`, `label[]`, `search`, `due_before/after`; AND semantics; reflected in URL query string.
  - AC: filters compose; refreshing the page preserves filters; clear-all resets.
- **A2.3 — Sorting & grouping.** `sort_by`/`order` controls; `group_by` (state/priority/assignee) renders grouped sections with counts.
  - AC: switching group_by regroups without full reload; sort persists in URL.
- **A2.4 — Board (Kanban) view.** Columns by state group (`backlog|unstarted|started|completed|cancelled`); drag card → PATCH issue state.
  - AC: drag updates state optimistically and rolls back on error.
- **A2.5 — Create-issue modal.** Title, state, priority, assignees, labels, dates, parent (sub-issue, single level).
  - AC: created issue appears in list without manual refresh (query invalidation).

### S3 — Issue detail

- **A3.1 — Detail layout + core fields.** Route `/issues/:key`; editable title, markdown description (`react-markdown` preview), inline edit of state/priority/assignees/dates/labels.
  - AC: each field edit PATCHes and shows saved state; markdown renders.
- **A3.2 — Sub-issues panel.** List children, add/convert child issue, single-level only.
  - AC: cannot nest a sub-issue under a sub-issue (UI disallows).
- **A3.3 — Relations panel.** `blocks | blocked_by | relates_to | duplicates` — add/remove links with issue picker.
  - AC: adding a relation shows reciprocal type; remove works.
- **A3.4 — Comments thread.** List, add (markdown), edit/delete own (or admin), soft-delete handling.
  - AC: optimistic add; edited comment shows "edited"; deleted shows tombstone.
- **A3.5 — Activity feed.** Render audit-log history for the issue (created, field changes, comments).
  - AC: chronological, human-readable entries; lazy-loaded.
- **A3.6 — Attachments.** Presigned-URL upload flow (request URL → upload to storage → confirm metadata); list + download + delete.
  - AC: progress shown during upload; failed upload is cleaned up, not orphaned in list.

---

# Dev B — Collaboration / Settings track

### S0 — Foundation (paired with Dev A, Day 1–2)

- **B0.1 — Design tokens + Tailwind theme.** Color/spacing/typography scale, dark-mode-ready tokens.
  - AC: tokens documented; sample page renders with them.
- **B0.2 — App shell + layout.** Top bar (workspace switcher slot, profile menu, notifications bell), left nav, content area, responsive breakpoints.
  - AC: shell renders around routed content; collapses on mobile.
- **B0.3 — Routing skeleton + 404/error boundary.** Route tree for workspace/project nesting; global error boundary.
  - AC: unknown route → 404; thrown render error → boundary, not white screen.

### S4 — Design system / shared UI kit

- **B4.1 — Form primitives.** Input, Select, MultiSelect, DatePicker, Textarea wired to React Hook Form + Zod.
  - AC: each shows label/error/disabled states; Storybook or demo page exists.
- **B4.2 — Overlays.** Modal, Drawer, Confirm dialog, Tooltip (Radix-based).
  - AC: focus-trapped, ESC closes, accessible roles.
- **B4.3 — Feedback.** Toast/notification system, inline error banner mapping the API error envelope.
  - AC: `error.code` maps to friendly message; toasts auto-dismiss.
- **B4.4 — Data display.** Table, Badge (state/priority), Avatar/AvatarGroup, EmptyState, Skeleton loaders.
  - AC: reused by Dev A's issue list; consistent across app.

### S5 — Workspaces & members

- **B5.1 — Workspace picker / switcher.** List workspaces for user; create workspace (creator → owner); switch sets active workspace context.
  - AC: switching reloads scoped data; active workspace persists across reloads.
- **B5.2 — Workspace settings — general.** Rename/update workspace (`/workspaces/:slug`).
  - AC: owner/admin only; non-admin sees read-only.
- **B5.3 — Members management.** List members, add existing user, change role, remove; role-based UI gating.
  - AC: cannot remove last owner; role change reflects immediately.

### S6 — Projects + project settings

- **B6.1 — Projects list + create.** List projects in workspace; create (seeds default states server-side).
  - AC: new project appears with default states; key/identifier shown.
- **B6.2 — Project members.** Add/remove project members, roles.
  - AC: only workspace members can be added; gating respected.
- **B6.3 — States editor.** List/create/update/delete states; on delete, prompt to reassign issues to another state.
  - AC: delete blocked until target state chosen; group (`backlog…cancelled`) selectable.
- **B6.4 — Labels editor.** Project-scoped label CRUD with color.
  - AC: labels usable in Dev A's issue filters/create modal (shared types).

### S7 — Cycles & Modules

- **B7.1 — Cycles list + CRUD.** Create/edit cycles (name, start/end dates); list with status.
  - AC: date validation (end ≥ start); active cycle highlighted.
- **B7.2 — Cycle detail + issues.** Add/remove issues to a cycle; progress summary (% by state group).
  - AC: progress bar matches backend summary; add/remove updates count.
- **B7.3 — Modules list + CRUD.** Create/edit modules; many-to-many issue membership.
  - AC: an issue can belong to multiple modules; progress shown.
- **B7.4 — Module detail + issues.** Add/remove issues, progress summary.
  - AC: mirrors cycle detail behavior; reuses shared components.

### S8 — Notifications

- **B8.1 — Notifications bell + dropdown.** Poll/fetch unread count; list recent (assign/mention/comment).
  - AC: unread badge count accurate; opening lists latest notifications.
- **B8.2 — Notifications page + mark-read.** Full list with pagination; mark single/all read; deep-link to the related issue.
  - AC: marking read decrements badge; clicking navigates to the issue/comment.

---

## Suggested daily flow (how to hand out tickets)

- **Day 1–2:** Both on S0 (pair: Dev A owns API/auth plumbing A0.1–A0.3, Dev B owns shell/design tokens B0.1–B0.3). Nothing else starts until the API client + app shell exist.
- **Day 3+:** Hand out tickets top-down within each track. Dev B's S4 UI kit should lead Dev A's S2/S3 by ~1 day so shared components (Table, Badge, Modal, form inputs) exist when Dev A needs them.
- **Sync points:** shared TypeScript types for API responses (issue, label, state, member) — agree on these once, keep in `src/api/types.ts`, both import. Treat that file as a contract.

## Cross-cutting (assign to whoever has slack)

- Error envelope → toast mapping (depends B4.3).
- Loading/empty/skeleton states for every list.
- Responsive + keyboard accessibility pass.
- MSW mock handlers so frontend can run without a live backend.
- Auth-expiry edge cases (refresh race, multi-tab logout).
