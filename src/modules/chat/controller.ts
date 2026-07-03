import type { FastifyRequest, FastifyReply } from 'fastify';
import * as chatService from './service.js';
import { chatHub } from './realtime.js';
import {
  SendContactRequestBodySchema,
  ContactRequestsQuerySchema,
  CreateDirectBodySchema,
  CreateGroupBodySchema,
  AddConversationMemberBodySchema,
  RenameConversationBodySchema,
  ListMessagesQuerySchema,
  SendMessageBodySchema,
  EditMessageBodySchema,
  ChatAttachmentBodySchema,
  ReactionBodySchema,
  REACTION_EMOJIS,
} from './schema.js';

// ─── Contacts ───────────────────────────────────────────────────────────────

export async function sendContactRequestHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const body = SendContactRequestBodySchema.parse(request.body);
  const contact = await chatService.sendContactRequest(
    request.server.prisma,
    request.userId,
    body.user_id,
  );
  reply.code(201).send(contact);
}

export async function listContactRequestsHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const { direction } = ContactRequestsQuerySchema.parse(request.query);
  const requests = await chatService.listContactRequests(
    request.server.prisma,
    request.userId,
    direction,
  );
  reply.send(requests);
}

export async function acceptContactRequestHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const { id } = request.params as { id: string };
  const contact = await chatService.respondToContactRequest(
    request.server.prisma,
    request.userId,
    id,
    true,
  );
  reply.send(contact);
}

export async function declineContactRequestHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const { id } = request.params as { id: string };
  const contact = await chatService.respondToContactRequest(
    request.server.prisma,
    request.userId,
    id,
    false,
  );
  reply.send(contact);
}

export async function listContactsHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const contacts = await chatService.listContacts(request.server.prisma, request.userId);
  reply.send(contacts);
}

// ─── Conversations ────────────────────────────────────────────────────────────

export async function createDirectHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const body = CreateDirectBodySchema.parse(request.body);
  const conversation = await chatService.createDirectConversation(
    request.server.prisma,
    request.userId,
    body.user_id,
  );
  reply.code(201).send(conversation);
}

export async function createGroupHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const body = CreateGroupBodySchema.parse(request.body);
  const conversation = await chatService.createGroupConversation(
    request.server.prisma,
    request.workspace.id,
    request.userId,
    body,
  );
  reply.code(201).send(conversation);
}

export async function addConversationMemberHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const { id } = request.params as { id: string };
  const body = AddConversationMemberBodySchema.parse(request.body);
  await chatService.addConversationMember(request.server.prisma, request.userId, id, body.user_id);
  reply.code(204).send();
}

export async function listConversationsHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const conversations = await chatService.listConversations(request.server.prisma, request.userId);
  reply.send(conversations);
}

export async function getConversationHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const { id } = request.params as { id: string };
  const conversation = await chatService.getConversation(request.server.prisma, request.userId, id);
  reply.send(conversation);
}

export async function renameConversationHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const { id } = request.params as { id: string };
  const { name } = RenameConversationBodySchema.parse(request.body);
  const { conversation, memberIds } = await chatService.renameConversation(
    request.server.prisma,
    request.userId,
    id,
    name,
  );

  chatHub.broadcast(memberIds, {
    type: 'conversation_updated',
    data: { id: conversation.id, name: conversation.name },
  });
  reply.send(conversation);
}

export async function deleteConversationHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const { id } = request.params as { id: string };
  const result = await chatService.deleteConversation(request.server.prisma, request.userId, id);

  if (result.action === 'deleted') {
    // Everyone loses the conversation.
    chatHub.broadcast(result.memberIds, {
      type: 'conversation_deleted',
      data: { id: result.conversation_id },
    });
  } else {
    // The leaver's view removes it; remaining members see a membership change.
    chatHub.broadcast([request.userId], {
      type: 'conversation_deleted',
      data: { id: result.conversation_id },
    });
    chatHub.broadcast(
      result.memberIds.filter((uid) => uid !== request.userId),
      { type: 'conversation_updated', data: { id: result.conversation_id, left_user_id: request.userId } },
    );
  }
  reply.code(204).send();
}

export async function listMessagesHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const { id } = request.params as { id: string };
  const { cursor, limit } = ListMessagesQuerySchema.parse(request.query);
  const result = await chatService.listMessages(
    request.server.prisma,
    request.userId,
    id,
    cursor,
    limit,
  );
  reply.send(result);
}

export async function sendMessageHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const { id } = request.params as { id: string };
  const body = SendMessageBodySchema.parse(request.body);
  const { message, memberIds } = await chatService.createMessage(
    request.server.prisma,
    request.userId,
    id,
    body,
  );

  // Real-time fan-out to every connected member (including the sender's other
  // devices). REST and WebSocket message creation share this same push.
  chatHub.broadcast(memberIds, { type: 'message', data: message });

  reply.code(201).send(message);
}

export async function editMessageHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const { id, messageId } = request.params as { id: string; messageId: string };
  const body = EditMessageBodySchema.parse(request.body);
  const { message, memberIds } = await chatService.editMessage(
    request.server.prisma,
    request.userId,
    id,
    messageId,
    body.body,
  );

  chatHub.broadcast(memberIds, { type: 'message_updated', data: message });
  reply.send(message);
}

export async function deleteMessageHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const { id, messageId } = request.params as { id: string; messageId: string };
  const result = await chatService.deleteMessage(
    request.server.prisma,
    request.server.storage,
    request.userId,
    id,
    messageId,
  );

  chatHub.broadcast(result.memberIds, {
    type: 'message_deleted',
    data: { id: result.id, conversation_id: result.conversation_id },
  });
  reply.code(204).send();
}

export async function listReactionEmojisHandler(
  _request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  reply.send({ emojis: [...REACTION_EMOJIS] });
}

export async function reactionHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const { id, messageId } = request.params as { id: string; messageId: string };
  const { emoji } = ReactionBodySchema.parse(request.body);
  const result = await chatService.toggleReaction(
    request.server.prisma,
    request.userId,
    id,
    messageId,
    emoji,
  );

  const payload = {
    message_id: result.message_id,
    conversation_id: result.conversation_id,
    emoji: result.emoji,
    user_id: result.user_id,
  };
  chatHub.broadcast(result.memberIds, {
    type: result.action === 'added' ? 'reaction_added' : 'reaction_removed',
    data: payload,
  });
  reply.send({ action: result.action, ...payload });
}

export async function chatAttachmentHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const { id } = request.params as { id: string };
  const body = ChatAttachmentBodySchema.parse(request.body);
  const result = await chatService.presignChatUpload(
    request.server.prisma,
    request.server.storage,
    request.userId,
    id,
    body,
  );
  reply.code(201).send(result);
}
