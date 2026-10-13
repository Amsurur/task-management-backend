import type { FastifyInstance } from 'fastify';
import { authenticate } from '../../plugins/auth-hook.js';
import { requireWorkspaceMember } from '../../plugins/workspace-hook.js';
import {
  listIssuesSchema,
  createIssueSchema,
  getIssueSchema,
  updateIssueSchema,
  deleteIssueSchema,
  addAssigneeSchema,
  removeAssigneeSchema,
  addLabelSchema,
  removeLabelSchema,
} from './schema.js';
import {
  listIssuesHandler,
  createIssueHandler,
  getIssueHandler,
  updateIssueHandler,
  deleteIssueHandler,
  addAssigneeHandler,
  removeAssigneeHandler,
  addLabelHandler,
  removeLabelHandler,
} from './controller.js';

export async function issueRoutes(app: FastifyInstance): Promise<void> {
  const member = [authenticate, requireWorkspaceMember()];
  const writer = [authenticate, requireWorkspaceMember('member')];

  app.get('/', { schema: listIssuesSchema, preHandler: member }, listIssuesHandler);
  app.post('/', { schema: createIssueSchema, preHandler: writer }, createIssueHandler);

  app.get('/:issueId', { schema: getIssueSchema, preHandler: member }, getIssueHandler);
  app.patch('/:issueId', { schema: updateIssueSchema, preHandler: writer }, updateIssueHandler);
  app.delete('/:issueId', { schema: deleteIssueSchema, preHandler: writer }, deleteIssueHandler);

  // Assignees
  app.post(
    '/:issueId/assignees',
    { schema: addAssigneeSchema, preHandler: writer },
    addAssigneeHandler,
  );
  app.delete(
    '/:issueId/assignees/:userId',
    { schema: removeAssigneeSchema, preHandler: writer },
    removeAssigneeHandler,
  );

  // Labels
  app.post('/:issueId/labels', { schema: addLabelSchema, preHandler: writer }, addLabelHandler);
  app.delete(
    '/:issueId/labels/:labelId',
    { schema: removeLabelSchema, preHandler: writer },
    removeLabelHandler,
  );
}
