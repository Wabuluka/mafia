// ---------------------------------------------------------------------------
// resumeTimer — host-only. Un-freezes a paused phase timer, granting
// exactly the time that remained at the moment of pause (see
// phaseLoop.ts's resumeCurrentPhase) — never a fresh full duration.
// ---------------------------------------------------------------------------

import { ResumeTimerPayloadSchema } from '@mafia/shared';
import type { GameServer, GameSocket } from '../emit';
import { ackError, ackOk, parseOrAck, requireGameSession, requirePlayerInSession, type HandlerAck } from '../handlerContext';
import { resumeCurrentPhase } from '../phaseLoop';

export function registerResumeTimerHandler(io: GameServer, socket: GameSocket): void {
  socket.on('resumeTimer', (payload, ack?: HandlerAck) => {
    const parsed = parseOrAck(ResumeTimerPayloadSchema, payload, ack);
    if (!parsed) return;

    const session = requireGameSession(parsed.villageCode, ack);
    if (!session) return;
    if (!requirePlayerInSession(session, socket.player._id, ack)) return;

    const caller = session.state.players.find((p) => p.id === socket.player._id);
    if (!caller?.isHost) {
      ackError(ack, { code: 'NOT_HOST', message: 'Only the host can resume the timer.' });
      return;
    }

    if (!session.state.phaseTimer || session.state.phaseTimer.pausedAt === undefined) {
      ackError(ack, { code: 'NOT_PAUSED', message: 'The timer is not currently paused.' });
      return;
    }

    resumeCurrentPhase(io, session);
    ackOk(ack);
  });
}
