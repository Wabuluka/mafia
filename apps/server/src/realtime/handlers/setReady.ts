// ---------------------------------------------------------------------------
// setReady — lobby-only readiness toggle. Naturally idempotent (it's a
// last-write-wins boolean set, not an append), so it doesn't need the
// actionId dedupe machinery submitNightAction/castVote rely on.
// ---------------------------------------------------------------------------

import { SetReadyPayloadSchema } from '@mafia/shared';
import { villagesRepository } from '../../db';
import { broadcastStateToVillage, type GameServer, type GameSocket } from '../emit';
import { ackError, ackOk, parseOrAck, requireGameSession, requirePlayerInSession, type HandlerAck } from '../handlerContext';

export function registerSetReadyHandler(io: GameServer, socket: GameSocket): void {
  socket.on('setReady', async (payload, ack?: HandlerAck) => {
    const parsed = parseOrAck(SetReadyPayloadSchema, payload, ack);
    if (!parsed) return;

    const session = requireGameSession(parsed.villageCode, ack);
    if (!session) return;
    if (!requirePlayerInSession(session, socket.player._id, ack)) return;

    if (session.state.phase !== 'LOBBY') {
      ackError(ack, { code: 'INVALID_PHASE', message: 'Ready state can only be changed in the lobby.' });
      return;
    }

    session.state = {
      ...session.state,
      players: session.state.players.map((p) => (p.id === socket.player._id ? { ...p, isReady: parsed.isReady } : p)),
    };

    await villagesRepository.touchVillageActivity(parsed.villageCode);
    broadcastStateToVillage(io, session.state);
    ackOk(ack);
  });
}
