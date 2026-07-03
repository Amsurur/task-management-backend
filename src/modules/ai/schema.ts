import { z } from 'zod';
import type { FastifySchema } from 'fastify';

export const AiChatBodySchema = z.object({
  message: z.string().min(1).max(10_000),
  history: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().min(1).max(10_000),
      }),
    )
    .max(40)
    .optional(),
});

export type AiChatBody = z.infer<typeof AiChatBodySchema>;

export const aiChatRouteSchema: FastifySchema = {
  tags: ['AI'],
  summary: 'Chat with the AI assistant — answers questions and performs actions (multilingual)',
  security: [{ bearerAuth: [] }],
  body: {
    type: 'object',
    required: ['message'],
    properties: {
      message: { type: 'string', minLength: 1, maxLength: 10000 },
      history: {
        type: 'array',
        maxItems: 40,
        items: {
          type: 'object',
          required: ['role', 'content'],
          properties: {
            role: { type: 'string', enum: ['user', 'assistant'] },
            content: { type: 'string', minLength: 1, maxLength: 10000 },
          },
        },
      },
    },
  },
  response: {
    200: {
      type: 'object',
      properties: {
        reply: { type: 'string' },
        actions: {
          type: 'array',
          items: {
            type: 'object',
            properties: { tool: { type: 'string' }, ok: { type: 'boolean' } },
          },
        },
      },
    },
  },
};
