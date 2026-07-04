// Unit tests for the inbound WebSocket frame schemas (no DB needed).
//
// Regression guard for the call/typing signaling bug: the web client wraps the
// frame fields in a `data` envelope (`{ type, data: { action, ... } }`) — the
// same shape the server emits on outbound events — while other clients send the
// fields flat. Both shapes must parse, otherwise the server rejects the frame
// and never relays the WebRTC offer/answer/ice (so calls never connect) or the
// typing indicator.

import { describe, expect, it } from 'vitest';
import { WsCallFrameSchema, WsTypingFrameSchema } from '../src/modules/chat/schema.js';

const CONV = '11111111-1111-1111-1111-111111111111';

describe('WsCallFrameSchema', () => {
  it('accepts the web client shape (fields nested under `data`)', () => {
    const parsed = WsCallFrameSchema.parse({
      type: 'call',
      data: { action: 'offer', conversation_id: CONV, payload: { sdp: 'x' } },
    });
    expect(parsed).toMatchObject({
      type: 'call',
      action: 'offer',
      conversation_id: CONV,
      payload: { sdp: 'x' },
    });
  });

  it('accepts the flat shape (fields at top level)', () => {
    const parsed = WsCallFrameSchema.parse({
      type: 'call',
      action: 'answer',
      conversation_id: CONV,
    });
    expect(parsed).toMatchObject({ type: 'call', action: 'answer', conversation_id: CONV });
  });

  it('accepts every signaling action', () => {
    for (const action of ['offer', 'answer', 'ice', 'hangup', 'reject'] as const) {
      const parsed = WsCallFrameSchema.parse({
        type: 'call',
        data: { action, conversation_id: CONV },
      });
      expect(parsed).toMatchObject({ action });
    }
  });

  it('rejects an unknown action', () => {
    expect(() =>
      WsCallFrameSchema.parse({ type: 'call', data: { action: 'bogus', conversation_id: CONV } }),
    ).toThrow();
  });

  it('rejects a missing conversation_id', () => {
    expect(() => WsCallFrameSchema.parse({ type: 'call', data: { action: 'offer' } })).toThrow();
  });
});

describe('WsTypingFrameSchema', () => {
  it('accepts the web client shape (nested `data`) and defaults typing=true', () => {
    const parsed = WsTypingFrameSchema.parse({
      type: 'typing',
      data: { conversation_id: CONV },
    });
    expect(parsed).toMatchObject({ type: 'typing', conversation_id: CONV, typing: true });
  });

  it('accepts the flat shape with an explicit typing flag', () => {
    const parsed = WsTypingFrameSchema.parse({
      type: 'typing',
      conversation_id: CONV,
      typing: false,
    });
    expect(parsed).toMatchObject({ conversation_id: CONV, typing: false });
  });
});
