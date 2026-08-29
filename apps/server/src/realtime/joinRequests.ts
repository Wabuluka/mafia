// ---------------------------------------------------------------------------
// Shared helper for broadcasting a session's live pending-join-request list
// to the host — used by requestToJoin.ts, respondToJoinRequest.ts, and
// disconnect.ts (a pending requester's own disconnect removes them from the
// list too, same as it would for a real player). Kept out of any single
// handler file since more than one needs the exact same "who's currently
// eligible to see this" rule: ONLY the current host, on their own private
// channel — no other player's PlayerView (nor even a non-host's `you`
// block) ever learns a join request exists at all. See
// VillageManager.ts's `pendingRequests` doc comment for why this is
// deliberately NOT folded into `stateUpdate`.
// ---------------------------------------------------------------------------

import { playerChannel, type GameServer } from './emit';
import type { GameSession } from './VillageManager';

/** Emits the current pending-request list to whichever player currently
 * holds `isHost` in `session.state` — resolved fresh on every call rather
 * than cached, so a host transfer (see lobbyManagement.ts) is naturally
 * picked up without this module needing to know that happened. No-ops if
 * nobody currently holds host (a momentarily hostless lobby — see
 * `ensureLobbyHasHost`) since there's nobody to tell. */
export function broadcastJoinRequests(io: GameServer, session: GameSession): void {
  const host = session.state.players.find((p) => p.isHost);
  if (!host) return;

  const requests = [...session.pendingRequests.entries()]
    .map(([playerId, req]) => ({ playerId, playerName: req.playerName, requestedAt: req.requestedAt }))
    .sort((a, b) => a.requestedAt - b.requestedAt);

  io.to(playerChannel(host.id)).emit('joinRequestsUpdated', { requests });
}
