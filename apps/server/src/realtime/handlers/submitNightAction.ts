// ---------------------------------------------------------------------------
// submitNightAction — validate -> pure engine call -> record pending event
// -> broadcast redacted state. Never touches Mongo directly (see the
// hot-path boundary comment in db/index.ts) — the event this action
// produces is only flushed at the next phase boundary, via
// session.pendingEvents.
// ---------------------------------------------------------------------------

import { randomUUID } from 'node:crypto';
import { SubmitNightActionPayloadSchema } from '@mafia/shared';
import { applyNightAction } from '../../engine';
import { emitStateToPlayer, type GameServer, type GameSocket } from '../emit';
import { ackError, ackOk, parseOrAck, requireGameSession, requirePlayerInSession, type HandlerAck } from '../handlerContext';
import { isDuplicateAction } from '../idempotency';
import { tryResolveEarly } from '../phaseLoop';
import { villageManager } from '../VillageManager';

/** Maps an engine rejection reason to the closest ErrorPayload code the
 * shared wire contract defines. Not a 1:1 mapping — the engine has a
 * richer vocabulary (PLAYER_DEAD, TARGET_DEAD, WRONG_ROLE, ...) than the
 * wire error codes bother to distinguish; the human-readable `message`
 * carries the specific reason, the `code` just buckets it for client
 * branching logic. */
function toErrorCode(reason: string): 'INVALID_PHASE' | 'INVALID_TARGET' | 'ALREADY_ACTED' | 'NOT_IN_GAME' {
  switch (reason) {
    case 'WRONG_PHASE':
      return 'INVALID_PHASE';
    case 'ALREADY_ACTED':
      return 'ALREADY_ACTED';
    case 'INVALID_TARGET':
    case 'TARGET_DEAD':
      return 'INVALID_TARGET';
    default:
      return 'NOT_IN_GAME';
  }
}

export function registerSubmitNightActionHandler(io: GameServer, socket: GameSocket): void {
  socket.on('submitNightAction', (payload, ack?: HandlerAck) => {
    const parsed = parseOrAck(SubmitNightActionPayloadSchema, payload, ack);
    if (!parsed) return;

    const session = requireGameSession(parsed.villageCode, ack);
    if (!session) return;
    if (!requirePlayerInSession(session, socket.player._id, ack)) return;

    // Idempotency: a flaky connection retrying the same logical submission
    // must not double-apply. The client is expected to generate a stable
    // id per logical action (e.g. derived from villageCode+phase+round) and
    // resend the identical id on retry; we key on (actor, phase, round)
    // rather than trusting a client-supplied id at all, which is stronger
    // — it makes a *second distinct* submission from the same actor in the
    // same phase collapse to the same idempotency key as a retried one,
    // both correctly deduped by the engine's own ALREADY_ACTED check.
    const idempotencyKey = `night:${socket.player._id}:${session.state.roundNumber}`;
    if (isDuplicateAction(session, idempotencyKey)) {
      // Not an error — re-send current state so the client's retry still
      // resolves to a consistent view rather than silently hanging.
      emitStateToPlayer(io, session.state, socket.player._id);
      ackOk(ack);
      return;
    }

    const result = applyNightAction(session.state, {
      actorId: socket.player._id,
      targetId: parsed.targetId,
      actionId: randomUUID(),
      now: Date.now(),
    });

    if (!result.ok) {
      ackError(ack, { code: toErrorCode(result.reason), message: result.message });
      return;
    }

    session.state = result.value;
    villageManager.setState(session.villageCode, session.state);

    const recordedAction = session.state.nightActions.at(-1);
    if (recordedAction) {
      session.pendingEvents.push({
        gameId: session.gameId ?? 'unknown',
        type: 'NIGHT_ACTION',
        payload: { action: recordedAction },
      });
    }

    // Night actions are secret — only the actor's own view needs to
    // reflect `hasActedThisPhase` flipping to true. Broadcasting to
    // everyone would be harmless (redactStateFor still hides the target),
    // but is needless traffic for information nobody else can act on.
    emitStateToPlayer(io, session.state, socket.player._id);
    ackOk(ack);

    // Skip the remaining wait if every living night-acting role has now
    // submitted — see earlyResolution.ts. A no-op if not everyone's in
    // yet; the scheduled deadline remains the fallback either way.
    tryResolveEarly(io, session);
  });
}
