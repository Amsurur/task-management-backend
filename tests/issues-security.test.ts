// Integration tests: issue-module security + correctness regressions.
//
// Cross-tenant assignees/labels, sequence_id race, single-level sub-issues,
// and guest read-only enforcement on write endpoints.

import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import type { FastifyInstance } from 'fastify';

const TS = Date.now();
const OWNER_EMAIL = `sec-owner-${TS}@example.com`;
const OTHER_EMAIL = `sec-other-${TS}@example.com`;
const GUEST_EMAIL = `sec-guest-${TS}@example.com`;
const PW = 'Password123!';

let app: FastifyInstance;
let ownerToken: string;
let otherToken: string;
let guestToken: string;
let otherId: string;
let guestId: string;
let slug: string;
let otherSlug: string;
let projectId: string;
let otherProjectId: string;
let stateId: string;

const auth = (token: string): [string, string] => ['Authorization', `Bearer ${token}`];
const ws = (s: string) => `/api/v1/workspaces/${s}`;
const issuesUrl = () => `${ws(slug)}/projects/${projectId}/issues`;

const createIssue = (body: Record<string, unknown>, token = ownerToken): request.Test =>
  request(app.server)
    .post(issuesUrl())
    .set(...auth(token))
    .send({ title: 'Issue', state_id: stateId, ...body });

beforeAll(async () => {
  app = await buildApp({ logger: false });
  await app.ready();

  const reg = async (email: string): Promise<string> => {
    const res = await request(app.server)
      .post('/api/v1/auth/register')
      .send({ email, password: PW, display_name: email });
    return res.body.access_token as string;
  };
  const meId = async (token: string): Promise<string> => {
    const res = await request(app.server)
      .get('/api/v1/auth/me')
      .set(...auth(token));
    return res.body.id as string;
  };

  ownerToken = await reg(OWNER_EMAIL);
  otherToken = await reg(OTHER_EMAIL);
  guestToken = await reg(GUEST_EMAIL);
  otherId = await meId(otherToken);
  guestId = await meId(guestToken);

  slug = `sec-ws-${TS}`;
  otherSlug = `sec-other-ws-${TS}`;
  await request(app.server)
    .post('/api/v1/workspaces')
    .set(...auth(ownerToken))
    .send({ name: 'Sec WS', slug });
  await request(app.server)
    .post('/api/v1/workspaces')
    .set(...auth(otherToken))
    .send({ name: 'Other WS', slug: otherSlug });

  await request(app.server)
    .post(`${ws(slug)}/members`)
    .set(...auth(ownerToken))
    .send({ user_id: guestId, role: 'guest' });

  const project = await request(app.server)
    .post(`${ws(slug)}/projects`)
    .set(...auth(ownerToken))
    .send({ name: 'Sec Project', identifier: 'SEC' });
  projectId = project.body.id;
  const otherProject = await request(app.server)
    .post(`${ws(otherSlug)}/projects`)
    .set(...auth(otherToken))
    .send({ name: 'Other Project', identifier: 'OTH' });
  otherProjectId = otherProject.body.id;

  const states = await request(app.server)
    .get(`${ws(slug)}/projects/${projectId}/states`)
    .set(...auth(ownerToken));
  stateId = states.body[0].id;
});

afterAll(async () => {
  await app.prisma.workspace.deleteMany({ where: { slug: { in: [slug, otherSlug] } } });
  await app.prisma.user.deleteMany({
    where: { email: { in: [OWNER_EMAIL, OTHER_EMAIL, GUEST_EMAIL] } },
  });
  await app.close();
});

describe('issue assignee/label validation', () => {
  it('rejects creating an issue with an assignee from another workspace', async () => {
    const res = await createIssue({ assignee_ids: [otherId] });
    expect(res.status).toBe(400);
  });

  it('rejects adding a non-member as assignee', async () => {
    const issue = await createIssue({});
    expect(issue.status).toBe(201);
    const res = await request(app.server)
      .post(`${issuesUrl()}/${issue.body.id}/assignees`)
      .set(...auth(ownerToken))
      .send({ user_id: otherId });
    expect(res.status).toBe(400);
  });

  it('rejects creating an issue with a label from another project', async () => {
    const label = await request(app.server)
      .post(`${ws(otherSlug)}/projects/${otherProjectId}/labels`)
      .set(...auth(otherToken))
      .send({ name: 'foreign', color: '#112233' });
    expect(label.status).toBe(201);
    const res = await createIssue({ label_ids: [label.body.id] });
    expect(res.status).toBe(400);
  });
});

describe('sequence ids', () => {
  it('assigns distinct sequential ids under concurrent creation', async () => {
    const bigProject = await request(app.server)
      .post(`${ws(slug)}/projects`)
      .set(...auth(ownerToken))
      .send({ name: 'Concurrent', identifier: 'CON' });
    const pid = bigProject.body.id as string;
    const states = await request(app.server)
      .get(`${ws(slug)}/projects/${pid}/states`)
      .set(...auth(ownerToken));
    const sid = states.body[0].id as string;

    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        request(app.server)
          .post(`${ws(slug)}/projects/${pid}/issues`)
          .set(...auth(ownerToken))
          .send({ title: `Concurrent ${i}`, state_id: sid }),
      ),
    );
    expect(results.every((r) => r.status === 201)).toBe(true);
    const ids = results.map((r) => r.body.sequence_id as number).sort((a, b) => a - b);
    expect(ids).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });
});

describe('single-level sub-issues', () => {
  it('rejects making an issue that has children into a sub-issue', async () => {
    const parent = await createIssue({ title: 'Parent' });
    const child = await createIssue({ title: 'Child', parent_id: parent.body.id });
    expect(child.status).toBe(201);
    const top = await createIssue({ title: 'Top' });

    const res = await request(app.server)
      .patch(`${issuesUrl()}/${parent.body.id}`)
      .set(...auth(ownerToken))
      .send({ parent_id: top.body.id });
    expect(res.status).toBe(400);
  });
});

describe('guest read-only', () => {
  it('lets a guest read issues', async () => {
    const res = await request(app.server)
      .get(issuesUrl())
      .set(...auth(guestToken));
    expect(res.status).toBe(200);
  });

  it('blocks a guest from creating issues and comments', async () => {
    const res = await createIssue({}, guestToken);
    expect(res.status).toBe(403);

    const issue = await createIssue({});
    const comment = await request(app.server)
      .post(`${issuesUrl()}/${issue.body.id}/comments`)
      .set(...auth(guestToken))
      .send({ body: 'hi' });
    expect(comment.status).toBe(403);
  });
});
