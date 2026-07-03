import { z } from 'zod';
import type { FastifySchema } from 'fastify';

export const ListUsersQuerySchema = z.object({
  q: z.string().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export type ListUsersQuery = z.infer<typeof ListUsersQuerySchema>;

const security = [{ bearerAuth: [] }];

export const listUsersSchema: FastifySchema = {
  tags: ['Users'],
  summary: 'Directory of registered users (optional name/email search)',
  security,
  querystring: {
    type: 'object',
    properties: {
      q: { type: 'string', maxLength: 100 },
      limit: { type: 'integer', minimum: 1, maximum: 100 },
    },
  },
};

export const getUserProfileSchema: FastifySchema = {
  tags: ['Users'],
  summary: "Public profile of a user, with the projects the viewer is allowed to see",
  security,
  params: { type: 'object', properties: { userId: { type: 'string' } } },
};
