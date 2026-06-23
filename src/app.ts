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
  // Base plugins (helmet, cors, rate-limit, swagger, error handler) register
  // here in the "Base plugins" Phase 0 task.

  // --- Routes ----------------------------------------------------------------
  // Liveness/readiness probe. A real readiness check (DB ping) is added once
  // Prisma is wired; for the skeleton this confirms the process is up.
  app.get('/health', async () => {
    return { status: 'ok', uptime: process.uptime() };
  });

  // Feature modules register under `/api/v1` starting in Phase 1.

  return app;
}
