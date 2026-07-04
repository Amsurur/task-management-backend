import { z } from 'zod';
import type { FastifySchema } from 'fastify';

const STATE_GROUPS = ['backlog', 'unstarted', 'started', 'completed', 'cancelled'] as const;

export const CreateStateBodySchema = z.object({
  name: z.string().min(1).max(50),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Color must be a hex code like #3B82F6'),
  group: z.enum(STATE_GROUPS),
  order: z.number().int().min(0).default(0),
  is_default: z.boolean().default(false),
});

export const UpdateStateBodySchema = z.object({
  name: z.string().min(1).max(50).optional(),
  color: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/, 'Color must be a hex code like #3B82F6')
    .optional(),
  group: z.enum(STATE_GROUPS).optional(),
  order: z.number().int().min(0).optional(),
  is_default: z.boolean().optional(),
});

export const DeleteStateBodySchema = z.object({
  /** Issues in the deleted state are reassigned to this state. */
  transfer_to_state_id: z.string().uuid().optional(),
});

export type CreateStateBody = z.infer<typeof CreateStateBodySchema>;
export type UpdateStateBody = z.infer<typeof UpdateStateBodySchema>;
export type DeleteStateBody = z.infer<typeof DeleteStateBodySchema>;

// ─── Fastify route schemas ────────────────────────────────────────────────────

const stateShape = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    project_id: { type: 'string' },
    name: { type: 'string' },
    color: { type: 'string' },
    group: { type: 'string', enum: STATE_GROUPS },
    order: { type: 'integer' },
    is_default: { type: 'boolean' },
    created_at: { type: 'string', format: 'date-time' },
    updated_at: { type: 'string', format: 'date-time' },
  },
} as const;

const security = [{ bearerAuth: [] }];
const stateParams = {
  type: 'object',
  properties: {
    workspaceSlug: { type: 'string' },
    projectId: { type: 'string' },
    stateId: { type: 'string' },
  },
};

export const listStatesSchema: FastifySchema = {
  tags: ['States'],
  summary: 'List states for a project',
  security,
  params: stateParams,
  response: { 200: { type: 'array', items: stateShape } },
};

export const createStateSchema: FastifySchema = {
  tags: ['States'],
  summary: 'Create a custom state (admin+)',
  security,
  params: stateParams,
  body: {
    type: 'object',
    required: ['name', 'color', 'group'],
    properties: {
      name: { type: 'string', minLength: 1, maxLength: 50 },
      color: { type: 'string', pattern: '^#[0-9A-Fa-f]{6}$' },
      group: { type: 'string', enum: STATE_GROUPS },
      order: { type: 'integer', minimum: 0 },
      is_default: { type: 'boolean' },
    },
  },
  response: { 201: stateShape },
};

export const updateStateSchema: FastifySchema = {
  tags: ['States'],
  summary: 'Update a state (admin+)',
  security,
  params: stateParams,
  body: {
    type: 'object',
    properties: {
      name: { type: 'string', minLength: 1, maxLength: 50 },
      color: { type: 'string', pattern: '^#[0-9A-Fa-f]{6}$' },
      group: { type: 'string', enum: STATE_GROUPS },
      order: { type: 'integer', minimum: 0 },
      is_default: { type: 'boolean' },
    },
  },
  response: { 200: stateShape },
};

export const deleteStateSchema: FastifySchema = {
  tags: ['States'],
  summary: 'Delete a state; issues are reassigned to the specified or default state (admin+)',
  security,
  params: stateParams,
  // Body is optional: without a transfer target, issues move to the default
  // state. `null`/absent must be accepted (not every client sends a body).
  body: {
    type: ['object', 'null'],
    properties: { transfer_to_state_id: { type: 'string', format: 'uuid' } },
  },
  response: { 204: { type: 'null' } },
};
