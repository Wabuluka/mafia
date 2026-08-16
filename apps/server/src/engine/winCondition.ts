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

function teamOf(player: Player): Team | undefined {
  return player.role ? ROLE_TEAM[player.role] : undefined;
}

/**
 * Evaluates the standard elimination win conditions:
 *   - Mafia reaches parity with (or exceeds) the town: mafia wins. Parity,
 *     not a strict majority, because once mafia >= town the town can no
 *     longer out-vote them even with perfect play.
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
