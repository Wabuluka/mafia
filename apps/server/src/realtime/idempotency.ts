// ---------------------------------------------------------------------------
// Idempotency for client-submitted actions. A flaky connection can cause a
// client to retry an ack-less emit (or the client library itself buffers
// and replays on reconnect) — without a dedupe layer, that would double-
// submit a night action or a vote. Every mutating client event that isn't
// naturally idempotent (setReady with an explicit boolean IS idempotent by
// construction; submitNightAction/castVote are not, without help) carries
// a client-generated `actionId`.
// ---------------------------------------------------------------------------

import type { GameSession } from './RoomManager';

/** A cap on the dedupe set's size — without this, a misbehaving or hostile
 * client sending a firehose of unique actionIds could grow this set
 * unbounded for the lifetime of a session. In practice a session (one
 * lobby + one game) never legitimately produces more than a few hundred
 * actions; anything approaching this cap is already being rejected
 * elsewhere by phase/role/already-acted rules, so evicting the oldest
 * entries here is a safety net, not a functional requirement. */
const MAX_TRACKED_ACTION_IDS = 5_000;

/**
 * Returns true if `actionId` has already been processed for this session
 * — the caller should skip re-applying the action and just re-send the
 * current state (so a legitimately-retried request still gets an ack-
 * equivalent response) — and false the first time it's seen, in which
 * case it's recorded before returning.
 */
export function isDuplicateAction(session: GameSession, actionId: string): boolean {
  if (session.seenActionIds.has(actionId)) {
    return true;
  }
  if (session.seenActionIds.size >= MAX_TRACKED_ACTION_IDS) {
    // Evict an arbitrary (insertion-order-oldest, per Set semantics) entry
    // rather than letting the set grow forever. This is a defensive cap,
    // not a sliding window — see the doc comment above.
    const oldest = session.seenActionIds.values().next().value;
    if (oldest !== undefined) {
      session.seenActionIds.delete(oldest);
    }
  }
  session.seenActionIds.add(actionId);
  return false;
}
