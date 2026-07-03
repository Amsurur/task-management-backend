import type { PrismaClient, Contact, Conversation, Message, MessageKind } from '@prisma/client';
import { AppError } from '../../lib/errors.js';
import { config } from '../../config/index.js';
import { buildChatStorageKey, type PresignedUpload, type StorageDriver } from '../../lib/storage.js';
import type { CreateGroupBody } from './schema.js';

// Public projection of a user — never leaks password_hash etc.
const publicUser = { id: true, email: true, display_name: true, avatar_url: true } as const;

export interface MessageWithSender extends Message {
  sender: { id: string; email: string; display_name: string; avatar_url: string | null };
}

/** A created message plus the recipients that should receive a real-time push. */
export interface CreatedMessage {
  message: MessageWithSender;
  memberIds: string[];
}

/** Payload for creating a message — a text body, an attachment, or both. */
export interface SendMessageInput {
  kind?: MessageKind;
  body?: string;
  attachment_key?: string | null;
  attachment_name?: string | null;
  attachment_size?: number | null;
  attachment_mime?: string | null;
  attachment_duration?: number | null;
}

// ─── Contacts ───────────────────────────────────────────────────────────────

export async function sendContactRequest(
  prisma: PrismaClient,
  requesterId: string,
  addresseeId: string,
): Promise<Contact> {
  if (requesterId === addresseeId) {
    throw AppError.badRequest('You cannot send a contact request to yourself');
  }

  const addressee = await prisma.user.findUnique({ where: { id: addresseeId } });
  if (!addressee) throw AppError.notFound('User not found');

  // If the other side already requested us, accept that instead of creating a
  // mirror request (spec: auto-accept when the reverse request exists).
  const reverse = await prisma.contact.findUnique({
    where: { requester_id_addressee_id: { requester_id: addresseeId, addressee_id: requesterId } },
  });
  if (reverse) {
    if (reverse.status === 'accepted') throw AppError.conflict('You are already contacts');
    if (reverse.status === 'pending') {
      return prisma.contact.update({
        where: { id: reverse.id },
        data: { status: 'accepted', responded_at: new Date() },
      });
    }
    // reverse was declined → fall through and let this side make its own request.
  }

  const forward = await prisma.contact.findUnique({
    where: { requester_id_addressee_id: { requester_id: requesterId, addressee_id: addresseeId } },
  });
  if (forward) {
    if (forward.status === 'pending') throw AppError.conflict('Contact request already sent');
    if (forward.status === 'accepted') throw AppError.conflict('You are already contacts');
    // Previously declined → re-open it as a fresh pending request.
    return prisma.contact.update({
      where: { id: forward.id },
      data: { status: 'pending', responded_at: null },
    });
  }

  return prisma.contact.create({
    data: { requester_id: requesterId, addressee_id: addresseeId, status: 'pending' },
  });
}

export async function listContactRequests(
  prisma: PrismaClient,
  userId: string,
  direction: 'incoming' | 'outgoing',
): Promise<Contact[]> {
  if (direction === 'incoming') {
    return prisma.contact.findMany({
      where: { addressee_id: userId, status: 'pending' },
      include: { requester: { select: publicUser } },
      orderBy: { created_at: 'desc' },
    });
  }
  return prisma.contact.findMany({
    where: { requester_id: userId, status: 'pending' },
    include: { addressee: { select: publicUser } },
    orderBy: { created_at: 'desc' },
  });
}

export async function respondToContactRequest(
  prisma: PrismaClient,
  userId: string,
  contactId: string,
  accept: boolean,
): Promise<Contact> {
  const contact = await prisma.contact.findUnique({ where: { id: contactId } });
  // Only the addressee of a still-pending request may respond.
  if (!contact || contact.addressee_id !== userId || contact.status !== 'pending') {
    throw AppError.notFound('Contact request not found');
  }
  return prisma.contact.update({
    where: { id: contactId },
    data: { status: accept ? 'accepted' : 'declined', responded_at: new Date() },
  });
}

