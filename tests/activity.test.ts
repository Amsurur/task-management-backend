// Integration tests: issue activity feed.
//
// Exercises the full audit-trail flow — a sequence of issue mutations (create,
// field update, assignee add, label attach, comment) should each append an entry
// to the issue's activity feed, newest first. Also verifies the feed is
// workspace-scoped (an outsider cannot read it).

import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import type { FastifyInstance } from 'fastify';

const TS = Date.now();
const OWNER_EMAIL = `act-owner-${TS}@example.com`;
const OUTSIDER_EMAIL = `act-outsider-${TS}@example.com`;
const PW = 'Password123!';

let app: FastifyInstance;
let ownerToken: string;
let ownerId: string;
let outsiderToken: string;
let workspaceSlug: string;
let projectId: string;
let issueId: string;

const auth = (token: string): [string, string] => ['Authorization', `Bearer ${token}`];

beforeAll(async () => {
  app = await buildApp({ logger: false });
  await app.ready();

  // Owner registers, creates a workspace + project (default states seeded).
  const ownerReg = await request(app.server)
    .post('/api/v1/auth/register')
    .send({ email: OWNER_EMAIL, password: PW, display_name: 'Owner' });
  ownerToken = ownerReg.body.access_token;

  const ownerMe = await request(app.server)
    .get('/api/v1/auth/me')
    .set(...auth(ownerToken));
  ownerId = ownerMe.body.id;

  const outsiderReg = await request(app.server)
    .post('/api/v1/auth/register')
    .send({ email: OUTSIDER_EMAIL, password: PW, display_name: 'Outsider' });
  outsiderToken = outsiderReg.body.access_token;

  workspaceSlug = `act-ws-${TS}`;
  await request(app.server)
    .post('/api/v1/workspaces')
    .set(...auth(ownerToken))
    .send({ name: 'Activity Workspace', slug: workspaceSlug });

  const project = await request(app.server)
    .post(`/api/v1/workspaces/${workspaceSlug}/projects`)
    .set(...auth(ownerToken))
    .send({ name: 'Activity Project', identifier: 'ACT' });
  projectId = project.body.id;

  // Need a state to create issues against.
  const states = await request(app.server)
    .get(`/api/v1/workspaces/${workspaceSlug}/projects/${projectId}/states`)
    .set(...auth(ownerToken));
  const stateId = states.body[0].id;

  const issue = await request(app.server)
    .post(`/api/v1/workspaces/${workspaceSlug}/projects/${projectId}/issues`)
    .set(...auth(ownerToken))
    .send({ title: 'Trackable issue', state_id: stateId });
  issueId = issue.body.id;
});

afterAll(async () => {
  await app.prisma.workspace.deleteMany({ where: { slug: workspaceSlug } });
  await app.prisma.user.deleteMany({ where: { email: { in: [OWNER_EMAIL, OUTSIDER_EMAIL] } } });
  await app.close();
});

const activityUrl = () =>
  `/api/v1/workspaces/${workspaceSlug}/projects/${projectId}/issues/${issueId}/activity`;

describe('issue activity feed', () => {
  it('records issue.created when the issue is created', async () => {
    const res = await request(app.server)
      .get(activityUrl())
      .set(...auth(ownerToken));
    expect(res.status).toBe(200);
    const actions = (res.body.data as Array<{ action: string }>).map((a) => a.action);
    expect(actions).toContain('issue.created');
  });

  it('records a field change on update with old/new values', async () => {
    await request(app.server)
      .patch(`/api/v1/workspaces/${workspaceSlug}/projects/${projectId}/issues/${issueId}`)
      .set(...auth(ownerToken))
      .send({ title: 'Renamed issue' });

    const res = await request(app.server)
      .get(activityUrl())
      .set(...auth(ownerToken));
    const titleChange = (
      res.body.data as Array<{
        action: string;
        field: string;
        old_value: string;
        new_value: string;
      }>
    ).find((a) => a.action === 'issue.updated' && a.field === 'title');
    expect(titleChange).toBeDefined();
    expect(titleChange?.old_value).toBe('Trackable issue');
    expect(titleChange?.new_value).toBe('Renamed issue');
  });

  it('records assignee, label, and comment events', async () => {
    // Assign the owner.
    await request(app.server)
      .post(`/api/v1/workspaces/${workspaceSlug}/projects/${projectId}/issues/${issueId}/assignees`)
      .set(...auth(ownerToken))
      .send({ user_id: ownerId });

    // Create + attach a label.
    const label = await request(app.server)
      .post(`/api/v1/workspaces/${workspaceSlug}/projects/${projectId}/labels`)
      .set(...auth(ownerToken))
      .send({ name: 'urgent', color: '#ff0000' });
    await request(app.server)
      .post(`/api/v1/workspaces/${workspaceSlug}/projects/${projectId}/issues/${issueId}/labels`)
      .set(...auth(ownerToken))
      .send({ label_id: label.body.id });

    // Post a comment.
    await request(app.server)
      .post(`/api/v1/workspaces/${workspaceSlug}/projects/${projectId}/issues/${issueId}/comments`)
      .set(...auth(ownerToken))
      .send({ body: 'first comment' });

    const res = await request(app.server)
      .get(activityUrl())
      .set(...auth(ownerToken));
    const actions = (res.body.data as Array<{ action: string }>).map((a) => a.action);
    expect(actions).toContain('issue.assignee_added');
    expect(actions).toContain('issue.label_added');
    expect(actions).toContain('comment.created');
  });

  it('returns entries newest-first and embeds the actor', async () => {
    const res = await request(app.server)
      .get(activityUrl())
      .set(...auth(ownerToken));
    const entries = res.body.data as Array<{ created_at: string; actor: { id: string } }>;
    expect(entries.length).toBeGreaterThan(1);
    // Descending by created_at.
    for (let i = 1; i < entries.length; i++) {
      expect(entries[i - 1].created_at >= entries[i].created_at).toBe(true);
    }
    expect(entries[0].actor.id).toBe(ownerId);
  });

  it('paginates with limit + cursor', async () => {
    const first = await request(app.server)
      .get(`${activityUrl()}?limit=2`)
      .set(...auth(ownerToken));
    expect(first.body.data).toHaveLength(2);
    expect(first.body.next_cursor).toBeTruthy();

    const second = await request(app.server)
      .get(`${activityUrl()}?limit=2&cursor=${first.body.next_cursor}`)
      .set(...auth(ownerToken));
    expect(second.status).toBe(200);
    const firstIds = (first.body.data as Array<{ id: string }>).map((a) => a.id);
    const secondIds = (second.body.data as Array<{ id: string }>).map((a) => a.id);
    expect(secondIds.some((id) => firstIds.includes(id))).toBe(false);
  });

  it('denies an outsider access to the feed', async () => {
    const res = await request(app.server)
      .get(activityUrl())
      .set(...auth(outsiderToken));
    expect(res.status).toBe(403);
  });
});
