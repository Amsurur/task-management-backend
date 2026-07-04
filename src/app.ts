import { createRequire } from 'module';
import Fastify, { type FastifyInstance } from 'fastify';
import type { LoggerOptions } from 'pino';
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
import websocket from '@fastify/websocket';
import { workspaceInviteRoutes, publicInviteRoutes } from './modules/invites/routes.js';
import {
  contactRoutes,
  conversationRoutes,
  workspaceConversationRoutes,
  chatWsRoutes,
} from './modules/chat/routes.js';
import { aiRoutes } from './modules/ai/routes.js';
import { userRoutes } from './modules/users/routes.js';

export interface BuildAppOptions {
  logger?: LoggerOptions | boolean;
}

function isPinoPrettyAvailable(): boolean {
  try {
    createRequire(import.meta.url).resolve('pino-pretty');
    return true;
  } catch {
    return false;
  }
}

function defaultLogger(): LoggerOptions | boolean {
  if (isProd) {
    return true;
  }

  const level = config.LOG_LEVEL ?? (isDev ? 'debug' : 'info');

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

export async function buildApp(opts: BuildAppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: opts.logger ?? defaultLogger(),
    trustProxy: true,
    disableRequestLogging: false,
  });

  await app.register(errorHandlerPlugin);
  await app.register(swaggerPlugin);
  await app.register(prismaPlugin);
  await app.register(storagePlugin);
  await app.register(authPlugin);
  await app.register(workspacePlugin);
  await app.register(websocket);

  app.get('/health', async (_request, reply) => {
    try {
      await app.prisma.$queryRaw`SELECT 1`;
      return { status: 'ok', uptime: process.uptime(), db: 'up' };
    } catch (err) {
      app.log.error({ err }, 'health check: database unreachable');
      return reply.status(503).send({ status: 'degraded', uptime: process.uptime(), db: 'down' });
    }
  });

  await app.register(authRoutes, { prefix: '/api/v1/auth' });
  await app.register(workspaceRoutes, { prefix: '/api/v1/workspaces' });
  await app.register(userRoutes, { prefix: '/api/v1/users' });
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

  await app.register(publicInviteRoutes, { prefix: '/api/v1/invites' });
  await app.register(workspaceInviteRoutes, {
    prefix: '/api/v1/workspaces/:workspaceSlug/invites',
  });

  await app.register(contactRoutes, { prefix: '/api/v1/contacts' });
  await app.register(conversationRoutes, { prefix: '/api/v1/conversations' });
  await app.register(workspaceConversationRoutes, {
    prefix: '/api/v1/workspaces/:workspaceSlug/conversations',
  });
  await app.register(chatWsRoutes, { prefix: '/api/v1/ws' });

  await app.register(aiRoutes, { prefix: '/api/v1/ai' });

  return app;
}