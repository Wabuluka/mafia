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
    hostId: input.hostId,
    maxPlayers: input.maxPlayers,
    minPlayers: input.minPlayers,
    playerIds: [input.hostId],
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
