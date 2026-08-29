// ---------------------------------------------------------------------------
// Typed repository for the `games` collection. No code outside this file
// should touch `db.collection('games')` directly.
//
// Reminder (see index.ts): these functions are called at phase boundaries
// and on game end — never once per player action. The in-memory game engine
// is the source of truth while a game is running.
// ---------------------------------------------------------------------------

import { randomUUID } from 'node:crypto';
import type { FullGameState, GameEndReason, Phase, PublicPlayer, VillageCode } from '@mafia/shared';
import { getDb } from '../connection';
import { COLLECTIONS } from '../collections';
import type { GameDocument } from '../types';

function collection() {
  return getDb().then((db) => db.collection<GameDocument>(COLLECTIONS.games));
}

/** Starts a new game record from the authoritative in-memory FullGameState
 * at the moment the lobby transitions to NIGHT. Captures the fixed roster
 * (with roles) once, since roles don't change after assignment. */
export async function createGame(state: FullGameState): Promise<GameDocument> {
  const firstPlayer = state.players[0];
  if (!firstPlayer) {
    throw new Error('createGame: FullGameState.players must not be empty');
  }
  const hostId = state.players.find((p) => p.isHost)?.id ?? firstPlayer.id;

  const now = new Date();
  const doc: GameDocument = {
    _id: randomUUID(),
    villageCode: state.villageCode,
    hostId,
    status: 'IN_PROGRESS',
    currentPhase: state.phase,
    roundNumber: state.roundNumber,
    // `role`/`revealedRole` are genuinely optional here, never force-cast
    // or set to a literal `undefined` — the host/moderator has no role at
    // all (see Player.isHost's doc comment in @mafia/shared/entities.ts)
    // and their player document must be written WITHOUT those keys,
    // matching gamesValidator's `$jsonSchema` in db/schemas.ts (which does
    // NOT list either as required, for exactly this reason). `omitUndefined`
    // drops every key whose value is `undefined` — not just missing keys —
    // because a plain object property EXPLICITLY set to `undefined` still
    // round-trips through the MongoDB driver as a real BSON `null`, which
    // the validator's `{ enum: ROLE_ENUM }` (no `null` in the enum) rejects
    // exactly like a required-but-missing field would. This has already
    // been the cause of two separate production crashes — a caller that
    // never sets the key at all is safe either way, but a caller that
    // builds a role-less player row via `{ ...p, role: undefined }` (as a
    // "clear this field" idiom) is not, unless this boundary defends
    // against it unconditionally, which is what this general helper does
    // instead of special-casing `role` alone as the previous fix did.
    players: state.players.map((p) => omitUndefined(p) as PublicPlayer),
    startedAt: now,
    updatedAt: now,
  };
  const col = await collection();
  await col.insertOne(doc);
  return doc;
}

/** Returns a shallow copy of `obj` with every key whose value is
 * `undefined` removed entirely — see createGame's doc comment on why a
 * present-but-undefined key is not equivalent to an absent one once it
 * reaches the MongoDB driver. */
function omitUndefined<T extends object>(obj: T): Partial<T> {
  const result: Partial<T> = {};
  for (const key of Object.keys(obj) as Array<keyof T>) {
    if (obj[key] !== undefined) result[key] = obj[key];
  }
  return result;
}

/** Persists a phase transition. Called once per phase boundary, not per
 * action within a phase — see the module-level hot-path note. */
export async function recordPhaseTransition(
  gameId: string,
  phase: Phase,
  roundNumber: number,
): Promise<void> {
  const col = await collection();
  await col.updateOne(
    { _id: gameId },
    { $set: { currentPhase: phase, roundNumber, updatedAt: new Date() } },
  );
}

export async function completeGame(
  gameId: string,
  endReason: GameEndReason,
  winningTeam?: string,
): Promise<void> {
  const col = await collection();
  await col.updateOne(
    { _id: gameId },
    {
      $set: {
        status: 'COMPLETED',
        currentPhase: 'GAME_OVER',
        endReason,
        winningTeam,
        endedAt: new Date(),
        updatedAt: new Date(),
      },
    },
  );
}

export async function abandonGame(gameId: string): Promise<void> {
  const col = await collection();
  await col.updateOne(
    { _id: gameId },
    {
      $set: {
        status: 'ABANDONED',
        endReason: 'ABANDONED',
        endedAt: new Date(),
        updatedAt: new Date(),
      },
    },
  );
}

export async function findGameById(gameId: string): Promise<GameDocument | null> {
  const col = await collection();
  return col.findOne({ _id: gameId });
}

/** Game history for a village, most recent first — used for a post-game /
 * rematch-history screen, not gameplay itself. */
export async function findGamesByVillage(villageCode: VillageCode, limit = 20): Promise<GameDocument[]> {
  const col = await collection();
  return col.find({ villageCode }).sort({ startedAt: -1 }).limit(limit).toArray();
}

/** Every game still marked IN_PROGRESS — the exact set a server needs to
 * inspect on boot to decide, per game, whether to resume or abandon it.
 * See realtime/restart.ts. Uses the `by_status` index (collections.ts). */
export async function findInProgressGames(): Promise<GameDocument[]> {
  const col = await collection();
  return col.find({ status: 'IN_PROGRESS' }).toArray();
}

/** Total count of games that reached COMPLETED (a real win condition, not
 * an abandonment) — the `gamesCompleted` figure on GET /metrics. A
 * lifetime counter is intentionally an estimatedDocumentCount-style query
 * (a live `countDocuments` against the `by_status` index) rather than a
 * separately maintained counter: this collection is never large enough
 * for that count to be a hot-path concern, and deriving it from the
 * authoritative status field can't drift out of sync the way a
 * hand-maintained counter could. */
export async function countCompletedGames(): Promise<number> {
  const col = await collection();
  return col.countDocuments({ status: 'COMPLETED' });
}
