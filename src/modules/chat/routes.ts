import type { FastifyInstance } from 'fastify';
import type { WebSocket } from '@fastify/websocket';
import { authenticate } from '../../plugins/auth-hook.js';
import { requireWorkspaceMember } from '../../plugins/workspace-hook.js';
import { verifyAccessToken } from '../../lib/jwt.js';
import { chatHub } from './realtime.js';
import * as chatService from './service.js';
import { WsSendFrameSchema, WsCallFrameSchema } from './schema.js';
import {
  sendContactRequestSchema,
  listContactRequestsSchema,
  respondContactRequestSchema,
  listContactsSchema,
  searchUsersSchema,
  createDirectSchema,
  createGroupSchema,
  addConversationMemberSchema,
  listConversationsSchema,
  getConversationSchema,
  renameConversationSchema,
  deleteConversationSchema,
  listMessagesSchema,
  sendMessageSchema,
  editMessageSchema,
  deleteMessageSchema,
  reactionSchema,
  listReactionEmojisSchema,
  chatAttachmentSchema,
} from './schema.js';
import {
  sendContactRequestHandler,
  listContactRequestsHandler,
  acceptContactRequestHandler,
  declineContactRequestHandler,
  listContactsHandler,
  searchUsersHandler,
  createDirectHandler,
  createGroupHandler,
  addConversationMemberHandler,
  listConversationsHandler,
  getConversationHandler,
  renameConversationHandler,
  deleteConversationHandler,
  listMessagesHandler,
  sendMessageHandler,
  editMessageHandler,
  deleteMessageHandler,
  reactionHandler,
  listReactionEmojisHandler,
  chatAttachmentHandler,
} from './controller.js';

/** Contacts — `/api/v1/contacts`. Auth only (not workspace-scoped). */
export async function contactRoutes(app: FastifyInstance): Promise<void> {
  const auth = [authenticate];

  app.post(
    '/requests',
    { schema: sendContactRequestSchema, preHandler: auth },
    sendContactRequestHandler,
  );
  app.get(
    '/requests',
    { schema: listContactRequestsSchema, preHandler: auth },
    listContactRequestsHandler,
  );
  app.post(
    '/requests/:id/accept',
    { schema: respondContactRequestSchema, preHandler: auth },
    acceptContactRequestHandler,
  );
  app.post(
    '/requests/:id/decline',
    { schema: respondContactRequestSchema, preHandler: auth },
    declineContactRequestHandler,
  );
  app.get('/', { schema: listContactsSchema, preHandler: auth }, listContactsHandler);
  app.get('/search', { schema: searchUsersSchema, preHandler: auth }, searchUsersHandler);
}

/** Conversations — `/api/v1/conversations`. Auth only. */
export async function conversationRoutes(app: FastifyInstance): Promise<void> {
  const auth = [authenticate];

  app.post('/direct', { schema: createDirectSchema, preHandler: auth }, createDirectHandler);
  app.get('/', { schema: listConversationsSchema, preHandler: auth }, listConversationsHandler);
  app.get('/:id', { schema: getConversationSchema, preHandler: auth }, getConversationHandler);
  app.patch('/:id', { schema: renameConversationSchema, preHandler: auth }, renameConversationHandler);
  app.delete('/:id', { schema: deleteConversationSchema, preHandler: auth }, deleteConversationHandler);
  app.post(
    '/:id/members',
    { schema: addConversationMemberSchema, preHandler: auth },
    addConversationMemberHandler,
  );
  app.get('/:id/messages', { schema: listMessagesSchema, preHandler: auth }, listMessagesHandler);
  app.post('/:id/messages', { schema: sendMessageSchema, preHandler: auth }, sendMessageHandler);
  app.patch(
    '/:id/messages/:messageId',
    { schema: editMessageSchema, preHandler: auth },
    editMessageHandler,
  );
  app.delete(
    '/:id/messages/:messageId',
    { schema: deleteMessageSchema, preHandler: auth },
    deleteMessageHandler,
  );
  app.get(
    '/reactions/emojis',
    { schema: listReactionEmojisSchema, preHandler: auth },
    listReactionEmojisHandler,
  );
  app.post(
    '/:id/messages/:messageId/reactions',
    { schema: reactionSchema, preHandler: auth },
    reactionHandler,
  );
  app.post('/:id/attachments', { schema: chatAttachmentSchema, preHandler: auth }, chatAttachmentHandler);
}

/** Group creation — `/api/v1/workspaces/:workspaceSlug/conversations`. Workspace-scoped. */
export async function workspaceConversationRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/',
    { schema: createGroupSchema, preHandler: [authenticate, requireWorkspaceMember()] },
    createGroupHandler,
  );
}

/**
 * Real-time chat socket — `/api/v1/ws/chat?token=<access_token>`.
 *
 * The access token travels in the query string because browsers cannot set
 * custom headers on a WebSocket handshake. On connect we register the socket in
 * the hub keyed by userId; every message created (here or via REST) is pushed to
 * all connected members. Clients may also post via `{ type: "send", ... }`.
 */
export async function chatWsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/chat', { websocket: true }, (socket, req) => {
    const token = (req.query as { token?: string }).token;
    let userId: string;
    try {
      if (!token) throw new Error('missing token');
      userId = verifyAccessToken(token).sub;
    } catch {
      socket.send(JSON.stringify({ type: 'error', data: { message: 'unauthorized' } }));
      socket.close(1008, 'unauthorized');
      return;
    }

    chatHub.register(userId, socket);

    socket.on('message', (raw: Buffer) => {
      void handleInboundFrame(app, userId, socket, raw.toString());
    });

    socket.on('close', () => {
      chatHub.unregister(userId, socket);
    });
  });
}

/**
 * Handle an inbound WebSocket frame. Two frame types are supported:
 *   - `{ type: "send", conversation_id, body }` — post a text message.
 *   - `{ type: "call", action, conversation_id, payload }` — WebRTC call
 *     signaling, relayed verbatim to the other conversation member(s).
 */
async function handleInboundFrame(
  app: FastifyInstance,
  userId: string,
  socket: WebSocket,
  raw: string,
): Promise<void> {
  try {
    const json = JSON.parse(raw) as { type?: unknown };

    if (json.type === 'call') {
      const frame = WsCallFrameSchema.parse(json);
      const members = await chatService.conversationMemberIds(
        app.prisma,
        userId,
        frame.conversation_id,
      );
      // Relay to the other member(s) — never echo back to the caller.
      const recipients = members.filter((id) => id !== userId);
      chatHub.broadcast(recipients, {
        type: 'call',
        data: {
          action: frame.action,
          conversation_id: frame.conversation_id,
          from: userId,
          payload: frame.payload ?? null,
        },
      });
      return;
    }

    const parsed = WsSendFrameSchema.parse(json);
    const { message, memberIds } = await chatService.createMessage(
      app.prisma,
      userId,
      parsed.conversation_id,
      { kind: 'text', body: parsed.body },
    );
    chatHub.broadcast(memberIds, { type: 'message', data: message });
  } catch (err) {
    const messageText =
      err instanceof Error ? err.message : 'Invalid frame (expected { type: "send" | "call", ... })';
    if (socket.readyState === 1) {
      socket.send(JSON.stringify({ type: 'error', data: { message: messageText } }));
    }
  }
}
