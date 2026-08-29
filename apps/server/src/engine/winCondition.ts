// ---------------------------------------------------------------------------
// Win-condition evaluation. Pure, called after every death (night
// resolution or vote resolution) to decide whether the game should move to
// GAME_OVER. Does not mutate state itself — returns a verdict the caller
// applies.
// ---------------------------------------------------------------------------

import { ROLE_TEAM, type FullGameState, type GameEndReason, type Player, type Team } from '@mafia/shared';

export interface WinVerdict {
  isOver: boolean;
  reason?: GameEndReason;
  winningTeam?: Team;
}

function alivePlayers(state: FullGameState): Player[] {
  return state.players.filter((p) => p.status === 'ALIVE');
}

/** Returns `undefined` for a player with no role — which, once the game
 * has started, means exactly one thing: the host/moderator (see
 * Player.isHost's doc comment in @mafia/shared/entities.ts — the host is
 * deliberately never assigned a role). This is not an incidental fallback;
 * it's the actual mechanism by which the host is excluded from every
 * team-based tally below (`alivePlayers`'s callers all filter by `teamOf`
 * returning a real team), so a role-less alive host is correctly never
 * counted toward town/mafia/neutral parity. */
function teamOf(player: Player): Team | undefined {
  return player.role ? ROLE_TEAM[player.role] : undefined;
}

/**
 * Evaluates the standard elimination win conditions:
 *   - Mafia reaches parity with (or exceeds) town+neutral combined: mafia
 *     wins. Parity, not a strict majority, because once mafia can no longer
 *     be out-voted by everyone else combined, town can't win even with
 *     perfect play. NEUTRAL is deliberately folded in with TOWN on this side
 *     of the count — a neutral player (e.g. JESTER) isn't on team TOWN, but
 *     is still a non-mafia vote mafia must out-number, so they count as an
 *     obstacle to a mafia win exactly like a town player does. This is a
 *     deliberate ruling, not an oversight — see winCondition.test.ts for a
 *     case pinning it down.
 *   - All mafia are eliminated: town wins.
 *   - A JESTER's win (getting voted out) is a special case that resolves
 *     immediately when it happens, in the day-vote handler, not here —
 *     this function only covers the ongoing-elimination conditions that
 *     must be re-checked after every death.
 */
export function checkWinCondition(state: FullGameState): WinVerdict {
  const alive = alivePlayers(state);
  const aliveMafia = alive.filter((p) => teamOf(p) === 'MAFIA').length;
  const aliveTown = alive.filter((p) => teamOf(p) === 'TOWN').length;
  const aliveNeutral = alive.filter((p) => teamOf(p) === 'NEUTRAL').length;

  if (aliveMafia === 0) {
    return { isOver: true, reason: 'TOWN_WIN', winningTeam: 'TOWN' };
  }

  if (aliveMafia >= aliveTown + aliveNeutral) {
    return { isOver: true, reason: 'MAFIA_WIN', winningTeam: 'MAFIA' };
  }

  return { isOver: false };
}

/**
 * The jester's own win condition: they win the instant the town votes them
 * out. Call this from the vote-resolution handler right after applying the
 * elimination, before falling through to `checkWinCondition` for the
 * ongoing mafia/town conditions.
 */
export function checkJesterWin(eliminatedPlayer: Player | undefined): WinVerdict {
  if (eliminatedPlayer?.role === 'JESTER') {
    return { isOver: true, reason: 'JESTER_WIN', winningTeam: 'NEUTRAL' };
  }
  return { isOver: false };
}
