// ---------------------------------------------------------------------------
// castVote — validate -> pure engine call -> record pending event ->
// broadcast redacted state. Unlike a night action, a vote's target is
// public information (the point of a day vote is deliberation), so the
// resulting state is broadcast to the whole village, not just the voter.
// ---------------------------------------------------------------------------

import { CastVotePayloadSchema } from '@mafia/shared';
import { ABSTAIN, castVote } from '../../engine';
import { broadcastVoteChange, type GameServer, type GameSocket } from '../emit';
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

export function registerCastVoteHandler(io: GameServer, socket: GameSocket): void {
  socket.on('castVote', (payload, ack?: HandlerAck) => {
    const parsed = parseOrAck(CastVotePayloadSchema, payload, ack);
    if (!parsed) return;

    const session = requireGameSession(parsed.villageCode, ack);
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
      // A retried request still gets an ack-equivalent response — see
      // submitNightAction.ts's identical comment — but as the cheap diff,
      // not a full state resend, matching the normal path below.
      broadcastVoteChange(io, session);
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
    villageManager.setState(session.villageCode, session.state);

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

    // The high-frequency diff path (see broadcastVoteChange's doc comment
    // and VoteChangedPayloadSchema in @mafia/shared/events.ts for the
    // measured payload-size numbers this replaces): a full
    // broadcastStateToVillage here would re-serialize and re-send every
    // player's entire redacted view — including the full chat log, which
    // measured ~78% of a realistic mid-game payload's bytes — for every
    // single vote cast or changed, even though a vote only ever changes
    // `view.votes`. The voter's own `you.hasActedThisPhase` isn't
    // recomputed by this diff, but nothing in the vote UI reads it (see
    // VotingPhase.tsx, which derives "have I voted" from `view.votes`
    // directly) — the field does still get corrected at the next full
    // resync point (phase change, or an explicit requestResync), so
    // nothing ever permanently drifts.
    broadcastVoteChange(io, session);
    ackOk(ack);

    // Skip the remaining wait if every living player has now voted (or
    // abstained) — see earlyResolution.ts.
    tryResolveEarly(io, session);
  });
}
