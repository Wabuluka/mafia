// ---------------------------------------------------------------------------
// RoomManager — the in-memory registry of active games, keyed by room code.
// This is the "source of truth during play" the hot-path boundary comment
// in db/index.ts refers to: everything in here is a plain object living in
// process memory, mutated synchronously by the socket handlers, and
// checkpointed to MongoDB only at phase boundaries and game end.
//
// One process holds one RoomManager. If this server is ever horizontally
// scaled, room-to-instance affinity (sticky sessions, or moving room state
// to a shared store) becomes required — out of scope here, called out
// explicitly rather than silently assumed away.
// ---------------------------------------------------------------------------

import type { ConfigurablePhaseDurationKey, FullGameState, PlayerId, RoomCode } from '@mafia/shared';
import type { GameEventDocument } from '../db/types';
import { clearDeadline, type ScheduledDeadline } from './scheduler';

type NewEvent = Omit<GameEventDocument, '_id' | 'sequence' | 'createdAt'>;

/** Everything the realtime layer tracks for one active room, beyond the
 * pure FullGameState the engine operates on. */
export interface GameSession {
  roomCode: RoomCode;
  /** Absent while the room is still in LOBBY (no game document exists yet). */
  gameId?: string;
  state: FullGameState;
  /** The current phase's scheduled auto-advance deadline. Cleared and
   * replaced on every phase transition (see scheduler.ts); `undefined` in
   * LOBBY/GAME_OVER, which don't run on a timer, or briefly while a phase
   * is being resolved. `session.state.phaseTimer` (the shared, client-
   * facing `PhaseTimer` type) is always kept in sync with this — this
   * field is the server-only handle needed to actually cancel it. */
  deadline?: ScheduledDeadline;
  /** Every socket currently attached to this room, keyed by playerId. A
   * player can have at most one active socket — a reconnect replaces the
   * previous entry rather than adding a second (see socketAuth.ts). */
  sockets: Map<PlayerId, string>; // playerId -> socket.id
  /** Idempotency cache for client-submitted actions — see idempotency.ts.
   * Keyed per session so it's naturally garbage-collected when the session
   * ends, rather than needing its own TTL sweep. */
  seenActionIds: Set<string>;
  /** Monotonic counter this process uses to derive the engine's
   * `assignRoles` seed — see startGame handler. Not persisted; a process
   * restart mid-lobby simply reshuffles, which is fine since the lobby
   * hasn't committed to roles yet. */
  roleSeed: number;
  /** Events accumulated since the last phase-boundary flush (night
   * actions, votes, chat messages). Cleared by `persistPhaseBoundary` —
   * see persistence.ts and the hot-path boundary comment in db/index.ts. */
  pendingEvents: NewEvent[];
  /** Host-configured overrides for timed phase durations, set via the
   * `updateRoomSettings` event (see handlers/updateRoomSettings.ts).
   * Absent keys fall back to DEFAULT_PHASE_DURATIONS_MS — see
   * phaseLoop.ts's `durationFor`. Lobby-only to change; once a game
   * starts, whatever was configured is locked in for the rest of that
   * game (mid-game duration changes would be a much stranger UX problem
   * — "was my vote timer just shortened out from under me?" — that this
   * app doesn't attempt to solve). */
  phaseDurationOverridesMs: Partial<Record<ConfigurablePhaseDurationKey, number>>;
}

export class RoomManager {
  private readonly sessions = new Map<RoomCode, GameSession>();

  get(roomCode: RoomCode): GameSession | undefined {
    return this.sessions.get(roomCode);
  }

  has(roomCode: RoomCode): boolean {
    return this.sessions.has(roomCode);
  }

  create(session: GameSession): void {
    this.sessions.set(session.roomCode, session);
  }

  /** Removes a session and cancels its pending deadline, if any — the one
   * place a GameSession's timer is guaranteed to be cleaned up no matter
   * why the room is going away (abandonment, every player leaving the
   * lobby, an explicit close). See scheduler.ts's module header for why a
   * leaked timer here would matter: it would keep firing `advancePhase`
   * against a session no longer in this map, doing real work (DB writes,
   * broadcasts) for a room nobody can reach anymore. */
  delete(roomCode: RoomCode): void {
    const session = this.sessions.get(roomCode);
    clearDeadline(session?.deadline);
    this.sessions.delete(roomCode);
  }

  /** Replaces a session's state in place. Kept as a single method (rather
   * than letting callers mutate `session.state` directly) so every state
   * transition funnels through one obvious point, useful for future
   * instrumentation (metrics, structured logging) without hunting down
   * every assignment site. */
  setState(roomCode: RoomCode, state: FullGameState): void {
    const session = this.sessions.get(roomCode);
    if (!session) return;
    session.state = state;
  }

  all(): IterableIterator<GameSession> {
    return this.sessions.values();
  }
}

/** Process-wide singleton — one RoomManager per server instance, matching
 * the module header's "one process holds one RoomManager" contract. */
export const roomManager = new RoomManager();
