// ---------------------------------------------------------------------------
// disconnect — flips `connected: false` on this player across every active
// session their socket was attached to. Never removes them from the
// roster, never touches their role, never reveals anything. This is
// deliberate: a mafia member who backgrounds their phone mid-night must
// look, to every other player, exactly like a player who is simply taking
// a moment to decide — not conspicuously "gone", which would itself leak
// information (the town could infer "the quiet one who vanished during the
// mafia's kill window is mafia").
//
// The only place a player is ever actually removed from an in-progress
// game's roster is nowhere — it doesn't happen. leaveVillage.ts (voluntary
// departure) only works pre-game, in the LOBBY.
//
// Host handling: if the disconnecting player was host AND the village is
// still in the LOBBY, host transfers to the longest-connected remaining
// CONNECTED player (see lobbyManagement.ts) — a disconnected host in a
// lobby that hasn't started yet would otherwise strand it with nobody able
// to click Start. Once a game is IN PROGRESS, host is deliberately left
// alone on disconnect — the host role has no special power mid-game beyond
// having started it, and reshuffling it mid-phase would be a stranger,
// riskier change than this pass needs to make.
//
// Pending join requests: a player who closes their tab while still
// waiting on host approval was never added to `session.sockets` (see
// requestToJoin.ts — only an ACCEPTED player joins the real roster), so
// the roster-disconnect logic below never sees them at all. Handled as its
// own pass over `session.pendingRequests` instead — silently dropping
// their request rather than leaving a stale entry the host would see and
// approve into a nobody.
// ---------------------------------------------------------------------------

import { villagesRepository } from '../../db';
import { broadcastStateToVillage, type GameServer, type GameSocket } from '../emit';
import { broadcastJoinRequests } from '../joinRequests';
import { ensureLobbyHasHost, transferHostIfNeeded } from '../lobbyManagement';
import { villageManager } from '../VillageManager';

export function registerDisconnectHandler(io: GameServer, socket: GameSocket): void {
  socket.on('disconnect', () => {
    const player = socket.player;
    if (!player) return; // shouldn't happen post-handshake-auth, but never throw from a disconnect handler

    for (const session of villageManager.all()) {
      const pending = session.pendingRequests.get(player._id);
      if (pending && pending.socketId === socket.id) {
        session.pendingRequests.delete(player._id);
        void villagesRepository.removePendingPlayer(session.villageCode, player._id);
        broadcastJoinRequests(io, session);
      }

      const registeredSocketId = session.sockets.get(player._id);
      // Only clear this session's membership if THIS socket was the one
      // registered for the player — if they've already reconnected with a
      // new socket (which re-registers in joinVillage.ts), an old socket's
      // belated disconnect event must not clobber the new connection's
      // `connected: true`.
      if (registeredSocketId !== socket.id) continue;

      session.sockets.delete(player._id);
      const wasInRoster = session.state.players.some((p) => p.id === player._id);
      if (!wasInRoster) continue;

      const disconnectedState = {
        ...session.state,
        players: session.state.players.map((p) => (p.id === player._id ? { ...p, connected: false } : p)),
      };

      // transferHostIfNeeded only covers the departing HOST's own handoff;
      // ensureLobbyHasHost is the backstop for the "nobody eligible at
      // that moment" branch (transferHostIfNeeded leaves the lobby
      // hostless rather than force a handoff to a disconnected player) and
      // for a host that was ALREADY unreachable for an unrelated reason —
      // see its own doc comment on lobbyManagement.ts.
      session.state = session.state.phase === 'LOBBY'
        ? ensureLobbyHasHost(transferHostIfNeeded(disconnectedState, player._id))
        : disconnectedState;

      broadcastStateToVillage(io, session);

      if (session.state.phase === 'LOBBY') {
        const newHost = session.state.players.find((p) => p.isHost);
        if (newHost && newHost.id !== player._id) {
          void villagesRepository.setHost(session.villageCode, newHost.id);
        }
      }
    }
  });
}