export async function listContacts(prisma: PrismaClient, userId: string): Promise<unknown[]> {
  const contacts = await prisma.contact.findMany({
    where: {
      status: 'accepted',
      OR: [{ requester_id: userId }, { addressee_id: userId }],
    },
    include: { requester: { select: publicUser }, addressee: { select: publicUser } },
    orderBy: { responded_at: 'desc' },
  });

  // Surface the "other" party as `contact`, regardless of who initiated.
  return contacts.map((c) => ({
    id: c.id,
    since: c.responded_at,
    contact: c.requester_id === userId ? c.addressee : c.requester,
  }));
}

/**
 * Search registered users by display name OR email (case-insensitive, partial
 * match) so the client can find someone to add as a contact / start a chat with.
 * Excludes the caller and deactivated accounts, and annotates each result with
 * the current relationship so the UI can show "Add" / "Pending" / "Message".
 */
export async function searchUsers(
  prisma: PrismaClient,
  userId: string,
  query: string,
  limit = 20,
): Promise<unknown[]> {
  const q = query.trim();
  if (!q) return [];

  const users = await prisma.user.findMany({
    where: {
      id: { not: userId },
      is_active: true,
      OR: [
        { display_name: { contains: q, mode: 'insensitive' } },
        { email: { contains: q, mode: 'insensitive' } },
      ],
    },
    select: publicUser,
    take: limit,
    orderBy: { display_name: 'asc' },
  });
  if (users.length === 0) return [];

  const ids = users.map((u) => u.id);
  const contacts = await prisma.contact.findMany({
    where: {
      OR: [
        { requester_id: userId, addressee_id: { in: ids } },
        { addressee_id: userId, requester_id: { in: ids } },
      ],
    },
  });

  const relationshipFor = (otherId: string): string => {
    const c = contacts.find(
      (row) =>
        (row.requester_id === userId && row.addressee_id === otherId) ||
        (row.addressee_id === userId && row.requester_id === otherId),
    );
    if (!c || c.status === 'declined') return 'none';
    if (c.status === 'accepted') return 'contact';
    return c.requester_id === userId ? 'pending_outgoing' : 'pending_incoming';
  };

  return users.map((u) => ({ ...u, relationship: relationshipFor(u.id) }));
}

/** Throw 403 unless the two users are accepted contacts. */
async function assertAcceptedContact(prisma: PrismaClient, a: string, b: string): Promise<void> {
  const contact = await prisma.contact.findFirst({
    where: {
      status: 'accepted',
      OR: [
        { requester_id: a, addressee_id: b },
        { requester_id: b, addressee_id: a },
      ],
    },
  });
  if (!contact) {
    throw AppError.forbidden('You can only start a direct chat with an accepted contact');
  }
}

// ─── Conversations ────────────────────────────────────────────────────────────

/** Assert the user is a member of the conversation; returns the conversation. */
async function assertConversationMember(
  prisma: PrismaClient,
  userId: string,
  conversationId: string,
): Promise<Conversation> {
  const conversation = await prisma.conversation.findUnique({ where: { id: conversationId } });
  if (!conversation) throw AppError.notFound('Conversation not found');

  const membership = await prisma.conversationMember.findUnique({
    where: { conversation_id_user_id: { conversation_id: conversationId, user_id: userId } },
  });
  if (!membership) throw AppError.forbidden('You are not a member of this conversation');

  return conversation;
}

export async function createDirectConversation(
  prisma: PrismaClient,
  userId: string,
  otherUserId: string,
): Promise<Conversation> {
  if (userId === otherUserId) {
    throw AppError.badRequest('You cannot open a conversation with yourself');
  }
  await assertAcceptedContact(prisma, userId, otherUserId);

  // Find an existing direct conversation containing exactly these two users.
  const existing = await prisma.conversation.findFirst({
    where: {
      type: 'direct',
      AND: [
        { members: { some: { user_id: userId } } },
        { members: { some: { user_id: otherUserId } } },
      ],
    },
    include: { members: { include: { user: { select: publicUser } } } },
  });
  if (existing) return existing;

  return prisma.conversation.create({
    data: {
      type: 'direct',
      created_by_id: userId,
      members: {
        create: [{ user_id: userId }, { user_id: otherUserId }],
      },
    },
    include: { members: { include: { user: { select: publicUser } } } },
  });
}

