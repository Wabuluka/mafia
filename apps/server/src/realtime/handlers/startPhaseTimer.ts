// ---------------------------------------------------------------------------
// startPhaseTimer — host-only. Begins the countdown for the phase the game
// is CURRENTLY sitting in, once the host is ready — see phaseLoop.ts's
// module header for the full human-moderator model this is one third of
// (the other two are endPhaseNow and revealNarration). Rejected if a timer
// is already running/paused (nothing to start), or while a
// `pendingNarration` is still awaiting reveal (the players haven't even
// been told what just happened — starting a new countdown before that
// would race the narration itself).
// ---------------------------------------------------------------------------

import { StartPhaseTimerPayloadSchema } from '@mafia/shared';
import type { GameServer, GameSocket } from '../emit';
import { ackError, ackOk, parseOrAck, requireGameSession, requirePlayerInSession, type HandlerAck } from '../handlerContext';
import { startCurrentPhase } from '../phaseLoop';

export function registerStartPhaseTimerHandler(io: GameServer, socket: GameSocket): void {
  socket.on('startPhaseTimer', (payload, ack?: HandlerAck) => {
    const parsed = parseOrAck(StartPhaseTimerPayloadSchema, payload, ack);
    if (!parsed) return;

    const session = requireGameSession(parsed.villageCode, ack);
    if (!session) return;
    if (!requirePlayerInSession(session, socket.player._id, ack)) return;

    const caller = session.state.players.find((p) => p.id === socket.player._id);
    if (!caller?.isHost) {
      ackError(ack, { code: 'NOT_HOST', message: 'Only the host can start the phase timer.' });
      return;
    }

    if (session.state.phase === 'LOBBY' || session.state.phase === 'GAME_OVER') {
      ackError(ack, { code: 'INVALID_PHASE', message: 'This phase does not run on a timer.' });
      return;
    }

    if (session.state.pendingNarration) {
      ackError(ack, {
        code: 'NARRATION_NOT_REVEALED',
        message: 'Reveal the narration for what just happened before starting the next timer.',
      });
      return;
    }

    if (session.state.phaseTimer) {
      ackError(ack, { code: 'TIMER_ALREADY_RUNNING', message: 'The phase timer is already running.' });
      return;
    }

    startCurrentPhase(io, session);
    ackOk(ack);
  });
}
