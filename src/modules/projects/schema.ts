import { z } from 'zod';
import type { FastifySchema } from 'fastify';

export const CreateProjectBodySchema = z.object({
  name: z.string().min(1).max(100),
  identifier: z
    .string()
    .min(1)
    .max(10)
    .regex(/^[A-Z0-9]+$/, 'Identifier must be uppercase letters and digits only'),
  description: z.string().max(500).optional(),
  lead_id: z.string().uuid().optional().nullable(),
  visibility: z.enum(['private', 'public']).default('private'),
});

export const UpdateProjectBodySchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional().nullable(),
  lead_id: z.string().uuid().optional().nullable(),
  visibility: z.enum(['private', 'public']).optional(),
  is_archived: z.boolean().optional(),
});

export const AddProjectMemberBodySchema = z.object({
  user_id: z.string().uuid(),
  role: z.enum(['admin', 'member', 'viewer']).default('member'),
});

export type CreateProjectBody = z.infer<typeof CreateProjectBodySchema>;
export type UpdateProjectBody = z.infer<typeof UpdateProjectBodySchema>;
export type AddProjectMemberBody = z.infer<typeof AddProjectMemberBodySchema>;

// ─── Fastify route schemas ────────────────────────────────────────────────────

const projectShape = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    workspace_id: { type: 'string' },
    name: { type: 'string' },
    identifier: { type: 'string' },
    description: { type: 'string', nullable: true },
    lead_id: { type: 'string', nullable: true },
    visibility: { type: 'string', enum: ['private', 'public'] },
    is_archived: { type: 'boolean' },
    created_at: { type: 'string', format: 'date-time' },
    updated_at: { type: 'string', format: 'date-time' },
  },
} as const;

const projectMemberShape = {
  type: 'object',
  properties: {
    project_id: { type: 'string' },
    user_id: { type: 'string' },
    role: { type: 'string', enum: ['admin', 'member', 'viewer'] },
    created_at: { type: 'string', format: 'date-time' },
    user: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        email: { type: 'string' },
        display_name: { type: 'string' },
        avatar_url: { type: 'string', nullable: true },
      },
    },
  },
} as const;

const security = [{ bearerAuth: [] }];
const wsParams = {
  type: 'object',
  properties: { workspaceSlug: { type: 'string' } },
};
const projectParams = {
  type: 'object',
  properties: { workspaceSlug: { type: 'string' }, projectId: { type: 'string' } },
};

export const listProjectsSchema: FastifySchema = {
  tags: ['Projects'],
  summary: 'List projects in the workspace',
  security,
  params: wsParams,
  response: { 200: { type: 'array', items: projectShape } },
};

export const createProjectSchema: FastifySchema = {
  tags: ['Projects'],
  summary: 'Create a new project (admin+)',
  security,
  params: wsParams,
  body: {
    type: 'object',
    required: ['name', 'identifier'],
    properties: {
      name: { type: 'string', minLength: 1, maxLength: 100 },
      identifier: { type: 'string', minLength: 1, maxLength: 10, pattern: '^[A-Z0-9]+$' },
      description: { type: 'string', maxLength: 500 },
      lead_id: { type: 'string', format: 'uuid', nullable: true },
      visibility: { type: 'string', enum: ['private', 'public'] },
    },
  },
  response: { 201: projectShape },
};

export const getProjectSchema: FastifySchema = {
  tags: ['Projects'],
  summary: 'Get project details',
  security,
  params: projectParams,
  response: { 200: projectShape },
};

export const updateProjectSchema: FastifySchema = {
  tags: ['Projects'],
  summary: 'Update project (admin+)',
  security,
  params: projectParams,
  body: {
    type: 'object',
    properties: {
      name: { type: 'string', minLength: 1, maxLength: 100 },
      description: { type: 'string', nullable: true },
      lead_id: { type: 'string', format: 'uuid', nullable: true },
      visibility: { type: 'string', enum: ['private', 'public'] },
      is_archived: { type: 'boolean' },
    },
  },
  response: { 200: projectShape },
};

export const deleteProjectSchema: FastifySchema = {
  tags: ['Projects'],
  summary: 'Delete project (admin+)',
  security,
  params: projectParams,
  response: { 204: { type: 'null' } },
};

export const listProjectMembersSchema: FastifySchema = {
  tags: ['Projects'],
  summary: 'List project members',
  security,
  params: projectParams,
  response: { 200: { type: 'array', items: projectMemberShape } },
};

export const addProjectMemberSchema: FastifySchema = {
  tags: ['Projects'],
  summary: 'Add a workspace member to the project (admin+)',
  security,
  params: projectParams,
  body: {
    type: 'object',
    required: ['user_id'],
    properties: {
      user_id: { type: 'string', format: 'uuid' },
      role: { type: 'string', enum: ['admin', 'member', 'viewer'] },
    },
  },
  response: { 201: projectMemberShape },
};

export const removeProjectMemberSchema: FastifySchema = {
  tags: ['Projects'],
  summary: 'Remove a member from the project (admin+)',
  security,
  params: {
    type: 'object',
    properties: {
      workspaceSlug: { type: 'string' },
      projectId: { type: 'string' },
      userId: { type: 'string' },
    },
  },
  response: { 204: { type: 'null' } },
};
