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
import { createRequire } from 'node:module';
import { config, isDev, isProd } from './config/index.js';
import errorHandlerPlugin from './plugins/error-handler.js';
import swaggerPlugin from './plugins/swagger.js';
import prismaPlugin from './plugins/prisma.js';
import storagePlugin from './plugins/storage.js';
import authPlugin from './plugins/auth-hook.js';
import workspacePlugin from './plugins/workspace-hook.js';
import { authRoutes } from './modules/auth/routes.js';
import { workspaceRoutes } from './modules/workspaces/routes.js';
import { projectRoutes } from './modules/projects/routes.js';
import { stateRoutes } from './modules/states/routes.js';
import { labelRoutes } from './modules/labels/routes.js';
import { issueRoutes } from './modules/issues/routes.js';
import { commentRoutes } from './modules/comments/routes.js';
import { cycleRoutes } from './modules/cycles/routes.js';
import { moduleRoutes } from './modules/modules/routes.js';
import { issueRelationRoutes } from './modules/issues/relations/routes.js';
import { activityRoutes } from './modules/activity/routes.js';
import { attachmentRoutes, attachmentDeleteRoutes } from './modules/attachments/routes.js';
import { notificationRoutes } from './modules/notifications/routes.js';
import { inviteRoutes } from './modules/invites/routes.js';

/** True when the optional `pino-pretty` transport can be resolved at runtime. */
function isPinoPrettyAvailable(): boolean {
  try {
    createRequire(import.meta.url).resolve('pino-pretty');
    return true;
  } catch {
    return false;
  }
}

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
  if (isProd) {
    return true;
  }

  const level = config.LOG_LEVEL ?? (isDev ? 'debug' : 'info');

  // Pretty-print only in development AND only when pino-pretty is actually
  // installed. In production it is omitted (devDependency, pruned by
  // `npm install --omit=dev`); guarding here prevents a hard crash if the
  // environment is misconfigured (e.g. NODE_ENV left at its development
  // default on a production host).
  if (isDev && isPinoPrettyAvailable()) {
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
  await app.register(storagePlugin);
  await app.register(authPlugin);
  await app.register(workspacePlugin);

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

  // Feature modules under /api/v1
  await app.register(authRoutes, { prefix: '/api/v1/auth' });
  await app.register(workspaceRoutes, { prefix: '/api/v1/workspaces' });
  await app.register(projectRoutes, { prefix: '/api/v1/workspaces/:workspaceSlug/projects' });
  await app.register(stateRoutes, {
    prefix: '/api/v1/workspaces/:workspaceSlug/projects/:projectId/states',
  });
  await app.register(labelRoutes, {
    prefix: '/api/v1/workspaces/:workspaceSlug/projects/:projectId/labels',
  });
  await app.register(issueRoutes, {
    prefix: '/api/v1/workspaces/:workspaceSlug/projects/:projectId/issues',
  });
  await app.register(commentRoutes, {
    prefix: '/api/v1/workspaces/:workspaceSlug/projects/:projectId/issues/:issueId/comments',
  });
  await app.register(cycleRoutes, {
    prefix: '/api/v1/workspaces/:workspaceSlug/projects/:projectId/cycles',
  });
  await app.register(moduleRoutes, {
    prefix: '/api/v1/workspaces/:workspaceSlug/projects/:projectId/modules',
  });
  await app.register(issueRelationRoutes, {
    prefix: '/api/v1/workspaces/:workspaceSlug/projects/:projectId/issues/:issueId/relations',
  });
  await app.register(activityRoutes, {
    prefix: '/api/v1/workspaces/:workspaceSlug/projects/:projectId/issues/:issueId/activity',
  });
  await app.register(attachmentRoutes, {
    prefix: '/api/v1/workspaces/:workspaceSlug/projects/:projectId/issues/:issueId/attachments',
  });
  await app.register(attachmentDeleteRoutes, {
    prefix: '/api/v1/workspaces/:workspaceSlug/projects/:projectId/attachments',
  });
  await app.register(notificationRoutes, {
    prefix: '/api/v1/workspaces/:workspaceSlug/notifications',
  });
  await app.register(inviteRoutes, { prefix: '/api/v1/invites' });

  return app;
}
