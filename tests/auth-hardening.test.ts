// Regression tests for auth hardening: email case-insensitivity, atomic refresh
// rotation, deactivated users, and change-password.

import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import type { FastifyInstance } from 'fastify';

const PREFIX = `hard-${Date.now()}`;
const PASSWORD = 'Password123!';
const emails: string[] = [];

let app: FastifyInstance;

function uniqueEmail(tag: string): string {
  const e = `${PREFIX}-${tag}@example.com`;
  emails.push(e);
  return e;
}

async function register(email: string): Promise<{ refresh: string; access: string; id: string }> {
  const res = await request(app.server)
    .post('/api/v1/auth/register')
    .send({ email, password: PASSWORD, display_name: 'Hardening Tester' });
  expect(res.status).toBe(201);
  return { refresh: res.body.refresh_token, access: res.body.access_token, id: res.body.user.id };
}

beforeAll(async () => {
  app = await buildApp({ logger: false });
  await app.ready();
});

afterAll(async () => {
  await app.prisma.user.deleteMany({ where: { email: { in: emails } } });
  await app.close();
});

describe('email case-insensitivity', () => {
  it('stores lowercase, allows lowercase login, rejects lowercase duplicate', async () => {
    const lower = uniqueEmail('case');
    const mixed = lower.replace('hard', 'HaRd').replace('example', 'Example');

    const reg = await request(app.server)
      .post('/api/v1/auth/register')
      .send({ email: mixed, password: PASSWORD, display_name: 'Case Tester' });
    expect(reg.status).toBe(201);
    expect(reg.body.user.email).toBe(lower);

    const login = await request(app.server)
      .post('/api/v1/auth/login')
      .send({ email: lower, password: PASSWORD });
    expect(login.status).toBe(200);

    const dup = await request(app.server)
      .post('/api/v1/auth/register')
      .send({ email: lower, password: PASSWORD, display_name: 'Dup' });
    expect(dup.status).toBe(409);
  });
});

describe('refresh token rotation', () => {
  it('lets exactly one of two concurrent refreshes with the same token succeed', async () => {
    const { refresh } = await register(uniqueEmail('race'));

    const results = await Promise.all(
      [0, 1].map(() =>
        request(app.server).post('/api/v1/auth/refresh').send({ refresh_token: refresh }),
      ),
    );
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([200, 401]);
  });

  it('rejects refresh for a deactivated user with 403', async () => {
    const email = uniqueEmail('inactive');
    const { refresh, id } = await register(email);
    await app.prisma.user.update({ where: { id }, data: { is_active: false } });

    const res = await request(app.server)
      .post('/api/v1/auth/refresh')
      .send({ refresh_token: refresh });
    expect(res.status).toBe(403);
  });
});

describe('change-password', () => {
  it('rejects a wrong current password', async () => {
    const { access } = await register(uniqueEmail('cp-wrong'));
    const res = await request(app.server)
      .post('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${access}`)
      .send({ current_password: 'not-the-password', new_password: 'NewPassword456!' });
    expect(res.status).toBe(401);
  });

  it('requires authentication', async () => {
    const res = await request(app.server)
      .post('/api/v1/auth/change-password')
      .send({ current_password: PASSWORD, new_password: 'NewPassword456!' });
    expect(res.status).toBe(401);
  });

  it('changes the password, revokes refresh tokens, and allows login with the new one', async () => {
    const email = uniqueEmail('cp-ok');
    const { access, refresh } = await register(email);
    const newPassword = 'NewPassword456!';

    const res = await request(app.server)
      .post('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${access}`)
      .send({ current_password: PASSWORD, new_password: newPassword });
    expect(res.status).toBe(204);

    const old = await request(app.server)
      .post('/api/v1/auth/refresh')
      .send({ refresh_token: refresh });
    expect(old.status).toBe(401);

    const oldLogin = await request(app.server)
      .post('/api/v1/auth/login')
      .send({ email, password: PASSWORD });
    expect(oldLogin.status).toBe(401);

    const newLogin = await request(app.server)
      .post('/api/v1/auth/login')
      .send({ email, password: newPassword });
    expect(newLogin.status).toBe(200);
  });
});
