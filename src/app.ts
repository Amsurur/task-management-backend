// Fastify application factory.
//
// `buildApp` constructs and configures the Fastify instance but does NOT call
// `listen` — that is the bootstrap's job (`server.ts`). Keeping construction
// separate from listening lets tests build an app and drive it via injection
// without binding a port.
//
// Plugins, hooks and feature modules register here. For now this is the bare
// skeleton (logging + a single liveness route); base plugins (error handler,
// swagger, etc.) and the `/api/v1` module tree land in subsequent Phase 0/1 tasks.

import Fastify, { type FastifyInstance } from 'fastify';
import type { LoggerOptions } from 'pino';
import { config, isDev } from './config/index.js';
import errorHandlerPlugin from './plugins/error-handler.js';
import swaggerPlugin from './plugins/swagger.js';
import prismaPlugin from './plugins/prisma.js';

export interface BuildAppOptions {
  /** Pino logger options, or `false`/`true` to disable/enable the default logger. */
  logger?: LoggerOptions | boolean;
}

/**
 * Sensible default logger config derived from validated config. Pretty-prints in
 * development (via pino-pretty, a dev dependency) and emits structured JSON
 * everywhere else. Request IDs are enabled by Fastify out of the box (`reqId` on
 * every log line).
 */
function defaultLogger(): LoggerOptions | boolean {
  const level = config.LOG_LEVEL ?? (isDev ? 'debug' : 'info');

  if (isDev) {
    return {
      level,
      transport: {
        target: 'pino-pretty',
        options: { translateTime: 'HH:MM:ss Z', ignore: 'pid,hostname' },
      },
    };
  }

  return { level };
}

/**
 * Build a fully-wired (but not-yet-listening) Fastify instance.
 */
export async function buildApp(opts: BuildAppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: opts.logger ?? defaultLogger(),
    // Trust the reverse proxy in front of us for client IPs / protocol.
    trustProxy: true,
    // Reject unknown content types early rather than silently.
    disableRequestLogging: false,
  });

  // --- Plugins ---------------------------------------------------------------
  // Order matters: the error handler is installed first so any later failure is
  // rendered as the standard envelope; swagger registers before routes so it can
  // capture their schemas; prisma decorates `app.prisma`. Security plugins
  // (helmet, cors, rate-limit) are added in the Phase 4 hardening pass.
  await app.register(errorHandlerPlugin);
  await app.register(swaggerPlugin);
  await app.register(prismaPlugin);

  // --- Routes ----------------------------------------------------------------
  // Liveness/readiness probe. Liveness always returns ok if the process is up;
  // readiness additionally pings the database so orchestrators don't route
  // traffic to an instance that can't reach its DB.
  app.get('/health', async (_request, reply) => {
    try {
      await app.prisma.$queryRaw`SELECT 1`;
      return { status: 'ok', uptime: process.uptime(), db: 'up' };
    } catch (err) {
      app.log.error({ err }, 'health check: database unreachable');
      return reply.status(503).send({ status: 'degraded', uptime: process.uptime(), db: 'down' });
    }
  });

  // Feature modules register under `/api/v1` starting in Phase 1.

  return app;
}
