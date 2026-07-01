import type { PrismaClient, Prisma } from '@prisma/client';
import { AppError } from '../../lib/errors.js';
import type { NotificationListQuery } from './schema.js';

type NotificationWithActor = Prisma.NotificationGetPayload<{
  include: { actor: { select: { id: true; display_name: true; avatar_url: true } } };
}>;

const INCLUDE_ACTOR = {
  actor: { select: { id: true, display_name: true, avatar_url: true } },
} as const;

/**
 * List the requesting user's notifications in a workspace, newest first, with
 * cursor pagination. Notifications are private to their recipient — the query is
 * always scoped to `recipient_id`, so there is no cross-user leakage.
 */
export async function listNotifications(
  prisma: PrismaClient,
  workspaceId: string,
  recipientId: string,
  query: NotificationListQuery,
): Promise<{ data: NotificationWithActor[]; unread_count: number; next_cursor: string | null }> {
  const where: Prisma.NotificationWhereInput = {
    workspace_id: workspaceId,
    recipient_id: recipientId,
    ...(query.read !== undefined && { is_read: query.read }),
  };

  const limit = query.limit;
  const [entries, unread_count] = await Promise.all([
    prisma.notification.findMany({
      where,
      include: INCLUDE_ACTOR,
      orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
      take: limit + 1, // fetch one extra to detect a next page
      ...(query.cursor && { cursor: { id: query.cursor }, skip: 1 }),
    }),
    prisma.notification.count({
      where: { workspace_id: workspaceId, recipient_id: recipientId, is_read: false },
    }),
  ]);

  const hasMore = entries.length > limit;
  const data = hasMore ? entries.slice(0, limit) : entries;
  const next_cursor = hasMore ? (data[data.length - 1]?.id ?? null) : null;

  return { data, unread_count, next_cursor };
}

/**
 * Mark one notification read. Scoped to the recipient so a user can only touch
 * their own notifications; anything else is a 404 (not a 403, to avoid leaking
 * the existence of other users' notifications).
 */
export async function markRead(
  prisma: PrismaClient,
  workspaceId: string,
  recipientId: string,
  notificationId: string,
): Promise<NotificationWithActor> {
  const existing = await prisma.notification.findFirst({
    where: { id: notificationId, workspace_id: workspaceId, recipient_id: recipientId },
  });
  if (!existing) throw AppError.notFound('Notification not found');

  if (existing.is_read) {
    return prisma.notification.findUniqueOrThrow({
      where: { id: notificationId },
      include: INCLUDE_ACTOR,
    });
  }

  return prisma.notification.update({
    where: { id: notificationId },
    data: { is_read: true, read_at: new Date() },
    include: INCLUDE_ACTOR,
  });
}

/** Mark all of the recipient's unread notifications in the workspace as read. */
export async function markAllRead(
  prisma: PrismaClient,
  workspaceId: string,
  recipientId: string,
): Promise<{ updated: number }> {
  const result = await prisma.notification.updateMany({
    where: { workspace_id: workspaceId, recipient_id: recipientId, is_read: false },
    data: { is_read: true, read_at: new Date() },
  });
  return { updated: result.count };
}
