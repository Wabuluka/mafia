// ---------------------------------------------------------------------------
// Typed repository for the `games` collection. No code outside this file
// should touch `db.collection('games')` directly.
//
// Reminder (see index.ts): these functions are called at phase boundaries
// and on game end — never once per player action. The in-memory game engine
// is the source of truth while a game is running.
// ---------------------------------------------------------------------------

import { randomUUID } from 'node:crypto';
import type { FullGameState, GameEndReason, Phase, PublicPlayer, Role, VillageCode } from '@mafia/shared';
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
    players: state.players.map((p) => ({
      ...(stripRole(p) as PublicPlayer),
      role: p.role as Role,
    })),
    startedAt: now,
    updatedAt: now,
  };
  const col = await collection();
  await col.insertOne(doc);
  return doc;
}

function stripRole<T extends { role?: unknown }>(p: T): Omit<T, 'role'> {
  const rest: Partial<T> = { ...p };
  delete rest.role;
  return rest as Omit<T, 'role'>;
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
