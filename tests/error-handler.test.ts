// Harness smoke test + error-handler behavior.
//
// Mounts the error-handler plugin on a bare Fastify instance and drives it over
// HTTP with Supertest. Needs no database, so `npm test` is green from a clean
// checkout — proving the Vitest + Supertest harness works while exercising real
// production code (the TZ error envelope).

import Fastify, { type FastifyInstance } from 'fastify';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import errorHandlerPlugin from '../src/plugins/error-handler.js';
import { AppError } from '../src/lib/errors.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = Fastify({ logger: false });
  await app.register(errorHandlerPlugin);

  app.get('/boom-app-error', async () => {
    throw AppError.notFound('Issue not found');
  });
  app.get('/boom-unexpected', async () => {
    throw new Error('kaboom: secret internal detail');
  });
  app.post('/validate', {
    schema: {
      body: { type: 'object', required: ['name'], properties: { name: { type: 'string' } } },
    },
    handler: async () => ({ ok: true }),
  });

  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe('error handler', () => {
  it('renders an AppError as the TZ envelope with its status', async () => {
    const res = await request(app.server).get('/boom-app-error');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: { code: 'NOT_FOUND', message: 'Issue not found' } });
  });

  it('maps schema validation failures to 400 VALIDATION_ERROR', async () => {
    const res = await request(app.server).post('/validate').send({});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details).toBeDefined();
  });

  it('hides internal detail on unexpected errors and returns a request id', async () => {
    const res = await request(app.server).get('/boom-unexpected');
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
    expect(res.body.error.message).not.toContain('secret internal detail');
    expect(res.body.error.details).toHaveProperty('requestId');
  });

  it('returns the NOT_FOUND envelope for unknown routes', async () => {
    const res = await request(app.server).get('/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});
