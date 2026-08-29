// ---------------------------------------------------------------------------
// endPhaseNow — host-only. Forces the current phase to resolve immediately,
// regardless of the timer or whether every required action is in — the
// same `advancePhase` a normal deadline/early-resolution would trigger,
// just invoked directly by the host (e.g. DAY_DISCUSSION has no
// early-resolution path of its own, since there's nothing players submit
// during it; this is the host's only way to end discussion early). Works
// whether the timer is running, paused, or hasn't been started at all this
// phase — the host may also want to skip a phase's countdown entirely.
// ---------------------------------------------------------------------------

import { EndPhaseNowPayloadSchema } from '@mafia/shared';
import type { GameServer, GameSocket } from '../emit';
import { ackError, ackOk, parseOrAck, requireGameSession, requirePlayerInSession, type HandlerAck } from '../handlerContext';
import { advancePhase } from '../phaseLoop';

export function registerEndPhaseNowHandler(io: GameServer, socket: GameSocket): void {
  socket.on('endPhaseNow', async (payload, ack?: HandlerAck) => {
    const parsed = parseOrAck(EndPhaseNowPayloadSchema, payload, ack);
    if (!parsed) return;

    const session = requireGameSession(parsed.villageCode, ack);
    if (!session) return;
    if (!requirePlayerInSession(session, socket.player._id, ack)) return;

    const caller = session.state.players.find((p) => p.id === socket.player._id);
    if (!caller?.isHost) {
      ackError(ack, { code: 'NOT_HOST', message: 'Only the host can end the phase early.' });
      return;
    }

    if (session.state.phase === 'LOBBY' || session.state.phase === 'GAME_OVER') {
      ackError(ack, { code: 'INVALID_PHASE', message: 'This phase cannot be ended early.' });
      return;
    }

    if (session.state.pendingNarration) {
      ackError(ack, {
        code: 'NARRATION_NOT_REVEALED',
        message: 'Reveal the narration for what just happened before ending the next phase.',
      });
      return;
    }

    await advancePhase(io, session);
    ackOk(ack);
  });
}