export async function createGroupConversation(
  prisma: PrismaClient,
  workspaceId: string,
  creatorId: string,
  body: CreateGroupBody,
): Promise<Conversation> {
  // Every listed member (and the creator) must belong to the workspace.
  const memberIds = Array.from(new Set([creatorId, ...body.member_ids]));

  const workspaceMembers = await prisma.workspaceMember.findMany({
    where: { workspace_id: workspaceId, user_id: { in: memberIds } },
    select: { user_id: true },
  });
  if (workspaceMembers.length !== memberIds.length) {
    throw AppError.badRequest('All members must belong to this workspace');
  }

  return prisma.conversation.create({
    data: {
      type: 'group',
      workspace_id: workspaceId,
      name: body.name,
      created_by_id: creatorId,
      members: { create: memberIds.map((user_id) => ({ user_id })) },
    },
    include: { members: { include: { user: { select: publicUser } } } },
  });
}

export async function addConversationMember(
  prisma: PrismaClient,
  userId: string,
  conversationId: string,
  newUserId: string,
): Promise<void> {
  const conversation = await assertConversationMember(prisma, userId, conversationId);
  if (conversation.type !== 'group') {
    throw AppError.badRequest('Members can only be added to group conversations');
  }

  // The new member must belong to the conversation's workspace.
  if (conversation.workspace_id) {
    const membership = await prisma.workspaceMember.findUnique({
      where: {
        workspace_id_user_id: { workspace_id: conversation.workspace_id, user_id: newUserId },
      },
    });
    if (!membership) throw AppError.badRequest('New member must belong to this workspace');
  }

  const existing = await prisma.conversationMember.findUnique({
    where: { conversation_id_user_id: { conversation_id: conversationId, user_id: newUserId } },
  });
  if (existing) throw AppError.conflict('User is already in this conversation');

  await prisma.conversationMember.create({
    data: { conversation_id: conversationId, user_id: newUserId },
  });
}

export async function listConversations(prisma: PrismaClient, userId: string): Promise<unknown[]> {
  const conversations = await prisma.conversation.findMany({
    where: { members: { some: { user_id: userId } } },
    include: {
      members: { include: { user: { select: publicUser } } },
      messages: {
        orderBy: { created_at: 'desc' },
        take: 1,
        include: { sender: { select: publicUser } },
      },
    },
    orderBy: { updated_at: 'desc' },
  });

  return conversations.map((c) => ({
    id: c.id,
    type: c.type,
    name: c.name,
    workspace_id: c.workspace_id,
    created_at: c.created_at,
    updated_at: c.updated_at,
    members: c.members.map((m) => m.user),
    last_message: c.messages[0] ?? null,
  }));
}

export async function getConversation(
  prisma: PrismaClient,
  userId: string,
  conversationId: string,
): Promise<unknown> {
  await assertConversationMember(prisma, userId, conversationId);
  const conversation = await prisma.conversation.findUniqueOrThrow({
    where: { id: conversationId },
    include: { members: { include: { user: { select: publicUser } } } },
  });
  return {
    id: conversation.id,
    type: conversation.type,
    name: conversation.name,
    workspace_id: conversation.workspace_id,
    created_by_id: conversation.created_by_id,
    created_at: conversation.created_at,
    updated_at: conversation.updated_at,
    members: conversation.members.map((m) => ({ ...m.user, joined_at: m.joined_at })),
  };
}

/**
 * Rename a group conversation (edit chat). Direct chats have no name and cannot
 * be renamed. Returns the updated conversation and members to notify
 * (event: `conversation_updated`).
 */
export async function renameConversation(
  prisma: PrismaClient,
  userId: string,
  conversationId: string,
  name: string,
): Promise<{ conversation: Conversation; memberIds: string[] }> {
  const conversation = await assertConversationMember(prisma, userId, conversationId);
  if (conversation.type !== 'group') {
    throw AppError.badRequest('Only group conversations can be renamed');
  }
  const updated = await prisma.conversation.update({
    where: { id: conversationId },
    data: { name, updated_at: new Date() },
  });
  return { conversation: updated, memberIds: await memberIds(prisma, conversationId) };
}

/** Outcome of deleting/leaving a conversation, for the real-time event. */
export interface DeleteConversationResult {
  action: 'deleted' | 'left';
  conversation_id: string;
  /** Every member at the time of the call (before deletion/leave). */
  memberIds: string[];
}

