// ---------------------------------------------------------------------------
// leaveVillage — an explicit, voluntary departure (as opposed to disconnect.ts,
// which handles an involuntary drop and never removes the player). Only
// valid in the LOBBY: once a game has started, a player who wants to stop
// participating simply disconnects/backgrounds — see the module header in
// index.ts for why an in-progress game never removes a roster entry.
//
// Host handling: if the departing player was host, host transfers to the
// longest-connected remaining player — see lobbyManagement.ts's
// `transferHostIfNeeded` for the exact rule.
// ---------------------------------------------------------------------------

import { LeaveVillagePayloadSchema } from '@mafia/shared';
import { villagesRepository } from '../../db';
import { gameVillage, broadcastStateToVillage, type GameServer, type GameSocket } from '../emit';
import { ackError, ackOk, parseOrAck, requireGameSession, type HandlerAck } from '../handlerContext';
import { transferHostIfNeeded } from '../lobbyManagement';
import { villageManager } from '../VillageManager';

export function registerLeaveVillageHandler(io: GameServer, socket: GameSocket): void {
  socket.on('leaveVillage', async (payload, ack?: HandlerAck) => {
    const parsed = parseOrAck(LeaveVillagePayloadSchema, payload, ack);
    if (!parsed) return;

    const session = requireGameSession(parsed.villageCode, ack);
    if (!session) return;

    if (session.state.phase !== 'LOBBY') {
      ackError(ack, { code: 'INVALID_PHASE', message: 'Cannot leave a village once a game is in progress — disconnect instead.' });
      return;
    }

    const player = socket.player;

    // Mongo is updated FIRST and awaited before the in-memory roster is
    // touched — see kickPlayer.ts's identical comment: Mongo is the point
    // of truth other handlers (e.g. respondToJoinRequest's capacity check)
    // read directly, so leaving it stale while memory has already dropped
    // the player would let a same-tick accept see a not-yet-decremented
    // count and wrongly reject as VILLAGE_FULL right after a slot freed up.
    await villagesRepository.removePlayerFromVillage(parsed.villageCode, player._id);

    // Transfer host BEFORE removing the departing player from the roster —
    // transferHostIfNeeded needs to see the full player list (including
    // the outgoing host) to know who currently holds it, then we drop
    // them from the roster in the same step.
    const withHostTransferred = transferHostIfNeeded(session.state, player._id);
    session.state = {
      ...withHostTransferred,
      players: withHostTransferred.players.filter((p) => p.id !== player._id),
    };
    session.sockets.delete(player._id);

    await socket.leave(gameVillage(parsed.villageCode));

    io.to(gameVillage(parsed.villageCode)).emit('playerLeft', { playerId: player._id, playerName: player.displayName, reason: 'LEFT' });

    if (session.state.players.length === 0) {
      villageManager.delete(parsed.villageCode);
    } else {
      const newHost = session.state.players.find((p) => p.isHost);
      if (newHost) {
        await villagesRepository.setHost(parsed.villageCode, newHost.id);
      }
      broadcastStateToVillage(io, session);
    }

    ackOk(ack);
  });
}
