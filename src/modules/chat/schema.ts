import { z } from 'zod';
import type { FastifySchema } from 'fastify';

// ─── Zod validators ───────────────────────────────────────────────────────────

export const SendContactRequestBodySchema = z.object({
  user_id: z.string().uuid(),
});

export const ContactRequestsQuerySchema = z.object({
  direction: z.enum(['incoming', 'outgoing']).default('incoming'),
});

export const CreateDirectBodySchema = z.object({
  user_id: z.string().uuid(),
});

export const CreateGroupBodySchema = z.object({
  name: z.string().min(1).max(100),
  member_ids: z.array(z.string().uuid()).min(1).max(200),
});

export const AddConversationMemberBodySchema = z.object({
  user_id: z.string().uuid(),
});

/** Rename a group conversation (edit chat). */
export const RenameConversationBodySchema = z.object({
  name: z.string().min(1).max(100),
});

export const ListMessagesQuerySchema = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

export const MESSAGE_KINDS = ['text', 'image', 'video', 'audio', 'voice', 'file'] as const;

/**
 * Send a message. Either a plain text message (`kind: text` with a non-empty
 * `body`) or an attachment message (`kind` != text with `attachment_key` from a
 * prior presign call). `body` is an optional caption for attachments.
 */
export const SendMessageBodySchema = z
  .object({
    body: z.string().max(10_000).optional(),
    kind: z.enum(MESSAGE_KINDS).default('text'),
    attachment_key: z.string().min(1).max(500).optional(),
    attachment_name: z.string().min(1).max(255).optional(),
    attachment_size: z.number().int().positive().optional(),
    attachment_mime: z.string().min(1).max(255).optional(),
    attachment_duration: z.number().int().positive().max(86_400).optional(),
  })
  .refine((d) => (d.kind === 'text' ? !!d.body && d.body.trim().length > 0 : !!d.attachment_key), {
    message: 'text messages require a non-empty body; attachment messages require attachment_key',
  });

/** Edit the text/caption of an existing message. */
export const EditMessageBodySchema = z.object({
  body: z.string().min(1).max(10_000),
});

/** Quick-reaction emoji set the client renders in the tap-to-react bar. */
export const REACTION_EMOJIS = ['👍', '❤️', '😂', '😍', '💩'] as const;

/** Toggle an emoji reaction on a message (tap to add, tap again to remove). */
export const ReactionBodySchema = z.object({
  emoji: z.enum(REACTION_EMOJIS),
});

/** Request a presigned upload for a chat attachment (client uploads bytes, then sends the message). */
export const ChatAttachmentBodySchema = z.object({
  file_name: z.string().min(1).max(255),
  file_size: z.number().int().positive(),
  mime_type: z.string().min(1).max(255),
});

/** Inbound WebSocket frame the client can send to post a message over the socket. */
export const WsSendFrameSchema = z.object({
  type: z.literal('send'),
  conversation_id: z.string().uuid(),
  body: z.string().min(1).max(10_000),
});

/**
 * Inbound WebSocket frame carrying WebRTC call signaling. The server relays it to
 * the other conversation member(s) as a `call` event. Payload is opaque (SDP
 * offer/answer or an ICE candidate); the server never inspects it.
 */
export const WsCallFrameSchema = z.object({
  type: z.literal('call'),
  action: z.enum(['offer', 'answer', 'ice', 'hangup', 'reject']),
  conversation_id: z.string().uuid(),
  payload: z.unknown().optional(),
});

export type SendContactRequestBody = z.infer<typeof SendContactRequestBodySchema>;
export type ContactRequestsQuery = z.infer<typeof ContactRequestsQuerySchema>;
export type CreateDirectBody = z.infer<typeof CreateDirectBodySchema>;
export type CreateGroupBody = z.infer<typeof CreateGroupBodySchema>;
export type AddConversationMemberBody = z.infer<typeof AddConversationMemberBodySchema>;
export type RenameConversationBody = z.infer<typeof RenameConversationBodySchema>;
export type ListMessagesQuery = z.infer<typeof ListMessagesQuerySchema>;
export type SendMessageBody = z.infer<typeof SendMessageBodySchema>;
export type EditMessageBody = z.infer<typeof EditMessageBodySchema>;
export type ChatAttachmentBody = z.infer<typeof ChatAttachmentBodySchema>;
export type ReactionBody = z.infer<typeof ReactionBodySchema>;

// ─── Fastify route schemas ────────────────────────────────────────────────────
//
// Bodies/params/querystrings are validated here (and again by Zod in the
// controller for typed access). Response schemas are intentionally omitted for
// list/detail endpoints so Fastify's serializer doesn't strip the nested
// user/last-message objects.

const security = [{ bearerAuth: [] }];

export const sendContactRequestSchema: FastifySchema = {
  tags: ['Chat'],
  summary: 'Send a contact (friend) request',
  security,
  body: {
    type: 'object',
    required: ['user_id'],
    properties: { user_id: { type: 'string', format: 'uuid' } },
  },
};

export const listContactRequestsSchema: FastifySchema = {
  tags: ['Chat'],
  summary: 'List pending contact requests (incoming or outgoing)',
  security,
  querystring: {
    type: 'object',
    properties: { direction: { type: 'string', enum: ['incoming', 'outgoing'] } },
  },
};

