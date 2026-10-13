// Integration tests for workspace leave / transfer-ownership.

import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import type { FastifyInstance } from 'fastify';

const PREFIX = `ws-${Date.now()}`;
const PASSWORD = 'Password123!';
const emails: string[] = [];
const slugs: string[] = [];

let app: FastifyInstance;

interface TestUser {
  id: string;
  token: string;
}

async function register(tag: string): Promise<TestUser> {
  const email = `${PREFIX}-${tag}@example.com`;
  emails.push(email);
  const res = await request(app.server)
    .post('/api/v1/auth/register')
    .send({ email, password: PASSWORD, display_name: `User ${tag}` });
  expect(res.status).toBe(201);
  return { id: res.body.user.id, token: res.body.access_token };
}

async function createWorkspace(owner: TestUser, tag: string): Promise<string> {
  const slug = `${PREFIX}-${tag}`;
  slugs.push(slug);
  const res = await request(app.server)
    .post('/api/v1/workspaces')
    .set('Authorization', `Bearer ${owner.token}`)
    .send({ name: `Workspace ${tag}`, slug });
  expect(res.status).toBe(201);
  return slug;
}

async function addMember(owner: TestUser, slug: string, user: TestUser): Promise<void> {
  const res = await request(app.server)
    .post(`/api/v1/workspaces/${slug}/members`)
    .set('Authorization', `Bearer ${owner.token}`)
    .send({ user_id: user.id, role: 'member' });
  expect(res.status).toBe(201);
}

beforeAll(async () => {
  app = await buildApp({ logger: false });
  await app.ready();
});

afterAll(async () => {
  await app.prisma.workspace.deleteMany({ where: { slug: { in: slugs } } });
  await app.prisma.user.deleteMany({ where: { email: { in: emails } } });
  await app.close();
});

describe('leave workspace', () => {
  it('lets a member leave and then loses access', async () => {
    const owner = await register('leave-owner');
    const member = await register('leave-member');
    const slug = await createWorkspace(owner, 'leave');
    await addMember(owner, slug, member);

    const leave = await request(app.server)
      .post(`/api/v1/workspaces/${slug}/leave`)
      .set('Authorization', `Bearer ${member.token}`);
    expect(leave.status).toBe(204);

    const get = await request(app.server)
      .get(`/api/v1/workspaces/${slug}`)
      .set('Authorization', `Bearer ${member.token}`);
    expect(get.status).toBe(403);
  });

  it('forbids the owner from leaving', async () => {
    const owner = await register('leave-owner2');
    const slug = await createWorkspace(owner, 'leave2');

    const res = await request(app.server)
      .post(`/api/v1/workspaces/${slug}/leave`)
      .set('Authorization', `Bearer ${owner.token}`);
    expect(res.status).toBe(403);
  });
});

describe('transfer ownership', () => {
  it('promotes the target to owner and demotes the old owner to admin', async () => {
    const owner = await register('xfer-owner');
    const member = await register('xfer-member');
    const slug = await createWorkspace(owner, 'xfer');
    await addMember(owner, slug, member);

    const res = await request(app.server)
      .post(`/api/v1/workspaces/${slug}/transfer-ownership`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ user_id: member.id });
    expect(res.status).toBe(200);
    expect(res.body.owner_id).toBe(member.id);

    const ws = await app.prisma.workspace.findUniqueOrThrow({ where: { slug } });
    const roles = await app.prisma.workspaceMember.findMany({ where: { workspace_id: ws.id } });
    expect(roles.find((m) => m.user_id === member.id)?.role).toBe('owner');
    expect(roles.find((m) => m.user_id === owner.id)?.role).toBe('admin');
  });

  it('forbids non-owners', async () => {
    const owner = await register('xfer-owner2');
    const member = await register('xfer-member2');
    const slug = await createWorkspace(owner, 'xfer2');
    await addMember(owner, slug, member);

    const res = await request(app.server)
      .post(`/api/v1/workspaces/${slug}/transfer-ownership`)
      .set('Authorization', `Bearer ${member.token}`)
      .send({ user_id: member.id });
    expect(res.status).toBe(403);
  });

  it('rejects transferring to a non-member', async () => {
    const owner = await register('xfer-owner3');
    const outsider = await register('xfer-outsider');
    const slug = await createWorkspace(owner, 'xfer3');

    const res = await request(app.server)
      .post(`/api/v1/workspaces/${slug}/transfer-ownership`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ user_id: outsider.id });
    expect(res.status).toBe(404);
  });
});
