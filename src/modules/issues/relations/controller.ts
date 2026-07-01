import type { FastifyRequest, FastifyReply } from 'fastify';
import * as relationService from './service.js';
import { CreateRelationBodySchema } from './schema.js';

export async function listRelationsHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const { projectId, issueId } = request.params as { projectId: string; issueId: string };
  const result = await relationService.listRelations(
    request.server.prisma,
    request.workspace.id,
    projectId,
    issueId,
  );
  reply.send(result);
}

export async function createRelationHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const { projectId, issueId } = request.params as { projectId: string; issueId: string };
  const body = CreateRelationBodySchema.parse(request.body);
  const link = await relationService.createRelation(
    request.server.prisma,
    request.workspace.id,
    projectId,
    issueId,
    body,
  );
  reply.code(201).send(link);
}

export async function deleteRelationHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const { projectId, issueId, linkId } = request.params as {
    projectId: string;
    issueId: string;
    linkId: string;
  };
  await relationService.deleteRelation(
    request.server.prisma,
    request.workspace.id,
    projectId,
    issueId,
    linkId,
  );
  reply.code(204).send();
}
