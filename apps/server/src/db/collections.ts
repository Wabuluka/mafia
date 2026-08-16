// ---------------------------------------------------------------------------
// Collection setup: creates each collection with its JSON Schema validator
// (if it doesn't already exist) and ensures its indexes. Idempotent — safe
// to run on every boot. Call `ensureCollections()` once at startup, after
// `getDb()` resolves and before the server starts accepting socket
// connections.
// ---------------------------------------------------------------------------

import type { Db } from 'mongodb';
import { gameEventsValidator, gamesValidator, playersValidator, roomsValidator } from './schemas';

export const COLLECTIONS = {
  rooms: 'rooms',
  games: 'games',
  gameEvents: 'gameEvents',
  players: 'players',
} as const;

async function ensureCollection(db: Db, name: string, validator: object): Promise<void> {
  const existing = await db.listCollections({ name }).toArray();
  if (existing.length === 0) {
    await db.createCollection(name, { validator, validationLevel: 'strict', validationAction: 'error' });
  } else {
    // `collMod` so an already-deployed collection picks up validator changes
    // on the next boot instead of only on first creation.
    await db.command({ collMod: name, validator, validationLevel: 'strict', validationAction: 'error' });
  }
}

export async function ensureCollections(db: Db): Promise<void> {
  await Promise.all([
    ensureCollection(db, COLLECTIONS.rooms, roomsValidator),
    ensureCollection(db, COLLECTIONS.games, gamesValidator),
    ensureCollection(db, COLLECTIONS.gameEvents, gameEventsValidator),
    ensureCollection(db, COLLECTIONS.players, playersValidator),
  ]);

  await ensureIndexes(db);
}

/**
 * Every index below, and why it exists. Kept in one place so an index isn't
 * added without a stated reason.
 */
async function ensureIndexes(db: Db): Promise<void> {
  const rooms = db.collection(COLLECTIONS.rooms);
  const games = db.collection(COLLECTIONS.games);
  const gameEvents = db.collection(COLLECTIONS.gameEvents);
  const players = db.collection(COLLECTIONS.players);

  await Promise.all([
    // --- rooms ---------------------------------------------------------
    // Unique index on the room code: MongoDB already enforces this for
    // free, because the room code IS `_id` (see types.ts) and every
    // collection's `_id` field has a mandatory, automatically-created
    // unique index — attempting to declare it explicitly is actually
    // rejected by the server ("not valid for an _id index specification").
    // Documented here, with no createIndex call, so the guarantee ("two
    // live rooms can never share a code") isn't implicit tribal knowledge.
    // If room codes ever move off `_id` onto a separate `code` field, this
    // becomes a real `rooms.createIndex({ code: 1 }, { unique: true })`.

    // TTL index: abandoned rooms (never started, or a lobby left open)
    // self-delete 4 hours after their last activity. Without this, dead
    // lobbies accumulate forever. `lastActivityAt` is bumped on join,
    // ready-toggle, and game start, so an active lobby's TTL keeps
    // resetting; only a genuinely idle room expires.
    rooms.createIndex(
      { lastActivityAt: 1 },
      { expireAfterSeconds: 4 * 60 * 60, name: 'ttl_abandoned_rooms' },
    ),

    // --- games -----------------------------------------------------------
    // Lookup "all games ever played in this room" (e.g. rematch history) —
    // not hot-path, but common enough on a room's post-game screen to
    // deserve an index rather than a collection scan.
    games.createIndex({ roomCode: 1, startedAt: -1 }, { name: 'by_room_recent' }),
    games.createIndex({ status: 1 }, { name: 'by_status' }),

    // --- gameEvents ------------------------------------------------------
    // Compound index supporting "fetch all events for game X in order".
    // gameId first (equality match, narrows to one game's events) then
    // sequence ascending (the exact sort the replay/dispute-resolution
    // query needs), so the query is a pure index scan with zero in-memory
    // sort. Also serves as the natural uniqueness constraint for
    // (gameId, sequence) pairs, which the event-sequencing logic in
    // game-events.repository.ts relies on to detect a lost-update race.
    gameEvents.createIndex({ gameId: 1, sequence: 1 }, { unique: true, name: 'by_game_in_order' }),

    // --- players -----------------------------------------------------------
    // A session token is how a reconnecting browser resolves back to its
    // anonymous identity; must be unique and is the lookup path on every
    // reconnect, so it's indexed (and enforced unique at the DB level, not
    // just trusted from application code).
    players.createIndex({ sessionToken: 1 }, { unique: true, name: 'uniq_session_token' }),
  ]);
}
