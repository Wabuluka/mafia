// ---------------------------------------------------------------------------
// revealNarration — host-only. Submits the FINAL narration text for a phase
// that has already resolved (see FullGameState.pendingNarration and
// phaseLoop.ts's module header) and broadcasts it, plus the outcome
// computed at resolution time, to every player. `text` may be the engine's
// own suggested wording unchanged or a full rewrite — the host is the
// game's narrator, and whatever they submit here is exactly what players
// see. Rejected if there's no pendingNarration waiting.
// ---------------------------------------------------------------------------

import { RevealNarrationPayloadSchema } from '@mafia/shared';
import type { GameServer, GameSocket } from '../emit';
import { ackError, ackOk, parseOrAck, requireGameSession, requirePlayerInSession, type HandlerAck } from '../handlerContext';
import { revealPendingNarration } from '../phaseLoop';

export function registerRevealNarrationHandler(io: GameServer, socket: GameSocket): void {
  socket.on('revealNarration', (payload, ack?: HandlerAck) => {
    const parsed = parseOrAck(RevealNarrationPayloadSchema, payload, ack);
    if (!parsed) return;

    const session = requireGameSession(parsed.villageCode, ack);
    if (!session) return;
    if (!requirePlayerInSession(session, socket.player._id, ack)) return;

    const caller = session.state.players.find((p) => p.id === socket.player._id);
    if (!caller?.isHost) {
      ackError(ack, { code: 'NOT_HOST', message: 'Only the host can reveal narration.' });
      return;
    }

    if (!session.state.pendingNarration) {
      ackError(ack, { code: 'NO_PENDING_NARRATION', message: 'There is no pending narration to reveal.' });
      return;
    }

    revealPendingNarration(io, session, parsed.text);
    ackOk(ack);
  });
}
