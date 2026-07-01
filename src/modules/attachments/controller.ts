import type { FastifyRequest, FastifyReply } from 'fastify';
import * as attachmentService from './service.js';
import { CreateAttachmentBodySchema } from './schema.js';

export async function listAttachmentsHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const { projectId, issueId } = request.params as { projectId: string; issueId: string };
  const result = await attachmentService.listAttachments(
    request.server.prisma,
    request.server.storage,
    request.workspace.id,
    projectId,
    issueId,
  );
  reply.send(result);
}

export async function createAttachmentHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const { projectId, issueId } = request.params as { projectId: string; issueId: string };
  const body = CreateAttachmentBodySchema.parse(request.body);
  const result = await attachmentService.createAttachment(
    request.server.prisma,
    request.server.storage,
    request.workspace.id,
    projectId,
    issueId,
    request.userId,
    body,
  );
  reply.code(201).send(result);
}

export async function deleteAttachmentHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const { projectId, attachmentId } = request.params as {
    projectId: string;
    attachmentId: string;
  };
  await attachmentService.deleteAttachment(
    request.server.prisma,
    request.server.storage,
    request.workspace.id,
    projectId,
    attachmentId,
    request.userId,
    request.workspaceMember.role,
  );
  reply.code(204).send();
}