/**
 * Delete a conversation or leave it:
 *  - direct chat, or a group you created → the whole conversation is deleted
 *    (cascades to members, messages and reactions);
 *  - a group you did not create → you simply leave (your membership is removed).
 */
export async function deleteConversation(
  prisma: PrismaClient,
  userId: string,
  conversationId: string,
): Promise<DeleteConversationResult> {
  const conversation = await assertConversationMember(prisma, userId, conversationId);
  const members = await memberIds(prisma, conversationId);

  if (conversation.type === 'group' && conversation.created_by_id !== userId) {
    await prisma.conversationMember.delete({
      where: { conversation_id_user_id: { conversation_id: conversationId, user_id: userId } },
    });
    return { action: 'left', conversation_id: conversationId, memberIds: members };
  }

  await prisma.conversation.delete({ where: { id: conversationId } });
  return { action: 'deleted', conversation_id: conversationId, memberIds: members };
}

export async function listMessages(
  prisma: PrismaClient,
  userId: string,
  conversationId: string,
  cursor: string | undefined,
  limit: number,
): Promise<{ data: MessageWithSender[]; next_cursor: string | null }> {
  await assertConversationMember(prisma, userId, conversationId);

  const messages = await prisma.message.findMany({
    where: { conversation_id: conversationId },
    include: {
      sender: { select: publicUser },
      reactions: { select: { emoji: true, user_id: true } },
    },
    // Newest → oldest. Tiebreak on id so the cursor is deterministic.
    orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    ...(cursor && { cursor: { id: cursor }, skip: 1 }),
  });

  const hasMore = messages.length > limit;
  const data = hasMore ? messages.slice(0, limit) : messages;
  const next_cursor = hasMore ? (data[data.length - 1]?.id ?? null) : null;

  return { data, next_cursor };
}

/**
 * Create a message. Enforces conversation membership, bumps the conversation's
 * `updated_at` (so it sorts to the top of the list), and returns the message
 * along with the member ids to notify in real time. The caller is responsible
 * for the actual fan-out (via the chat hub) so this stays pure/data-only.
 */
export async function createMessage(
  prisma: PrismaClient,
  senderId: string,
  conversationId: string,
  input: SendMessageInput,
): Promise<CreatedMessage> {
  await assertConversationMember(prisma, senderId, conversationId);

  const [message] = await prisma.$transaction([
    prisma.message.create({
      data: {
        conversation_id: conversationId,
        sender_id: senderId,
        kind: input.kind ?? 'text',
        body: input.body ?? '',
        attachment_key: input.attachment_key ?? null,
        attachment_name: input.attachment_name ?? null,
        attachment_size: input.attachment_size ?? null,
        attachment_mime: input.attachment_mime ?? null,
        attachment_duration: input.attachment_duration ?? null,
      },
      include: { sender: { select: publicUser } },
    }),
    prisma.conversation.update({
      where: { id: conversationId },
      data: { updated_at: new Date() },
    }),
  ]);

  return { message, memberIds: await memberIds(prisma, conversationId) };
}

/** The user ids of every member of a conversation (for real-time fan-out). */
async function memberIds(prisma: PrismaClient, conversationId: string): Promise<string[]> {
  const members = await prisma.conversationMember.findMany({
    where: { conversation_id: conversationId },
    select: { user_id: true },
  });
  return members.map((m) => m.user_id);
}

/** Fetch a message and assert it belongs to the conversation and the sender. */
async function assertOwnMessage(
  prisma: PrismaClient,
  senderId: string,
  conversationId: string,
  messageId: string,
): Promise<Message> {
  const message = await prisma.message.findFirst({
    where: { id: messageId, conversation_id: conversationId },
  });
  if (!message || message.deleted_at) throw AppError.notFound('Message not found');
  if (message.sender_id !== senderId) {
    throw AppError.forbidden('You can only modify your own messages');
  }
  return message;
}

/**
 * Edit the text/caption of a message the caller sent. Sets `edited_at`. Returns
 * the updated message and the members to notify (event: `message_updated`).
 */
