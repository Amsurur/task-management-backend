// Real-time chat fan-out hub.
//
// An in-process registry mapping a userId to the set of live WebSocket
// connections that user currently has open (multiple tabs/devices → multiple
// sockets). When a message is created — via REST or over the socket itself — we
// look up every recipient's sockets and push the event to each.
//
// This is deliberately behind a small interface so a horizontally-scaled
// deployment can swap the in-process map for a Redis pub/sub backend without
// touching call sites: publish on message-create, and each node forwards to its
// locally-connected sockets.

import type { WebSocket } from '@fastify/websocket';

/**
 * An event pushed to clients over the realtime socket.
 *  - `message`         — a new chat message (chat fan-out)
 *  - `message_updated` — a message was edited (new body + edited_at)
 *  - `message_deleted`  — a message was deleted (id + conversation_id)
 *  - `reaction_added`      — an emoji reaction was added to a message
 *  - `reaction_removed`    — an emoji reaction was removed from a message
 *  - `conversation_updated`— a conversation was renamed or its membership changed
 *  - `conversation_deleted`— a conversation was deleted (or the recipient left it)
 *  - `notification`        — a serialized in-app notification (recipient-only)
 *  - `call`                — WebRTC call signaling relayed between members
 *  - `error`               — a problem with an inbound frame
 */
export interface OutboundEvent {
  type:
    | 'message'
    | 'message_updated'
    | 'message_deleted'
    | 'reaction_added'
    | 'reaction_removed'
    | 'conversation_updated'
    | 'conversation_deleted'
    | 'presence'
    | 'typing'
    | 'notification'
    | 'call'
    | 'error';
  data: unknown;
}

export interface ChatHub {
  /** Register a socket; returns true if the user just came online (first socket). */
  register(userId: string, socket: WebSocket): boolean;
  /** Unregister a socket; returns true if the user just went offline (last socket). */
  unregister(userId: string, socket: WebSocket): boolean;
  /** Whether the user currently has at least one live socket. */
  isOnline(userId: string): boolean;
  /** Push an event to every live socket of each given user (deduplicated). */
  broadcast(userIds: string[], event: OutboundEvent): void;
}

class InProcessChatHub implements ChatHub {
  private readonly byUser = new Map<string, Set<WebSocket>>();

  register(userId: string, socket: WebSocket): boolean {
    let sockets = this.byUser.get(userId);
    const cameOnline = !sockets || sockets.size === 0;
    if (!sockets) {
      sockets = new Set();
      this.byUser.set(userId, sockets);
    }
    sockets.add(socket);
    return cameOnline;
  }

  unregister(userId: string, socket: WebSocket): boolean {
    const sockets = this.byUser.get(userId);
    if (!sockets) return false;
    sockets.delete(socket);
    if (sockets.size === 0) {
      this.byUser.delete(userId);
      return true;
    }
    return false;
  }

  isOnline(userId: string): boolean {
    const sockets = this.byUser.get(userId);
    return !!sockets && sockets.size > 0;
  }

  broadcast(userIds: string[], event: OutboundEvent): void {
    const payload = JSON.stringify(event);
    for (const userId of new Set(userIds)) {
      const sockets = this.byUser.get(userId);
      if (!sockets) continue;
      for (const socket of sockets) {
        // ws readyState 1 === OPEN
        if (socket.readyState === 1) socket.send(payload);
      }
    }
  }
}

/** Process-wide singleton. Swap the implementation for Redis in production. */
export const chatHub: ChatHub = new InProcessChatHub();
