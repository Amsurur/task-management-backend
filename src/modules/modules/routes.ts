import type { FastifyInstance } from 'fastify';
import { authenticate } from '../../plugins/auth-hook.js';
import { requireWorkspaceMember } from '../../plugins/workspace-hook.js';
import {
  listModulesSchema,
  createModuleSchema,
  getModuleSchema,
  updateModuleSchema,
  deleteModuleSchema,
  addIssuesToModuleSchema,
  removeIssueFromModuleSchema,
} from './schema.js';
import {
  listModulesHandler,
  createModuleHandler,
  getModuleHandler,
  updateModuleHandler,
  deleteModuleHandler,
  addIssuesToModuleHandler,
  removeIssueFromModuleHandler,
} from './controller.js';

export async function moduleRoutes(app: FastifyInstance): Promise<void> {
  const member = [authenticate, requireWorkspaceMember()];
  const writer = [authenticate, requireWorkspaceMember('member')];

  app.get('/', { schema: listModulesSchema, preHandler: member }, listModulesHandler);
  app.post('/', { schema: createModuleSchema, preHandler: writer }, createModuleHandler);

  app.get('/:moduleId', { schema: getModuleSchema, preHandler: member }, getModuleHandler);
  app.patch('/:moduleId', { schema: updateModuleSchema, preHandler: writer }, updateModuleHandler);
  app.delete('/:moduleId', { schema: deleteModuleSchema, preHandler: writer }, deleteModuleHandler);

  // Issue membership
  app.post(
    '/:moduleId/issues',
    { schema: addIssuesToModuleSchema, preHandler: writer },
    addIssuesToModuleHandler,
  );
  app.delete(
    '/:moduleId/issues/:issueId',
    { schema: removeIssueFromModuleSchema, preHandler: writer },
    removeIssueFromModuleHandler,
  );
}
