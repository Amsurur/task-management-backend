import type { FastifyInstance } from 'fastify';
import { authenticate } from '../../plugins/auth-hook.js';
import { requireWorkspaceMember } from '../../plugins/workspace-hook.js';
import { listIssueActivitySchema } from './schema.js';
import { listIssueActivityHandler } from './controller.js';

export async function activityRoutes(app: FastifyInstance): Promise<void> {
  const member = [authenticate, requireWorkspaceMember()];

  app.get('/', { schema: listIssueActivitySchema, preHandler: member }, listIssueActivityHandler);
}
