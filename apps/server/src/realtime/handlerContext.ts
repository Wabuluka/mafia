// ---------------------------------------------------------------------------
// Shared plumbing every socket event handler uses: pulling the session and
// authenticated player, validating the payload against its Zod schema (the
// exact schemas defined in @mafia/shared — the same contract the client
// bundles), and a uniform way to reply with an AckResult.
// ---------------------------------------------------------------------------

import type { AckResult, ErrorPayload, PlayerId, RoomCode } from '@mafia/shared';
import type { ZodTypeAny, z } from 'zod';
import type { GameSession } from './RoomManager';
import { roomManager } from './RoomManager';
import type { GameServer } from './emit';

export interface HandlerAck {
  (result: AckResult): void;
}

/** Parses `payload` against `schema`; on failure, acks a VALIDATION_ERROR
 * and returns undefined so the caller can bail out with a single check. */
export function parseOrAck<Schema extends ZodTypeAny>(
  schema: Schema,
  payload: unknown,
  ack: HandlerAck | undefined,
): z.infer<Schema> | undefined {
  const result = schema.safeParse(payload);
  if (!result.success) {
    ackError(ack, { code: 'VALIDATION_ERROR', message: result.error.issues.map((i) => i.message).join('; ') });
    return undefined;
  }
  return result.data;
}

export function ackOk(ack: HandlerAck | undefined): void {
  ack?.({ ok: true });
}

export function ackError(ack: HandlerAck | undefined, error: ErrorPayload): void {
  ack?.({ ok: false, error });
}

/** Looks up the in-memory session for a room code, acking a consistent
 * ROOM_NOT_FOUND if it isn't currently active. Every handler that operates
 * on an existing game goes through this rather than re-checking
 * `roomManager.get(...)` inline. */
export function requireGameSession(roomCode: RoomCode, ack: HandlerAck | undefined): GameSession | undefined {
  const session = roomManager.get(roomCode);
  if (!session) {
    ackError(ack, { code: 'ROOM_NOT_FOUND', message: `No active room with code ${roomCode}.` });
    return undefined;
  }
  return session;
}

/** Confirms `playerId` is actually a member of `session`'s current
 * roster — a socket that authenticated fine but was never added to (or was
 * later removed from) this specific game shouldn't be able to act in it. */
export function requirePlayerInSession(
  session: GameSession,
  playerId: PlayerId,
  ack: HandlerAck | undefined,
): boolean {
  const inRoster = session.state.players.some((p) => p.id === playerId);
  if (!inRoster) {
    ackError(ack, { code: 'NOT_IN_GAME', message: 'You are not a player in this game.' });
    return false;
  }
  return true;
}

export type { GameServer };
