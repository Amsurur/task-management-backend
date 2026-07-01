import type { FastifyInstance } from 'fastify';
import { authenticate } from '../../../plugins/auth-hook.js';
import { requireWorkspaceMember } from '../../../plugins/workspace-hook.js';
import { listRelationsSchema, createRelationSchema, deleteRelationSchema } from './schema.js';
import {
  listRelationsHandler,
  createRelationHandler,
  deleteRelationHandler,
} from './controller.js';

export async function issueRelationRoutes(app: FastifyInstance): Promise<void> {
  const member = [authenticate, requireWorkspaceMember()];

  app.get('/', { schema: listRelationsSchema, preHandler: member }, listRelationsHandler);
  app.post('/', { schema: createRelationSchema, preHandler: member }, createRelationHandler);
  app.delete(
    '/:linkId',
    { schema: deleteRelationSchema, preHandler: member },
    deleteRelationHandler,
  );
}
