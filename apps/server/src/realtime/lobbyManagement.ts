// ---------------------------------------------------------------------------
// Shared lobby-management helpers used by more than one handler: host
// transfer, and the village-code-scoped "which player should inherit host"
// rule. Kept out of any single handler file since leaveVillage.ts and
// disconnect.ts both need the exact same transfer logic and must never
// drift into two subtly different rules for "who becomes host next".
// ---------------------------------------------------------------------------

import type { FullGameState, Player } from '@mafia/shared';

/**
 * Picks the player who should become host after the current host leaves:
 * the longest-connected REMAINING, CURRENTLY CONNECTED player, i.e. the
 * one with the smallest `joinedAt` among players still actually present.
 * A disconnected player is skipped even if they joined first — handing
 * host to someone who isn't there to use it would just strand the lobby
 * on a different unreachable host. Returns `undefined` if nobody
 * qualifies (empty village, or everyone remaining is disconnected), in which
 * case the caller keeps the lobby hostless until someone reconnects/joins.
 */
export function pickNextHost(remainingPlayers: readonly Player[]): Player | undefined {
  const eligible = remainingPlayers.filter((p) => p.connected);
  if (eligible.length === 0) return undefined;

  return eligible.reduce((longest, candidate) => (candidate.joinedAt < longest.joinedAt ? candidate : longest));
}

/**
 * Transfers host to the result of `pickNextHost`, if the departing/
 * disconnected player currently holds it. Returns the updated state
 * unchanged if `outgoingPlayerId` wasn't host, or if there's nobody
 * eligible to hand it to (see pickNextHost) — a hostless lobby is left as
 * such rather than forced onto someone who can't act on it; the next
 * player to join or reconnect becomes eligible on the next call.
 */
export function transferHostIfNeeded(state: FullGameState, outgoingPlayerId: string): FullGameState {
  const outgoing = state.players.find((p) => p.id === outgoingPlayerId);
  if (!outgoing?.isHost) return state;

  const remaining = state.players.filter((p) => p.id !== outgoingPlayerId);
  const nextHost = pickNextHost(remaining);
  if (!nextHost) {
    // Nobody eligible — just strip the outgoing player's host flag (if
    // they're still in the roster at all, e.g. a disconnect rather than a
    // leave) rather than leaving a leftover isHost:true on someone who's gone.
    return { ...state, players: state.players.map((p) => (p.id === outgoingPlayerId ? { ...p, isHost: false } : p)) };
  }

  return {
    ...state,
    players: state.players.map((p) => {
      if (p.id === outgoingPlayerId) return { ...p, isHost: false };
      if (p.id === nextHost.id) return { ...p, isHost: true };
      return p;
    }),
  };
}
