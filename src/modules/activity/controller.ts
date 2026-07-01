import type { FastifyRequest, FastifyReply } from 'fastify';
import * as activityService from './service.js';
import { ActivityListQuerySchema } from './schema.js';

export async function listIssueActivityHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const { projectId, issueId } = request.params as { projectId: string; issueId: string };
  const query = ActivityListQuerySchema.parse(request.query);
  const result = await activityService.listIssueActivity(
    request.server.prisma,
    request.workspace.id,
    projectId,
    issueId,
    query,
  );
  reply.send(result);
}
