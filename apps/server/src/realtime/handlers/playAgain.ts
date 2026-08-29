// ---------------------------------------------------------------------------
// playAgain — host-only, GAME_OVER-only: starts a brand-new game in the
// SAME village, for the SAME roster of players currently connected to it,
// with roles freshly reshuffled. No one re-enters a village code or rejoins
// over HTTP — every player already holds a live socket in this village's
// room, so the transition is just a new in-memory GameSession state plus a
// broadcast, exactly like `startGame` but skipping the lobby/ready step
// entirely (the roster is already known and settled from the game that
// just ended).
//
// Dead players from the last game are included too — death doesn't remove
// someone from a village's roster, only from that one game's `status`. A
// fresh game means everyone starts ALIVE again, roles reshuffled from
// scratch (see engine/assignRoles for the seed contract `startGame` uses).
// ---------------------------------------------------------------------------

import { MIN_PLAYERS, PlayAgainPayloadSchema, nextApplicableNightSubPhase } from '@mafia/shared';
import { villagesRepository } from '../../db';
import { assignRoles } from '../../engine';
import { broadcastStateToVillage, type GameServer, type GameSocket } from '../emit';
import { ackError, ackOk, parseOrAck, requireGameSession, requirePlayerInSession, type HandlerAck } from '../handlerContext';
import { persistGameStart } from '../persistence';

export function registerPlayAgainHandler(io: GameServer, socket: GameSocket): void {
  socket.on('playAgain', async (payload, ack?: HandlerAck) => {
    const parsed = parseOrAck(PlayAgainPayloadSchema, payload, ack);
    if (!parsed) return;

    const session = requireGameSession(parsed.villageCode, ack);
    if (!session) return;
    if (!requirePlayerInSession(session, socket.player._id, ack)) return;

    if (session.state.phase !== 'GAME_OVER') {
      ackError(ack, { code: 'INVALID_PHASE', message: 'Play again is only available once a game has ended.' });
      return;
    }

    const caller = session.state.players.find((p) => p.id === socket.player._id);
    if (!caller?.isHost) {
      ackError(ack, { code: 'NOT_HOST', message: 'Only the host can start a new game.' });
      return;
    }

    // MIN_PLAYERS counts only non-host participants — see startGame.ts's
    // identical check for why.
    const nonHostPlayers = session.state.players.filter((p) => !p.isHost);
    if (nonHostPlayers.length < MIN_PLAYERS) {
      ackError(ack, { code: 'NOT_ENOUGH_PLAYERS', message: `At least ${MIN_PLAYERS} players are required to start.` });
      return;
    }

    // Fresh roster: same players, everyone reset to ALIVE/not-ready-gated
    // (playAgain skips the ready step on purpose — they were all already
    // playing together a moment ago), roles stripped so `assignRoles`
    // below is the only source of the new game's roles. `revealedRole`
    // from the last game is dropped too — nothing is publicly revealed
    // about anyone until this new game itself reveals it. The host is
    // excluded here too — see startGame.ts's identical rationale — and
    // reassembled back into the roster afterward, role-less.
    const resetRoster = nonHostPlayers.map((p) => ({
      id: p.id,
      name: p.name,
      connected: p.connected,
      isHost: p.isHost,
      isReady: p.isReady,
      joinedAt: p.joinedAt,
    }));

    // A new roleSeed each time (mirrors bootstrapLobbySession's own
    // randomization) — reusing the previous game's seed would reshuffle
    // deterministically to THE SAME assignment, which defeats "freshly
    // shuffled roles".
    session.roleSeed = Date.now() ^ Math.floor(Math.random() * 0xffffffff);

    const assignedNonHost = assignRoles(resetRoster, { seed: session.roleSeed });
    const assignedById = new Map(assignedNonHost.map((p) => [p.id, p]));
    // Same "omit, don't set-to-undefined" rule as startGame.ts's identical
    // fallback — see that module's comment for why a present-but-undefined
    // `role`/`revealedRole` key breaks the Mongo write on the very next
    // createGame call (the driver encodes it as a real BSON null, which
    // gamesValidator's enum rejects).
    const assigned = session.state.players.map((p) => {
      const reassigned = assignedById.get(p.id);
      if (reassigned) return reassigned;
      const { role: _role, revealedRole: _revealedRole, ...rest } = p;
      return { ...rest, status: 'ALIVE' as const };
    });

    session.state = {
      ...session.state,
      phase: 'NIGHT',
      roundNumber: 1,
      players: assigned,
      nightSubPhase: nextApplicableNightSubPhase(assigned, undefined),
      nightActions: [],
      votes: [],
      nominations: [],
      shortlistedIds: [],
      chatLog: [],
      endReason: undefined,
      winningTeam: undefined,
    };
    session.pendingEvents = [];

    const gameId = await persistGameStart(session.state);
    session.gameId = gameId;

    await villagesRepository.setVillageStatus(parsed.villageCode, 'IN_GAME');

    // No timer is started here — same human-moderator model as startGame
    // (see phaseLoop.ts's module header). The host begins the first
    // night's countdown explicitly via startPhaseTimer.
    broadcastStateToVillage(io, session);
    ackOk(ack);
  });
}
