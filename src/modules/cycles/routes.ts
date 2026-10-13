import type { FastifyInstance } from 'fastify';
import { authenticate } from '../../plugins/auth-hook.js';
import { requireWorkspaceMember } from '../../plugins/workspace-hook.js';
import {
  listCyclesSchema,
  createCycleSchema,
  getCycleSchema,
  updateCycleSchema,
  deleteCycleSchema,
  addIssuesToCycleSchema,
  removeIssueFromCycleSchema,
} from './schema.js';
import {
  listCyclesHandler,
  createCycleHandler,
  getCycleHandler,
  updateCycleHandler,
  deleteCycleHandler,
  addIssuesToCycleHandler,
  removeIssueFromCycleHandler,
} from './controller.js';

export async function cycleRoutes(app: FastifyInstance): Promise<void> {
  const member = [authenticate, requireWorkspaceMember()];
  const writer = [authenticate, requireWorkspaceMember('member')];

  app.get('/', { schema: listCyclesSchema, preHandler: member }, listCyclesHandler);
  app.post('/', { schema: createCycleSchema, preHandler: writer }, createCycleHandler);

  app.get('/:cycleId', { schema: getCycleSchema, preHandler: member }, getCycleHandler);
  app.patch('/:cycleId', { schema: updateCycleSchema, preHandler: writer }, updateCycleHandler);
  app.delete('/:cycleId', { schema: deleteCycleSchema, preHandler: writer }, deleteCycleHandler);

  // Issue membership
  app.post(
    '/:cycleId/issues',
    { schema: addIssuesToCycleSchema, preHandler: writer },
    addIssuesToCycleHandler,
  );
  app.delete(
    '/:cycleId/issues/:issueId',
    { schema: removeIssueFromCycleSchema, preHandler: writer },
    removeIssueFromCycleHandler,
  );
}
