// ---------------------------------------------------------------------------
// submitNomination — validate -> pure engine call -> record pending event ->
// broadcast the diff. Mirrors castVote.ts closely: a nomination's target is
// public information (the point of DAY_DISCUSSION under the nomination
// model is public suspicion, same as a vote), so the resulting state is
// broadcast to the whole village, not just the nominator.
// ---------------------------------------------------------------------------

import { SubmitNominationPayloadSchema } from '@mafia/shared';
import { DECLINE, nominate } from '../../engine';
import { broadcastNominationChange, type GameServer, type GameSocket } from '../emit';
import { ackError, ackOk, parseOrAck, requireGameSession, requirePlayerInSession, type HandlerAck } from '../handlerContext';
import { isDuplicateAction } from '../idempotency';
import { tryResolveEarly } from '../phaseLoop';
import { villageManager } from '../VillageManager';

function toErrorCode(reason: string): 'INVALID_PHASE' | 'INVALID_TARGET' | 'NOT_IN_GAME' {
  switch (reason) {
    case 'WRONG_PHASE':
      return 'INVALID_PHASE';
    case 'INVALID_TARGET':
    case 'TARGET_DEAD':
      return 'INVALID_TARGET';
    default:
      return 'NOT_IN_GAME';
  }
}

export function registerSubmitNominationHandler(io: GameServer, socket: GameSocket): void {
  socket.on('submitNomination', (payload, ack?: HandlerAck) => {
    const parsed = parseOrAck(SubmitNominationPayloadSchema, payload, ack);
    if (!parsed) return;

    const session = requireGameSession(parsed.villageCode, ack);
    if (!session) return;
    if (!requirePlayerInSession(session, socket.player._id, ack)) return;

    // Same idempotency shape as castVote.ts: a nomination is revocable, so
    // the target is part of the key — a retried request with the SAME
    // target dedupes, but a genuine change of mind (different target) is
    // never mistaken for one.
    const targetKey = parsed.targetId ?? 'DECLINE';
    const idempotencyKey = `nomination:${socket.player._id}:${session.state.roundNumber}:${targetKey}`;
    if (isDuplicateAction(session, idempotencyKey)) {
      broadcastNominationChange(io, session);
      ackOk(ack);
      return;
    }

    const result = nominate(session.state, {
      nominatorId: socket.player._id,
      target: parsed.targetId ?? DECLINE,
      now: Date.now(),
    });

    if (!result.ok) {
      ackError(ack, { code: toErrorCode(result.reason), message: result.message });
      return;
    }

    session.state = result.value;
    villageManager.setState(session.villageCode, session.state);

    const recordedNomination = session.state.nominations.find(
      (n) => n.nominatorId === socket.player._id && n.dayNumber === session.state.roundNumber,
    );
    if (recordedNomination) {
      session.pendingEvents.push({
        gameId: session.gameId ?? 'unknown',
        type: 'NOMINATION',
        payload: { nomination: recordedNomination },
      });
    }

    broadcastNominationChange(io, session);
    ackOk(ack);

    // Skip the remaining wait if every living player has now nominated (or
    // declined) — see earlyResolution.ts's isNominationResolutionReady.
    tryResolveEarly(io, session);
  });
}
