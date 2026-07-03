// OpenAPI docs.
//
// Registers @fastify/swagger to build the OpenAPI document from each route's
// JSON schema, and @fastify/swagger-ui to serve interactive docs at `/docs`.
// Must be registered BEFORE the routes it should document. A bearer-auth scheme
// is declared up front so Phase 1 auth-protected routes can reference it.

import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';

async function swaggerPlugin(app: FastifyInstance): Promise<void> {
  await app.register(swagger, {
    openapi: {
      info: {
        title: 'Task Management API',
        description: [
          'Plane/Jira-inspired multi-tenant task management REST API.',
          '',
          '## Realtime (WebSocket)',
          '',
          'A single authenticated WebSocket delivers live events:',
          '',
          '```',
          'ws://<host>/api/v1/ws/chat?token=<access_token>',
          '```',
          '',
          'The JWT **access token** is passed as the `token` query parameter',
          '(browsers cannot set custom headers on a WS handshake). An invalid or',
          'missing token is rejected with close code `1008`.',
          '',
          'Server → client frames are JSON `{ "type", "data" }`:',
          '',
          '- `message` — a new chat message. Pushed to every member of the',
          '  conversation (including the sender\'s other devices). `data` is the',
          '  serialized message with its `sender`, `kind`, and any attachment.',
          '- `message_updated` — a message was edited. `data` is the updated',
          '  message (with `edited_at`).',
          '- `message_deleted` — a message was deleted. `data` is',
          '  `{ id, conversation_id }`.',
          '- `reaction_added` / `reaction_removed` — an emoji reaction toggled.',
          '  `data` is `{ message_id, conversation_id, emoji, user_id }`. Toggle via',
          '  `POST /conversations/:id/messages/:messageId/reactions { emoji }`.',
          '- `conversation_updated` — a chat was renamed / membership changed',
          '  (`PATCH /conversations/:id { name }`). `data` is `{ id, name? }`.',
          '- `conversation_deleted` — a chat was deleted or you left it',
          '  (`DELETE /conversations/:id`). `data` is `{ id }`.',
          '- `call` — WebRTC call signaling relayed to the other member(s).',
          '  `data` is `{ action, conversation_id, from, payload }` where `action`',
          '  is `offer | answer | ice | hangup | reject`.',
          '- `notification` — a new in-app notification. Pushed **only** to the',
          '  `recipient_id`. `data` is the serialized notification with its `actor`',
          '  and `type` (`issue_assigned` | `comment_added` | `mentioned`).',
          '- `error` — an inbound frame could not be processed; `data.message`',
          '  explains why.',
          '',
          'Client → server frames:',
          '',
          '```json',
          '{ "type": "send", "conversation_id": "<uuid>", "body": "hi" }',
          '{ "type": "call", "action": "offer",  "conversation_id": "<uuid>", "payload": { "sdp": "…" } }',
          '{ "type": "call", "action": "answer", "conversation_id": "<uuid>", "payload": { "sdp": "…" } }',
          '{ "type": "call", "action": "ice",    "conversation_id": "<uuid>", "payload": { "candidate": "…" } }',
          '{ "type": "call", "action": "hangup", "conversation_id": "<uuid>" }',
          '```',
          '',
          '### Attachments (image / video / voice / file)',
          '',
          '1. `POST /conversations/:id/attachments` with `{ file_name, file_size,',
          '   mime_type }` → returns `{ storage_key, upload }`.',
          '2. Upload the bytes with `upload.method` to `upload.url`.',
          '3. `POST /conversations/:id/messages` with `{ kind, attachment_key,',
          '   attachment_name, attachment_size, attachment_mime, attachment_duration? }`',
          '   (`kind` = `image|video|audio|voice|file`; `body` optional caption).',
          '',
          'Edit / delete: `PATCH` and `DELETE /conversations/:id/messages/:messageId`',
          '(sender only).',
        ].join('\n'),
        version: '0.1.0',
      },
      servers: [{ url: '/api/v1', description: 'API v1 base path' }],
      components: {
        securitySchemes: {
          bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        },
      },
    },
  });

  await app.register(swaggerUi, {
    routePrefix: '/docs',
    uiConfig: { docExpansion: 'list', deepLinking: true },
  });
}

export default fp(swaggerPlugin, { name: 'swagger' });
