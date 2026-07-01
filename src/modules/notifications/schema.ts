import { z } from 'zod';
import type { FastifySchema } from 'fastify';

export const NotificationListQuerySchema = z.object({
  /** Filter by read state. Omit for all. */
  read: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export type NotificationListQuery = z.infer<typeof NotificationListQuerySchema>;

// ─── Fastify route schemas ────────────────────────────────────────────────────

const security = [{ bearerAuth: [] }];

const actorShape = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    display_name: { type: 'string' },
    avatar_url: { type: 'string', nullable: true },
  },
} as const;

const notificationShape = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    workspace_id: { type: 'string' },
    recipient_id: { type: 'string' },
    actor_id: { type: 'string' },
    type: { type: 'string', enum: ['issue_assigned', 'comment_added', 'mentioned'] },
    issue_id: { type: 'string', nullable: true },
    entity_id: { type: 'string', nullable: true },
    is_read: { type: 'boolean' },
    read_at: { type: 'string', format: 'date-time', nullable: true },
    created_at: { type: 'string', format: 'date-time' },
    actor: actorShape,
  },
} as const;

export const listNotificationsSchema: FastifySchema = {
  tags: ['Notifications'],
  summary: "List the current user's notifications in a workspace (newest first)",
  security,
  querystring: {
    type: 'object',
    properties: {
      read: { type: 'string', enum: ['true', 'false'] },
      cursor: { type: 'string' },
      limit: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
    },
  },
  response: {
    200: {
      type: 'object',
      properties: {
        data: { type: 'array', items: notificationShape },
        unread_count: { type: 'integer' },
        next_cursor: { type: 'string', nullable: true },
      },
    },
  },
};

export const markReadSchema: FastifySchema = {
  tags: ['Notifications'],
  summary: 'Mark a single notification as read',
  security,
  response: { 200: notificationShape },
};

export const markAllReadSchema: FastifySchema = {
  tags: ['Notifications'],
  summary: 'Mark all of the current user notifications in this workspace as read',
  security,
  response: {
    200: {
      type: 'object',
      properties: { updated: { type: 'integer' } },
    },
  },
};
