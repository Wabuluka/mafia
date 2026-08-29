// ---------------------------------------------------------------------------
// Display labels for roles/phases/teams shared across the day-phase game
// log and the post-game screens — kept in one place so "Resident" (the
// VILLAGER role's display name — see packages/shared/src/constants.ts's
// roleLabel() for the same mapping on data the SERVER renders into prose)
// and friends don't drift between the two UIs that need them.
// ---------------------------------------------------------------------------

export const ROLE_LABEL: Record<string, string> = {
  VILLAGER: 'Resident',
  MAFIA: 'Mafia',
  DETECTIVE: 'Detective',
  DOCTOR: 'Doctor',
  JESTER: 'Jester',
};

export const PHASE_LABEL: Record<string, string> = {
  LOBBY: 'Lobby',
  NIGHT: 'Night',
  DAY_DISCUSSION: 'Discussion',
  DAY_VOTE: 'Vote',
  GAME_OVER: 'Game over',
};

export const TEAM_LABEL: Record<string, string> = {
  TOWN: 'The Residents',
  MAFIA: 'The Mafia',
  NEUTRAL: 'The Jester',
};

export const END_REASON_LABEL: Record<string, string> = {
  TOWN_WIN: 'The residents rooted out the mafia.',
  MAFIA_WIN: 'The mafia took over the village.',
  JESTER_WIN: 'The jester tricked the village into voting them out.',
  DRAW: 'The game ended without a winner.',
  ABANDONED: 'The game was abandoned.',
};
