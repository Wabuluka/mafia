// ---------------------------------------------------------------------------
// Typed repository for the `players` collection. No code outside this file
// should touch `db.collection('players')` directly.
//
// Players here are anonymous: keyed by an opaque session token stored in a
// browser cookie/localStorage, not an account with credentials. There is no
// email, password, or other PII field — see schemas.ts's validator, which
// enforces the same shape at the DB level.
// ---------------------------------------------------------------------------

import { randomUUID } from 'node:crypto';
import type { PlayerId } from '@mafia/shared';
import { getDb } from '../connection';
import { COLLECTIONS } from '../collections';
import type { PlayerDocument } from '../types';

function collection() {
  return getDb().then((db) => db.collection<PlayerDocument>(COLLECTIONS.players));
}

/** Creates a new anonymous identity for a fresh session token. */
export async function createPlayer(sessionToken: string, displayName: string): Promise<PlayerDocument> {
  const now = new Date();
  const doc: PlayerDocument = {
    _id: randomUUID() as PlayerId,
    sessionToken,
    displayName,
    createdAt: now,
    lastSeenAt: now,
  };
  const col = await collection();
  await col.insertOne(doc);
  return doc;
}

/** Resolves a reconnecting browser's session token back to its identity. */
export async function findPlayerBySessionToken(sessionToken: string): Promise<PlayerDocument | null> {
  const col = await collection();
  return col.findOne({ sessionToken });
}

export async function findPlayerById(id: PlayerId): Promise<PlayerDocument | null> {
  const col = await collection();
  return col.findOne({ _id: id });
}

/** Call on reconnect/activity so `lastSeenAt` reflects real presence. Not
 * tied to any TTL today, but keeps the data honest for future cleanup jobs
 * or analytics without needing a backfill. */
export async function touchPlayerLastSeen(id: PlayerId): Promise<void> {
  const col = await collection();
  await col.updateOne({ _id: id }, { $set: { lastSeenAt: new Date() } });
}

export async function updatePlayerDisplayName(id: PlayerId, displayName: string): Promise<void> {
  const col = await collection();
  await col.updateOne({ _id: id }, { $set: { displayName, lastSeenAt: new Date() } });
}
