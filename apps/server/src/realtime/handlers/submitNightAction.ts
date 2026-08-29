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
import { villageManager } from '../VillageManager';

/** Maps an engine rejection reason to the closest ErrorPayload code the
 * shared wire contract defines. Not a 1:1 mapping — the engine has a
 * richer vocabulary (PLAYER_DEAD, TARGET_DEAD, WRONG_ROLE, ...) than the
 * wire error codes bother to distinguish; the human-readable `message`
 * carries the specific reason, the `code` just buckets it for client
 * branching logic. */
function toErrorCode(
  reason: string,
): 'INVALID_PHASE' | 'INVALID_TARGET' | 'ALREADY_ACTED' | 'WRONG_SUB_PHASE' | 'NOT_IN_GAME' {
  switch (reason) {
    case 'WRONG_PHASE':
      return 'INVALID_PHASE';
    case 'ALREADY_ACTED':
      return 'ALREADY_ACTED';
    case 'WRONG_SUB_PHASE':
      return 'WRONG_SUB_PHASE';
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
    // must not double-apply. We key on (actor, round, target) rather than
    // trusting a client-supplied id at all — a network retry resends the
    // identical target and correctly collapses to the same key, while a
    // genuinely different resubmission (a mafia member revising their kill
    // target mid-deliberation — see engine/nightActions.ts's revocable-
    // MAFIA-submission comment) has a different target and is therefore
    // NOT mistaken for a retry. DETECTIVE/DOCTOR remain single-shot per
    // round regardless of target, enforced by the engine's own
    // ALREADY_ACTED check, so including the target in their key is
    // harmless (they'll never legitimately submit a second, different one).
    const idempotencyKey = `night:${socket.player._id}:${session.state.roundNumber}:${parsed.targetId ?? 'none'}`;
    if (isDuplicateAction(session, idempotencyKey)) {
      // Not an error — re-send current state so the client's retry still
      // resolves to a consistent view rather than silently hanging.
      emitStateToPlayer(io, session, socket.player._id);
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
    emitStateToPlayer(io, session, socket.player._id);
    ackOk(ack);

    // Unlike the old simultaneous-submission model, a night action landing
    // here never advances `nightSubPhase` or triggers resolution by
    // itself — under the moderator-driven flow (see @mafia/shared's
    // NightSubPhaseSchema) that only happens via the host's explicit
    // `advanceNightSubPhase` action. The scheduled phase deadline remains
    // the fallback that force-resolves NIGHT regardless, if the host never
    // gets there.
  });
}
