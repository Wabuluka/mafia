// ---------------------------------------------------------------------------
// pauseTimer — host-only. Freezes the current phase's countdown so the
// host (the game's designated moderator/narrator — see the module header
// in realtime/index.ts's cheat-vector list, item 20) can hold the game for
// a real-world interruption, a ruling, or simply to talk without the timer
// running out from under the table. See phaseLoop.ts's pauseCurrentPhase
// for the actual freeze mechanics.
// ---------------------------------------------------------------------------

import { PauseTimerPayloadSchema } from '@mafia/shared';
import type { GameServer, GameSocket } from '../emit';
import { ackError, ackOk, parseOrAck, requireGameSession, requirePlayerInSession, type HandlerAck } from '../handlerContext';
import { pauseCurrentPhase } from '../phaseLoop';

export function registerPauseTimerHandler(io: GameServer, socket: GameSocket): void {
  socket.on('pauseTimer', (payload, ack?: HandlerAck) => {
    const parsed = parseOrAck(PauseTimerPayloadSchema, payload, ack);
    if (!parsed) return;

    const session = requireGameSession(parsed.villageCode, ack);
    if (!session) return;
    if (!requirePlayerInSession(session, socket.player._id, ack)) return;

    const caller = session.state.players.find((p) => p.id === socket.player._id);
    if (!caller?.isHost) {
      ackError(ack, { code: 'NOT_HOST', message: 'Only the host can pause the timer.' });
      return;
    }

    if (!session.state.phaseTimer) {
      ackError(ack, { code: 'INVALID_PHASE', message: 'There is no running timer to pause.' });
      return;
    }

    if (session.state.phaseTimer.pausedAt !== undefined) {
      ackError(ack, { code: 'ALREADY_PAUSED', message: 'The timer is already paused.' });
      return;
    }

    pauseCurrentPhase(io, session);
    ackOk(ack);
  });
}
