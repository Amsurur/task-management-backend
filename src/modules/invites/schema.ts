import type { FastifySchema } from 'fastify';

const security = [{ bearerAuth: [] }];

const inviteDetailShape = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    workspace_id: { type: 'string' },
    email: { type: 'string' },
    role: { type: 'string', enum: ['admin', 'member', 'guest'] },
    expires_at: { type: 'string', format: 'date-time' },
    workspace: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        name: { type: 'string' },
        slug: { type: 'string' },
      },
    },
    invited_by: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        display_name: { type: 'string' },
        email: { type: 'string' },
      },
    },
  },
} as const;

const acceptedShape = {
  type: 'object',
  properties: {
    workspace_id: { type: 'string' },
    user_id: { type: 'string' },
    role: { type: 'string', enum: ['owner', 'admin', 'member', 'guest'] },
  },
} as const;

export const getInviteSchema: FastifySchema = {
  tags: ['Invites'],
  summary: 'Get invite metadata by token (public)',
  params: { type: 'object', required: ['token'], properties: { token: { type: 'string' } } },
  response: { 200: inviteDetailShape },
};

export const acceptInviteSchema: FastifySchema = {
  tags: ['Invites'],
  summary: 'Accept a workspace invite (requires authentication)',
  security,
  params: { type: 'object', required: ['token'], properties: { token: { type: 'string' } } },
  response: { 200: acceptedShape },
};
