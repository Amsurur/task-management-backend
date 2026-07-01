import { z } from 'zod';
import type { FastifySchema } from 'fastify';

export const ActivityListQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export type ActivityListQuery = z.infer<typeof ActivityListQuerySchema>;

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

const activityShape = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    workspace_id: { type: 'string' },
    issue_id: { type: 'string', nullable: true },
    actor_id: { type: 'string' },
    action: { type: 'string' },
    field: { type: 'string', nullable: true },
    old_value: { type: 'string', nullable: true },
    new_value: { type: 'string', nullable: true },
    created_at: { type: 'string', format: 'date-time' },
    actor: actorShape,
  },
} as const;

export const listIssueActivitySchema: FastifySchema = {
  tags: ['Activity'],
  summary: 'List the activity history for an issue (newest first)',
  security,
  querystring: {
    type: 'object',
    properties: {
      cursor: { type: 'string' },
      limit: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
    },
  },
  response: {
    200: {
      type: 'object',
      properties: {
        data: { type: 'array', items: activityShape },
        next_cursor: { type: 'string', nullable: true },
      },
    },
  },
};