export const respondContactRequestSchema: FastifySchema = {
  tags: ['Chat'],
  summary: 'Accept or decline a contact request',
  security,
  params: { type: 'object', properties: { id: { type: 'string' } } },
};

export const listContactsSchema: FastifySchema = {
  tags: ['Chat'],
  summary: 'List accepted contacts',
  security,
};

export const createDirectSchema: FastifySchema = {
  tags: ['Chat'],
  summary: 'Open (or find) a 1:1 conversation with a contact',
  security,
  body: {
    type: 'object',
    required: ['user_id'],
    properties: { user_id: { type: 'string', format: 'uuid' } },
  },
};

export const createGroupSchema: FastifySchema = {
  tags: ['Chat'],
  summary: 'Create a workspace group conversation',
  security,
  params: { type: 'object', properties: { workspaceSlug: { type: 'string' } } },
  body: {
    type: 'object',
    required: ['name', 'member_ids'],
    properties: {
      name: { type: 'string', minLength: 1, maxLength: 100 },
      member_ids: { type: 'array', items: { type: 'string', format: 'uuid' }, minItems: 1 },
    },
  },
};

export const addConversationMemberSchema: FastifySchema = {
  tags: ['Chat'],
  summary: 'Add a member to a group conversation',
  security,
  params: { type: 'object', properties: { id: { type: 'string' } } },
  body: {
    type: 'object',
    required: ['user_id'],
    properties: { user_id: { type: 'string', format: 'uuid' } },
  },
};

export const listConversationsSchema: FastifySchema = {
  tags: ['Chat'],
  summary: 'List the authenticated user conversations (with last message)',
  security,
};

export const getConversationSchema: FastifySchema = {
  tags: ['Chat'],
  summary: 'Get a conversation with its members',
  security,
  params: { type: 'object', properties: { id: { type: 'string' } } },
};

export const renameConversationSchema: FastifySchema = {
  tags: ['Chat'],
  summary: 'Rename a group conversation (edit chat)',
  security,
  params: { type: 'object', properties: { id: { type: 'string' } } },
  body: {
    type: 'object',
    required: ['name'],
    properties: { name: { type: 'string', minLength: 1, maxLength: 100 } },
  },
};

export const deleteConversationSchema: FastifySchema = {
  tags: ['Chat'],
  summary: 'Delete a conversation (direct or group you created), or leave a group',
  security,
  params: { type: 'object', properties: { id: { type: 'string' } } },
};

export const listMessagesSchema: FastifySchema = {
  tags: ['Chat'],
  summary: 'List messages in a conversation (cursor pagination, newest first)',
  security,
  params: { type: 'object', properties: { id: { type: 'string' } } },
  querystring: {
    type: 'object',
    properties: {
      cursor: { type: 'string', format: 'uuid' },
      limit: { type: 'integer', minimum: 1, maximum: 100 },
    },
  },
};

export const sendMessageSchema: FastifySchema = {
  tags: ['Chat'],
  summary: 'Post a message (text, or an attachment via attachment_key from /attachments)',
  security,
  params: { type: 'object', properties: { id: { type: 'string' } } },
  body: {
    type: 'object',
    properties: {
      body: { type: 'string', maxLength: 10000 },
      kind: { type: 'string', enum: [...MESSAGE_KINDS] },
      attachment_key: { type: 'string' },
      attachment_name: { type: 'string' },
      attachment_size: { type: 'integer' },
      attachment_mime: { type: 'string' },
      attachment_duration: { type: 'integer' },
    },
  },
};

export const editMessageSchema: FastifySchema = {
  tags: ['Chat'],
  summary: 'Edit a message you sent (text/caption)',
  security,
  params: {
    type: 'object',
    properties: { id: { type: 'string' }, messageId: { type: 'string' } },
  },
  body: {
    type: 'object',
    required: ['body'],
    properties: { body: { type: 'string', minLength: 1, maxLength: 10000 } },
  },
};

export const deleteMessageSchema: FastifySchema = {
  tags: ['Chat'],
  summary: 'Delete a message you sent',
  security,
  params: {
    type: 'object',
    properties: { id: { type: 'string' }, messageId: { type: 'string' } },
  },
};

export const reactionSchema: FastifySchema = {
  tags: ['Chat'],
  summary: 'Toggle an emoji reaction on a message (tap to add / remove)',
  security,
  params: {
    type: 'object',
    properties: { id: { type: 'string' }, messageId: { type: 'string' } },
  },
  body: {
    type: 'object',
    required: ['emoji'],
    properties: { emoji: { type: 'string', enum: [...REACTION_EMOJIS] } },
  },
};

export const listReactionEmojisSchema: FastifySchema = {
  tags: ['Chat'],
  summary: 'List the available quick-reaction emojis',
  security,
  response: {
    200: {
      type: 'object',
      properties: { emojis: { type: 'array', items: { type: 'string' } } },
    },
  },
};

export const chatAttachmentSchema: FastifySchema = {
  tags: ['Chat'],
  summary: 'Get a presigned upload URL for a chat attachment (image/video/voice/file)',
  security,
  params: { type: 'object', properties: { id: { type: 'string' } } },
  body: {
    type: 'object',
    required: ['file_name', 'file_size', 'mime_type'],
    properties: {
      file_name: { type: 'string', minLength: 1, maxLength: 255 },
      file_size: { type: 'integer', minimum: 1 },
      mime_type: { type: 'string', minLength: 1, maxLength: 255 },
    },
  },
};
