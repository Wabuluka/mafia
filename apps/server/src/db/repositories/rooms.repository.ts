// ---------------------------------------------------------------------------
// Typed repository for the `rooms` collection. No code outside this file
// should touch `db.collection('rooms')` directly — see index.ts for why.
// ---------------------------------------------------------------------------

import type { PlayerId, RoomCode } from '@mafia/shared';
import { getDb } from '../connection';
import { COLLECTIONS } from '../collections';
import type { RoomDocument } from '../types';

function collection() {
  return getDb().then((db) => db.collection<RoomDocument>(COLLECTIONS.rooms));
}

export interface CreateRoomInput {
  code: RoomCode;
  hostId: PlayerId;
  maxPlayers: number;
  minPlayers: number;
}

/** Creates a new lobby. Throws (via the unique index) if the code collides
 * with an existing live room — callers should regenerate and retry. */
export async function createRoom(input: CreateRoomInput): Promise<RoomDocument> {
  const now = new Date();
  const doc: RoomDocument = {
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

export async function findRoomByCode(code: RoomCode): Promise<RoomDocument | null> {
  const col = await collection();
  return col.findOne({ _id: code });
}

/** Adds a player to the roster and refreshes the TTL clock. */
export async function addPlayerToRoom(code: RoomCode, playerId: PlayerId): Promise<void> {
  const col = await collection();
  await col.updateOne(
    { _id: code },
    { $addToSet: { playerIds: playerId }, $set: { lastActivityAt: new Date() } },
  );
}

export async function removePlayerFromRoom(code: RoomCode, playerId: PlayerId): Promise<void> {
  const col = await collection();
  await col.updateOne(
    { _id: code },
    { $pull: { playerIds: playerId }, $set: { lastActivityAt: new Date() } },
  );
}

/** Bumps `lastActivityAt` without any other change — call on any lobby
 * activity (ready toggle, chat, etc.) to keep the TTL from expiring a
 * still-live room. Deliberately cheap: a single indexed point update. */
export async function touchRoomActivity(code: RoomCode): Promise<void> {
  const col = await collection();
  await col.updateOne({ _id: code }, { $set: { lastActivityAt: new Date() } });
}

export async function setRoomStatus(
  code: RoomCode,
  status: RoomDocument['status'],
): Promise<void> {
  const col = await collection();
  await col.updateOne(
    { _id: code },
    { $set: { status, lastActivityAt: new Date() } },
  );
}

/** Updates the room's recorded host — called on host transfer (the
 * previous host left/disconnected in the lobby and the longest-connected
 * remaining player inherited it; see realtime/lobbyManagement.ts). Kept in
 * sync so any future read of `RoomDocument.hostId` (host-only HTTP
 * endpoints, admin tooling) reflects reality rather than the room's
 * original creator forever. */
export async function setHost(code: RoomCode, hostId: PlayerId): Promise<void> {
  const col = await collection();
  await col.updateOne(
    { _id: code },
    { $set: { hostId, lastActivityAt: new Date() } },
  );
}

/** Deletes a room explicitly (e.g. on host-initiated close). Abandoned rooms
 * don't need this — the TTL index reaps them automatically. */
export async function deleteRoom(code: RoomCode): Promise<void> {
  const col = await collection();
  await col.deleteOne({ _id: code });
}
