// ---------------------------------------------------------------------------
// VillageManager — the in-memory registry of active games, keyed by village
// code. This is the "source of truth during play" the hot-path boundary
// comment in db/index.ts refers to: everything in here is a plain object
// living in process memory, mutated synchronously by the socket handlers,
// and checkpointed to MongoDB only at phase boundaries and game end.
//
// One process holds one VillageManager. If this server is ever horizontally
// scaled, village-to-instance affinity (sticky sessions, or moving village
// state to a shared store) becomes required — out of scope here, called out
// explicitly rather than silently assumed away.
// ---------------------------------------------------------------------------

import type { ConfigurablePhaseDurationKey, FullGameState, PlayerId, VillageCode } from '@mafia/shared';
import type { GameEventDocument } from '../db/types';
import { clearDeadline, type ScheduledDeadline } from './scheduler';

type NewEvent = Omit<GameEventDocument, '_id' | 'sequence' | 'createdAt'>;

/** Everything the realtime layer tracks for one active village, beyond the
 * pure FullGameState the engine operates on. */
export interface GameSession {
  villageCode: VillageCode;
  /** Absent while the village is still in LOBBY (no game document exists yet). */
  gameId?: string;
  state: FullGameState;
  /** The current phase's scheduled auto-advance deadline. Cleared and
   * replaced on every phase transition (see scheduler.ts); `undefined` in
   * LOBBY/GAME_OVER, which don't run on a timer, or briefly while a phase
   * is being resolved. `session.state.phaseTimer` (the shared, client-
   * facing `PhaseTimer` type) is always kept in sync with this — this
   * field is the server-only handle needed to actually cancel it. */
  deadline?: ScheduledDeadline;
  /** Every socket currently attached to this village, keyed by playerId. A
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
   * `updateVillageSettings` event (see handlers/updateVillageSettings.ts).
   * Absent keys fall back to DEFAULT_PHASE_DURATIONS_MS — see
   * phaseLoop.ts's `durationFor`. Lobby-only to change; once a game
   * starts, whatever was configured is locked in for the rest of that
   * game (mid-game duration changes would be a much stranger UX problem
   * — "was my vote timer just shortened out from under me?" — that this
   * app doesn't attempt to solve). */
  phaseDurationOverridesMs: Partial<Record<ConfigurablePhaseDurationKey, number>>;
  /** Set while the host has paused the current phase's timer (see
   * handlers/pauseTimer.ts and phaseLoop.ts's `pauseCurrentPhase`/
   * `resumeCurrentPhase`). Holds the time remaining at the moment of pause
   * so `resumeCurrentPhase` can grant exactly that much time back, never a
   * fresh full duration. Mirrors — and must stay in sync with —
   * `session.state.phaseTimer.pausedAt`, which is the client-visible half
   * of the same fact; this field is the server-only bookkeeping needed to
   * actually reschedule the deadline on resume. `undefined` whenever the
   * phase isn't paused (including LOBBY/GAME_OVER, which have no timer at
   * all). */
  pausedRemainingMs?: number;
  /** Re-entrancy guard for `advancePhase` (see phaseLoop.ts). Set true for
   * the duration of one resolution (including its `await`ed persistence
   * writes) and false again once it's fully applied. `advancePhase` can be
   * reached three ways — the scheduled deadline, `tryResolveEarly`, or the
   * host's `endPhaseNow` — and while today's callers happen to invoke it
   * only from synchronous socket-event dispatch (making a same-tick race
   * effectively impossible), this flag makes that safety explicit and
   * future-proof rather than resting on a timing argument: a second call
   * that lands while one is already in flight is a no-op instead of a
   * double resolution (double death/win-check/persistence write).
   * `undefined`/false whenever no resolution is in progress. */
  resolving?: boolean;
  /** Players awaiting host approval, keyed by playerId — the in-memory,
   * live-session counterpart to VillageDocument.pendingPlayerIds (Mongo).
   * NOT part of `state.players`: a pending player has no role, no vote,
   * isn't counted anywhere the engine looks at the roster, and is
   * completely invisible to every OTHER player's PlayerView — only the
   * host's private channel ever hears about this map's contents (see
   * `joinRequestsUpdated`). Holds each requester's socket id too, so
   * `respondToJoinRequest` can notify them directly and so a disconnect
   * mid-wait can be cleaned up without a linear scan of every socket. */
  pendingRequests: Map<PlayerId, { playerName: string; socketId: string; requestedAt: number }>;
}

export class VillageManager {
  private readonly sessions = new Map<VillageCode, GameSession>();

  get(villageCode: VillageCode): GameSession | undefined {
    return this.sessions.get(villageCode);
  }

  has(villageCode: VillageCode): boolean {
    return this.sessions.has(villageCode);
  }

  create(session: GameSession): void {
    this.sessions.set(session.villageCode, session);
  }

  /** Removes a session and cancels its pending deadline, if any — the one
   * place a GameSession's timer is guaranteed to be cleaned up no matter
   * why the village is going away (abandonment, every player leaving the
   * lobby, an explicit close). See scheduler.ts's module header for why a
   * leaked timer here would matter: it would keep firing `advancePhase`
   * against a session no longer in this map, doing real work (DB writes,
   * broadcasts) for a village nobody can reach anymore. */
  delete(villageCode: VillageCode): void {
    const session = this.sessions.get(villageCode);
    clearDeadline(session?.deadline);
    this.sessions.delete(villageCode);
  }

  /** Replaces a session's state in place. Kept as a single method (rather
   * than letting callers mutate `session.state` directly) so every state
   * transition funnels through one obvious point, useful for future
   * instrumentation (metrics, structured logging) without hunting down
   * every assignment site. */
  setState(villageCode: VillageCode, state: FullGameState): void {
    const session = this.sessions.get(villageCode);
    if (!session) return;
    session.state = state;
  }

  all(): IterableIterator<GameSession> {
    return this.sessions.values();
  }
}

/** Process-wide singleton — one VillageManager per server instance, matching
 * the module header's "one process holds one VillageManager" contract. */
export const villageManager = new VillageManager();
