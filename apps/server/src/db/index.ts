// ---------------------------------------------------------------------------
// db/ — the MongoDB persistence layer. Read this before writing any code
// that touches this directory.
//
// HOT-PATH BOUNDARY — READ THIS FIRST
// ---------------------------------------------------------------------------
// This layer is NOT on the gameplay hot path. The authoritative state of a
// running game is an in-memory `FullGameState` (see @mafia/shared) owned by
// the game engine, one instance per active room. Every socket event that
// happens *during* a phase — a night action submission, a vote, a chat
// message — mutates that in-memory state directly and broadcasts the result
// immediately. None of those individual actions triggers a MongoDB write.
//
// MongoDB is written at exactly these points, and no others:
//   1. Phase boundaries — when the engine transitions LOBBY -> NIGHT ->
//      DAY_DISCUSSION -> DAY_VOTE -> ..., it flushes:
//        - one `recordPhaseTransition` call (games.repository), and
//        - one batched `appendEvents` call (game-events.repository) with
//          every action/vote/chat message accumulated during the phase
//          that just ended.
//   2. Game end — `completeGame` (or `abandonGame`) plus a final
//      `appendEvents` flush.
//   3. Lobby lifecycle — room creation, join/leave, ready toggles. These
//      are comparatively rare (human-paced, not per-tick) so writing them
//      as they happen is fine; they never happen inside a timed phase loop.
//
// Why this matters: a phase can contain dozens of rapid actions (every
// player voting within a few seconds of each other). If each one round-
// tripped to Mongo before the next socket event could be processed, phase
// timing and perceived responsiveness would be at the mercy of network
// latency to the database. Keeping gameplay entirely in memory and treating
// Mongo as a periodic checkpoint + audit log avoids that, at the cost of
// losing at most one in-progress phase's events if the process crashes
// mid-phase — an accepted tradeoff, not an oversight.
//
// If you're adding a new socket handler: mutate in-memory state and
// broadcast first. Only call into a repository here if what you're doing
// matches one of the three bullets above.
// ---------------------------------------------------------------------------

export { getDb, closeDb, registerGracefulShutdown } from './connection';
export { ensureCollections, COLLECTIONS } from './collections';
export type {
  RoomDocument,
  GameDocument,
  GameEventDocument,
  PlayerDocument,
} from './types';

export * as roomsRepository from './repositories/rooms.repository';
export * as gamesRepository from './repositories/games.repository';
export * as gameEventsRepository from './repositories/game-events.repository';
export * as playersRepository from './repositories/players.repository';
