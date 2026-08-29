// ---------------------------------------------------------------------------
// startGame — host-only. Assigns roles (deterministic per session.roleSeed),
// transitions LOBBY -> NIGHT, and creates the DB-side game record. This is
// the one point a game's Mongo document is born; everything after this is
// phase-boundary/game-end checkpoints, per the hot-path boundary comment in
// db/index.ts.
//
// Under the human-moderator model (see phaseLoop.ts's module header) this
// does NOT start the first night's timer — the game enters NIGHT with no
// running `phaseTimer`, exactly like every later phase transition, and
// waits for the host to call `startPhaseTimer` whenever they're ready to
// actually begin (e.g. once they've finished any opening narration).
//
// THE HOST NEVER PLAYS — the host/moderator is a pure spectator/moderator
// role (see Player.isHost's doc comment in @mafia/shared/entities.ts): they
// are excluded from `assignRoles` entirely and reassembled back into the
// roster afterward with `role: undefined`, `status: 'ALIVE'`. MIN_PLAYERS
// and the role-distribution lookup both count only the non-host players
// who actually receive a role — see @mafia/shared/constants.ts.
// ---------------------------------------------------------------------------

import { MIN_PLAYERS, StartGamePayloadSchema, nextApplicableNightSubPhase } from '@mafia/shared';
import { villagesRepository } from '../../db';
import { assignRoles } from '../../engine';
import { broadcastStateToVillage, type GameServer, type GameSocket } from '../emit';
import { ackError, ackOk, parseOrAck, requireGameSession, requirePlayerInSession, type HandlerAck } from '../handlerContext';
import { persistGameStart } from '../persistence';

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

    // MIN_PLAYERS counts only non-host participants — the host never
    // receives a role, so they don't count toward "enough players to
    // start" any more than they'd count toward a role-distribution slot.
    const nonHostPlayers = session.state.players.filter((p) => !p.isHost);
    if (nonHostPlayers.length < MIN_PLAYERS) {
      ackError(ack, { code: 'NOT_ENOUGH_PLAYERS', message: `At least ${MIN_PLAYERS} players are required to start.` });
      return;
    }

    const allReady = session.state.players.every((p) => p.isHost || p.isReady);
    if (!allReady) {
      ackError(ack, { code: 'NOT_ENOUGH_PLAYERS', message: 'All players must be ready before the host can start.' });
      return;
    }

    // assignRoles must never see the host — see its own doc comment and
    // this module's header. The host is reassembled back into the roster
    // afterward, role-less, in their original relative position.
    const assignedNonHost = assignRoles(
      nonHostPlayers.map((p) => ({
        id: p.id,
        name: p.name,
        connected: p.connected,
        isHost: p.isHost,
        isReady: p.isReady,
        joinedAt: p.joinedAt,
      })),
      { seed: session.roleSeed },
    );
    const assignedById = new Map(assignedNonHost.map((p) => [p.id, p]));
    const assigned = session.state.players.map((p) => {
      const reassigned = assignedById.get(p.id);
      if (reassigned) return reassigned;
      // The host: OMIT `role`/`revealedRole` entirely rather than setting
      // them to `undefined` — an object property explicitly set to
      // `undefined` still round-trips through the MongoDB driver as a
      // real BSON `null` value, which gamesValidator's `{ enum: ROLE_ENUM }`
      // (no `null` in the enum) rejects on the very first `createGame`
      // write. Destructuring them out is what actually removes the keys,
      // matching how `PublicPlayer`/`FullGameState.players` model "no
      // role" as an ABSENT field, not a present-but-empty one.
      const { role: _role, revealedRole: _revealedRole, ...rest } = p;
      return { ...rest, status: 'ALIVE' as const };
    });

    session.state = {
      ...session.state,
      phase: 'NIGHT',
      roundNumber: 1,
      players: assigned,
      // The moderator-driven night flow starts at the first applicable
      // role — see @mafia/shared's nextApplicableNightSubPhase. The host's
      // role-less row is simply never picked (see that function's living-
      // role-holder scan), same as a VILLAGER/JESTER row.
      nightSubPhase: nextApplicableNightSubPhase(assigned, undefined),
    };

    const gameId = await persistGameStart(session.state);
    session.gameId = gameId;

    await villagesRepository.setVillageStatus(parsed.villageCode, 'IN_GAME');

    // No timer is started here — see this module's header. The host
    // begins the first night's countdown explicitly via startPhaseTimer.
    broadcastStateToVillage(io, session);
    ackOk(ack);
  });
}
