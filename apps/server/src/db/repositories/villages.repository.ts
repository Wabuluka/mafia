// ---------------------------------------------------------------------------
// Typed repository for the `villages` collection. No code outside this file
// should touch `db.collection('villages')` directly — see index.ts for why.
// ---------------------------------------------------------------------------

import type { PlayerId, VillageCode } from '@mafia/shared';
import { getDb } from '../connection';
import { COLLECTIONS } from '../collections';
import type { VillageDocument } from '../types';

function collection() {
  return getDb().then((db) => db.collection<VillageDocument>(COLLECTIONS.villages));
}

export interface CreateVillageInput {
  code: VillageCode;
  name: string;
  hostId: PlayerId;
  maxPlayers: number;
  minPlayers: number;
}

/** Creates a new lobby. Throws (via the unique index) if the code collides
 * with an existing live village — callers should regenerate and retry. */
export async function createVillage(input: CreateVillageInput): Promise<VillageDocument> {
  const now = new Date();
  const doc: VillageDocument = {
    _id: input.code,
    name: input.name,
    hostId: input.hostId,
    maxPlayers: input.maxPlayers,
    minPlayers: input.minPlayers,
    playerIds: [input.hostId],
    pendingPlayerIds: [],
    status: 'LOBBY',
    createdAt: now,
    lastActivityAt: now,
  };
  const col = await collection();
  await col.insertOne(doc);
  return doc;
}

export async function findVillageByCode(code: VillageCode): Promise<VillageDocument | null> {
  const col = await collection();
  return col.findOne({ _id: code });
}

/** Adds a player to the roster and refreshes the TTL clock. */
export async function addPlayerToVillage(code: VillageCode, playerId: PlayerId): Promise<void> {
  const col = await collection();
  await col.updateOne(
    { _id: code },
    { $addToSet: { playerIds: playerId }, $set: { lastActivityAt: new Date() } },
  );
}

export async function removePlayerFromVillage(code: VillageCode, playerId: PlayerId): Promise<void> {
  const col = await collection();
  await col.updateOne(
    { _id: code },
    { $pull: { playerIds: playerId }, $set: { lastActivityAt: new Date() } },
  );
}

/** Adds a NEW player to the pending (awaiting host approval) list —
 * distinct from `addPlayerToVillage`, which admits straight into the live
 * roster. See VillageDocument.pendingPlayerIds's own doc comment. */
export async function addPendingPlayer(code: VillageCode, playerId: PlayerId): Promise<void> {
  const col = await collection();
  await col.updateOne(
    { _id: code },
    { $addToSet: { pendingPlayerIds: playerId }, $set: { lastActivityAt: new Date() } },
  );
}

/** Removes a player from the pending list without admitting them — a deny,
 * or cleanup if they disconnect/the village closes before the host
 * responds. No-op if they were never pending. */
export async function removePendingPlayer(code: VillageCode, playerId: PlayerId): Promise<void> {
  const col = await collection();
  await col.updateOne(
    { _id: code },
    { $pull: { pendingPlayerIds: playerId }, $set: { lastActivityAt: new Date() } },
  );
}

/** Accepts a pending player: atomically moves them from `pendingPlayerIds`
 * into `playerIds` in one write, so a concurrent read of the document can
 * never observe them in neither list nor both. Returns the updated
 * document so the caller (respondToJoinRequest.ts) has the fresh
 * maxPlayers/playerIds without a second round trip — capacity is checked
 * by the caller BEFORE calling this, but the fresh count is still useful
 * for the broadcast that follows. */
export async function promotePendingPlayer(code: VillageCode, playerId: PlayerId): Promise<VillageDocument | null> {
  const col = await collection();
  const result = await col.findOneAndUpdate(
    { _id: code },
    {
      $pull: { pendingPlayerIds: playerId },
      $addToSet: { playerIds: playerId },
      $set: { lastActivityAt: new Date() },
    },
    { returnDocument: 'after' },
  );
  return result;
}

/** Bumps `lastActivityAt` without any other change — call on any lobby
 * activity (ready toggle, chat, etc.) to keep the TTL from expiring a
 * still-live village. Deliberately cheap: a single indexed point update. */
export async function touchVillageActivity(code: VillageCode): Promise<void> {
  const col = await collection();
  await col.updateOne({ _id: code }, { $set: { lastActivityAt: new Date() } });
}

export async function setVillageStatus(
  code: VillageCode,
  status: VillageDocument['status'],
): Promise<void> {
  const col = await collection();
  await col.updateOne(
    { _id: code },
    { $set: { status, lastActivityAt: new Date() } },
  );
}

/** Updates the village's recorded host — called on host transfer (the
 * previous host left/disconnected in the lobby and the longest-connected
 * remaining player inherited it; see realtime/lobbyManagement.ts). Kept in
 * sync so any future read of `VillageDocument.hostId` (host-only HTTP
 * endpoints, admin tooling) reflects reality rather than the village's
 * original creator forever. */
export async function setHost(code: VillageCode, hostId: PlayerId): Promise<void> {
  const col = await collection();
  await col.updateOne(
    { _id: code },
    { $set: { hostId, lastActivityAt: new Date() } },
  );
}

/** Deletes a village explicitly (e.g. on host-initiated close). Abandoned villages
 * don't need this — the TTL index reaps them automatically. */
export async function deleteVillage(code: VillageCode): Promise<void> {
  const col = await collection();
  await col.deleteOne({ _id: code });
}
