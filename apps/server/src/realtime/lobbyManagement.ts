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
 *
 * LOBBY-ONLY once the host is guaranteed role-less (see assignRoles.ts /
 * startGame.ts's "moderator never plays" rule): a no-op outside `phase ===
 * 'LOBBY'`. The host disconnecting mid-game is deliberately NOT handled by
 * promoting a replacement — every other player already has a role/team by
 * that point, and handing them the host flag too would either break the
 * "host is never a participant" invariant or corrupt win-condition parity
 * if their role were stripped retroactively. A mid-game host disconnect
 * just leaves the game without a live moderator (their `connected: false`
 * is already visible to clients) until they reconnect — no one else can
 * ever become host for an in-progress game.
 */
export function transferHostIfNeeded(state: FullGameState, outgoingPlayerId: string): FullGameState {
  if (state.phase !== 'LOBBY') return state;

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

/**
 * Self-heals a lobby that has no reachable host — the case
 * `transferHostIfNeeded` alone doesn't cover, since that function only
 * fires on an explicit leave/disconnect of the CURRENT host. A host can
 * also become unreachable WITHOUT ever disconnecting from that role's own
 * perspective: their identity is a fixed snapshot of whoever's session
 * created the village (see http/routes/villages.routes.ts), so if that
 * session is ever lost/reset/expired and they rejoin under a different
 * player id, the roster is left with an `isHost: true` entry that's
 * either gone or permanently disconnected, and the NEW arrival has no
 * host flag of their own — nobody can ever click Start again.
 *
 * Call this after every roster mutation in LOBBY phase (join, reconnect,
 * disconnect, leave, kick) so the lobby recovers on the very next
 * opportunity rather than staying silently stranded. No-ops if a
 * connected host already exists — this is a bottom-up safety net, not a
 * replacement for `transferHostIfNeeded`'s normal handoff path.
 *
 * LOBBY-ONLY, same as `transferHostIfNeeded` — every existing call site
 * already only invokes this during LOBBY (see joinVillage.ts, disconnect.ts's
 * phase-gated branch), which is also why this doesn't need its own
 * `state.phase !== 'LOBBY'` guard today. Do not call this from a mid-game
 * code path: once the host is guaranteed role-less, promoting a new host
 * mid-game runs into the exact same "host must never be a participant"
 * conflict `transferHostIfNeeded`'s doc comment explains.
 */
export function ensureLobbyHasHost(state: FullGameState): FullGameState {
  const hasReachableHost = state.players.some((p) => p.isHost && p.connected);
  if (hasReachableHost) return state;

  const nextHost = pickNextHost(state.players);
  if (!nextHost) return state; // nobody connected at all — nothing to promote yet

  return {
    ...state,
    players: state.players.map((p) => ({ ...p, isHost: p.id === nextHost.id })),
  };
}
