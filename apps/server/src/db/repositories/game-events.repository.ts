// ---------------------------------------------------------------------------
// Typed repository for the `gameEvents` collection — an append-only log.
// No code outside this file should touch `db.collection('gameEvents')`
// directly, and nothing in this file ever updates or deletes a document:
// only `insertOne`/`insertMany` and reads.
//
// Reminder (see index.ts): events are batched and flushed at phase
// boundaries / game end from the in-memory engine's action log, not written
// synchronously on every player click. `appendEvents` accepts a batch for
// exactly this reason — prefer it over calling `appendEvent` in a loop.
// ---------------------------------------------------------------------------

import { randomUUID } from 'node:crypto';
import { getDb } from '../connection';
import { COLLECTIONS } from '../collections';
import type { GameEventDocument } from '../types';

function collection() {
  return getDb().then((db) => db.collection<GameEventDocument>(COLLECTIONS.gameEvents));
}

/** In-memory per-game sequence counters. This is a cache seeded from Mongo,
 * not a substitute for the unique (gameId, sequence) index — that index is
 * what actually guarantees no two events for a game ever collide, even
 * across multiple server instances or a counter reset on restart. */
const sequenceCounters = new Map<string, number>();

async function nextSequence(gameId: string): Promise<number> {
  const cached = sequenceCounters.get(gameId);
  if (cached !== undefined) {
    const next = cached + 1;
    sequenceCounters.set(gameId, next);
    return next;
  }
  const col = await collection();
  const last = await col.find({ gameId }).sort({ sequence: -1 }).limit(1).next();
  const next = (last?.sequence ?? -1) + 1;
  sequenceCounters.set(gameId, next);
  return next;
}

type NewEvent = Omit<GameEventDocument, '_id' | 'sequence' | 'createdAt'>;

/** Appends a single event. Prefer `appendEvents` for a batch flush. */
export async function appendEvent(event: NewEvent): Promise<GameEventDocument> {
  const [doc] = await appendEvents([event]);
  if (!doc) {
    throw new Error('appendEvent: insert did not return a document');
  }
  return doc;
}

/** Appends a batch of events for one game in the given order, assigning
 * strictly increasing sequence numbers. This is the normal write path: the
 * in-memory engine accumulates events during a phase and flushes the batch
 * once, at the phase boundary. */
export async function appendEvents(events: NewEvent[]): Promise<GameEventDocument[]> {
  if (events.length === 0) return [];

  const col = await collection();
  const now = new Date();
  const docs: GameEventDocument[] = [];
  for (const event of events) {
    const sequence = await nextSequence(event.gameId);
    docs.push({ ...event, _id: randomUUID(), sequence, createdAt: now } as GameEventDocument);
  }

  await col.insertMany(docs, { ordered: true });
  return docs;
}

/** Fetches the full ordered event log for a game — the exact query the
 * `by_game_in_order` compound index exists for. Used for replay/dispute
 * resolution, not during live gameplay. */
export async function findEventsForGame(gameId: string): Promise<GameEventDocument[]> {
  const col = await collection();
  return col.find({ gameId }).sort({ sequence: 1 }).toArray();
}

/** Fetches events after a given sequence number — for incremental resync
 * rather than a full replay. */
export async function findEventsSince(gameId: string, afterSequence: number): Promise<GameEventDocument[]> {
  const col = await collection();
  return col
    .find({ gameId, sequence: { $gt: afterSequence } })
    .sort({ sequence: 1 })
    .toArray();
}

/** Clears the in-memory sequence cache for a completed game. Call once a
 * game ends so the Map doesn't grow unbounded across a long-lived process. */
export function forgetSequenceCounter(gameId: string): void {
  sequenceCounters.delete(gameId);
}
