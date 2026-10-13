// Centralized error handler + not-found handler.
//
// Every error leaving a route funnels through here and is rendered as the TZ
// error envelope `{ error: { code, message, details } }`:
//   - AppError                  → its own status/code/message/details
//   - Fastify schema validation → 400 VALIDATION_ERROR with the failing fields
//   - ZodError                  → 400 VALIDATION_ERROR with flattened issues
//   - Prisma P2002/P2025/P2003  → 409 CONFLICT / 404 NOT_FOUND / 400 BAD_REQUEST
//   - other errors w/ <500      → passed through (e.g. 429 from rate-limit)
//   - everything else           → 500 INTERNAL_ERROR, full detail logged not leaked
//
// Unknown 500s never leak internals to the client; the request id is returned so
// a caller can quote it when reporting a problem, and the full error is logged.

import fp from 'fastify-plugin';
import type { FastifyError, FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { Prisma } from '@prisma/client';
import { AppError, toEnvelope } from '../lib/errors.js';

async function errorHandlerPlugin(app: FastifyInstance): Promise<void> {
  app.setErrorHandler((error: FastifyError, request, reply) => {
    // Expected, client-facing errors from services.
    if (error instanceof AppError) {
      return reply
        .status(error.statusCode)
        .send(toEnvelope(error.code, error.message, error.details));
    }

    // Prisma known request errors → client-facing HTTP codes.
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') {
        return reply
          .status(409)
          .send(toEnvelope('CONFLICT', 'Resource already exists', { target: error.meta?.target }));
      }
      if (error.code === 'P2025') {
        return reply.status(404).send(toEnvelope('NOT_FOUND', 'Resource not found'));
      }
      if (error.code === 'P2003') {
        return reply
          .status(400)
          .send(toEnvelope('BAD_REQUEST', 'Invalid reference to a related resource'));
      }
    }

    // Fastify request-schema validation failures.
    if (error.validation) {
      return reply
        .status(400)
        .send(toEnvelope('VALIDATION_ERROR', 'Request validation failed', error.validation));
    }

    // Zod errors thrown inside services/controllers.
    if (error instanceof ZodError) {
      return reply
        .status(400)
        .send(toEnvelope('VALIDATION_ERROR', 'Request validation failed', error.flatten()));
    }

    // Other Fastify errors that already carry a client-side status (e.g. the
    // 429 from @fastify/rate-limit, body-parse 400s). Trust their status/message.
    const status = error.statusCode ?? 500;
    if (status < 500) {
      const code = status === 429 ? 'RATE_LIMITED' : 'BAD_REQUEST';
      return reply.status(status).send(toEnvelope(code, error.message));
    }

    // Unknown failure: log everything, leak nothing.
    request.log.error({ err: error }, 'unhandled error');
    return reply
      .status(500)
      .send(
        toEnvelope('INTERNAL_ERROR', 'An unexpected error occurred', { requestId: request.id }),
      );
  });

  app.setNotFoundHandler((request, reply) => {
    return reply
      .status(404)
      .send(toEnvelope('NOT_FOUND', `Route ${request.method} ${request.url} not found`));
  });
}

export default fp(errorHandlerPlugin, { name: 'error-handler' });
