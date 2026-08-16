// ---------------------------------------------------------------------------
// castVote — validate -> pure engine call -> record pending event ->
// broadcast redacted state. Unlike a night action, a vote's target is
// public information (the point of a day vote is deliberation), so the
// resulting state is broadcast to the whole room, not just the voter.
// ---------------------------------------------------------------------------

import { CastVotePayloadSchema } from '@mafia/shared';
import { ABSTAIN, castVote } from '../../engine';
import { broadcastStateToRoom, type GameServer, type GameSocket } from '../emit';
import { ackError, ackOk, parseOrAck, requireGameSession, requirePlayerInSession, type HandlerAck } from '../handlerContext';
import { isDuplicateAction } from '../idempotency';
import { tryResolveEarly } from '../phaseLoop';
import { roomManager } from '../RoomManager';

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

export function registerCastVoteHandler(io: GameServer, socket: GameSocket): void {
  socket.on('castVote', (payload, ack?: HandlerAck) => {
    const parsed = parseOrAck(CastVotePayloadSchema, payload, ack);
    if (!parsed) return;

    const session = requireGameSession(parsed.roomCode, ack);
    if (!session) return;
    if (!requirePlayerInSession(session, socket.player._id, ack)) return;

    // Unlike a night action, a vote is naturally revocable — castVote
    // (see engine/voting.ts) replaces the voter's prior vote for the
    // round rather than rejecting a second submission. That means a
    // logical "change my vote" is legitimately a second, different call,
    // not a retry, so the idempotency key includes the target: two calls
    // with the SAME target in the same round dedupe (a flaky-connection
    // retry), but a genuine vote change is never mistaken for one.
    const targetKey = parsed.targetId ?? 'ABSTAIN';
    const idempotencyKey = `vote:${socket.player._id}:${session.state.roundNumber}:${targetKey}`;
    if (isDuplicateAction(session, idempotencyKey)) {
      broadcastStateToRoom(io, session.state);
      ackOk(ack);
      return;
    }

    const result = castVote(session.state, {
      voterId: socket.player._id,
      target: parsed.targetId ?? ABSTAIN,
      now: Date.now(),
    });

    if (!result.ok) {
      ackError(ack, { code: toErrorCode(result.reason), message: result.message });
      return;
    }

    session.state = result.value;
    roomManager.setState(session.roomCode, session.state);

    const recordedVote = session.state.votes.find(
      (v) => v.voterId === socket.player._id && v.dayNumber === session.state.roundNumber,
    );
    if (recordedVote) {
      session.pendingEvents.push({
        gameId: session.gameId ?? 'unknown',
        type: 'VOTE',
        payload: { vote: recordedVote },
      });
    }

    broadcastStateToRoom(io, session.state);
    ackOk(ack);

    // Skip the remaining wait if every living player has now voted (or
    // abstained) — see earlyResolution.ts.
    tryResolveEarly(io, session);
  });
}