export async function editMessage(
  prisma: PrismaClient,
  senderId: string,
  conversationId: string,
  messageId: string,
  body: string,
): Promise<CreatedMessage> {
  await assertConversationMember(prisma, senderId, conversationId);
  await assertOwnMessage(prisma, senderId, conversationId, messageId);

  const message = await prisma.message.update({
    where: { id: messageId },
    data: { body, edited_at: new Date() },
    include: { sender: { select: publicUser } },
  });

  return { message, memberIds: await memberIds(prisma, conversationId) };
}

/** A deleted message reference, for the `message_deleted` real-time event. */
export interface DeletedMessage {
  id: string;
  conversation_id: string;
  memberIds: string[];
}

/**
 * Soft-delete a message the caller sent: clears its body/attachment metadata,
 * stamps `deleted_at`, and removes the stored object (if any). Returns the id +
 * members to notify (event: `message_deleted`).
 */
export async function deleteMessage(
  prisma: PrismaClient,
  storage: StorageDriver,
  senderId: string,
  conversationId: string,
  messageId: string,
): Promise<DeletedMessage> {
  await assertConversationMember(prisma, senderId, conversationId);
  const message = await assertOwnMessage(prisma, senderId, conversationId, messageId);

  await prisma.message.update({
    where: { id: messageId },
    data: {
      deleted_at: new Date(),
      body: '',
      attachment_key: null,
      attachment_name: null,
      attachment_size: null,
      attachment_mime: null,
      attachment_duration: null,
    },
  });

  if (message.attachment_key) {
    await storage.delete(message.attachment_key);
  }

  return { id: messageId, conversation_id: conversationId, memberIds: await memberIds(prisma, conversationId) };
}

/**
 * Presign an upload for a chat attachment. The caller must be a member of the
 * conversation. Returns the opaque `storage_key` (which the client passes back to
 * `createMessage`) and the presigned upload instruction.
 */
export async function presignChatUpload(
  prisma: PrismaClient,
  storage: StorageDriver,
  senderId: string,
  conversationId: string,
  input: { file_name: string; file_size: number; mime_type: string },
): Promise<{ storage_key: string; upload: PresignedUpload }> {
  await assertConversationMember(prisma, senderId, conversationId);
  if (input.file_size > config.ATTACHMENT_MAX_BYTES) {
    throw AppError.badRequest(
      `file_size exceeds the maximum allowed (${config.ATTACHMENT_MAX_BYTES} bytes)`,
    );
  }
  const storage_key = buildChatStorageKey(conversationId, input.file_name);
  const upload = await storage.presignUpload(storage_key, input.mime_type);
  return { storage_key, upload };
}

/** Outcome of toggling an emoji reaction, for the real-time event. */
export interface ReactionResult {
  action: 'added' | 'removed';
  message_id: string;
  conversation_id: string;
  emoji: string;
  user_id: string;
  memberIds: string[];
}

/**
 * Toggle an emoji reaction on a message (Telegram-style tap-to-react): if the
 * caller already reacted with this emoji it is removed, otherwise it is added.
 * Broadcast as `reaction_added` / `reaction_removed` to every member.
 */
export async function toggleReaction(
  prisma: PrismaClient,
  userId: string,
  conversationId: string,
  messageId: string,
  emoji: string,
): Promise<ReactionResult> {
  await assertConversationMember(prisma, userId, conversationId);

  const message = await prisma.message.findFirst({
    where: { id: messageId, conversation_id: conversationId, deleted_at: null },
    select: { id: true },
  });
  if (!message) throw AppError.notFound('Message not found');

  const key = { message_id_user_id_emoji: { message_id: messageId, user_id: userId, emoji } };
  const existing = await prisma.messageReaction.findUnique({ where: key });

  let action: 'added' | 'removed';
  if (existing) {
    await prisma.messageReaction.delete({ where: key });
    action = 'removed';
  } else {
    await prisma.messageReaction.create({
      data: { message_id: messageId, user_id: userId, emoji },
    });
    action = 'added';
  }

  return {
    action,
    message_id: messageId,
    conversation_id: conversationId,
    emoji,
    user_id: userId,
    memberIds: await memberIds(prisma, conversationId),
  };
}

/** Resolve the member ids of a conversation the caller belongs to (for WS relay). */
export async function conversationMemberIds(
  prisma: PrismaClient,
  userId: string,
  conversationId: string,
): Promise<string[]> {
  await assertConversationMember(prisma, userId, conversationId);
  return memberIds(prisma, conversationId);
}
