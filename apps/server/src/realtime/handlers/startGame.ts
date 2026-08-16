// ---------------------------------------------------------------------------
// startGame — host-only. Assigns roles (deterministic per session.roleSeed),
// transitions LOBBY -> NIGHT, creates the DB-side game record, and starts
// the phase timer. This is the one point a game's Mongo document is born;
// everything after this is phase-boundary/game-end checkpoints, per the
// hot-path boundary comment in db/index.ts.
// ---------------------------------------------------------------------------

import { MIN_PLAYERS, StartGamePayloadSchema } from '@mafia/shared';
import { villagesRepository } from '../../db';
import { assignRoles } from '../../engine';
import { broadcastStateToVillage, type GameServer, type GameSocket } from '../emit';
import { ackError, ackOk, parseOrAck, requireGameSession, requirePlayerInSession, type HandlerAck } from '../handlerContext';
import { persistGameStart } from '../persistence';
import { scheduleNextPhase } from '../phaseLoop';

export function registerStartGameHandler(io: GameServer, socket: GameSocket): void {
  socket.on('startGame', async (payload, ack?: HandlerAck) => {
    const parsed = parseOrAck(StartGamePayloadSchema, payload, ack);
    if (!parsed) return;

    const session = requireGameSession(parsed.villageCode, ack);
    if (!session) return;
    if (!requirePlayerInSession(session, socket.player._id, ack)) return;

    if (session.state.phase !== 'LOBBY') {
      ackError(ack, { code: 'INVALID_PHASE', message: 'This game has already started.' });
      return;
    }

    const caller = session.state.players.find((p) => p.id === socket.player._id);
    if (!caller?.isHost) {
      ackError(ack, { code: 'NOT_HOST', message: 'Only the host can start the game.' });
      return;
    }

    if (session.state.players.length < MIN_PLAYERS) {
      ackError(ack, { code: 'NOT_ENOUGH_PLAYERS', message: `At least ${MIN_PLAYERS} players are required to start.` });
      return;
    }

    const allReady = session.state.players.every((p) => p.isHost || p.isReady);
    if (!allReady) {
      ackError(ack, { code: 'NOT_ENOUGH_PLAYERS', message: 'All players must be ready before the host can start.' });
      return;
    }

    const assigned = assignRoles(
      session.state.players.map((p) => ({
        id: p.id,
        name: p.name,
        connected: p.connected,
        isHost: p.isHost,
        isReady: p.isReady,
        joinedAt: p.joinedAt,
      })),
      { seed: session.roleSeed },
    );

    session.state = {
      ...session.state,
      phase: 'NIGHT',
      roundNumber: 1,
      players: assigned,
    };

    const gameId = await persistGameStart(session.state);
    session.gameId = gameId;

    await villagesRepository.setVillageStatus(parsed.villageCode, 'IN_GAME');

    // Schedule BEFORE broadcasting: scheduleNextPhase stamps the absolute
    // deadline onto session.state.phaseTimer, and clients must never see a
    // NIGHT state with no timer attached, even for one broadcast.
    scheduleNextPhase(io, session);
    broadcastStateToVillage(io, session.state);
    ackOk(ack);
  });
}
