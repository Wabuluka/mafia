// ---------------------------------------------------------------------------
// Test-only helpers for building FullGameState fixtures without repeating
// object boilerplate in every test. Not part of the engine's public API.
// ---------------------------------------------------------------------------

import {
  brandFullGameState,
  nextApplicableNightSubPhase,
  type FullGameState,
  type NightSubPhase,
  type Phase,
  type PlayerId,
  type Role,
} from '@mafia/shared';

export interface FixturePlayerSpec {
  id: string;
  name: string;
  /** Omit for a role-less host/moderator fixture (see Player.isHost's doc
   * comment in @mafia/shared/entities.ts — the host never receives a
   * role). Every non-host fixture should still set this explicitly. */
  role?: Role;
  status?: 'ALIVE' | 'DEAD';
  isHost?: boolean;
}

export interface BuildStateOptions {
  phase?: Phase;
  roundNumber?: number;
  players: FixturePlayerSpec[];
  nightActions?: FullGameState['nightActions'];
  votes?: FullGameState['votes'];
  nominations?: FullGameState['nominations'];
  /** Defaults to `[]` — override for a test exercising DAY_VOTE's
   * shortlist restriction (castVote's INVALID_TARGET check) or a
   * DAY_DISCUSSION -> DAY_VOTE resolution. */
  shortlistedIds?: FullGameState['shortlistedIds'];
  chatLog?: FullGameState['chatLog'];
  /** Defaults to the first applicable role (see
   * nextApplicableNightSubPhase) when `phase` is NIGHT, and to `undefined`
   * otherwise — override for a test that needs a specific role "on the
   * clock", or `'COMPLETE'` to simulate a fully-resolved sub-sequence. */
  nightSubPhase?: NightSubPhase;
}

export function pid(id: string): PlayerId {
  return id as PlayerId;
}

/** Builds a minimal, valid FullGameState for a test. Every field a test
 * doesn't care about gets an empty/neutral default. */
export function buildState(opts: BuildStateOptions): FullGameState {
  const phase = opts.phase ?? 'NIGHT';
  const players = opts.players.map((p) => ({
    id: pid(p.id),
    name: p.name,
    role: p.role,
    status: p.status ?? 'ALIVE',
    connected: true,
    isHost: p.isHost ?? false,
    isReady: true,
    joinedAt: 0,
  }));

  return brandFullGameState({
    villageCode: 'ABCD' as FullGameState['villageCode'],
    phase,
    roundNumber: opts.roundNumber ?? 1,
    players,
    nightSubPhase:
      opts.nightSubPhase ?? (phase === 'NIGHT' ? nextApplicableNightSubPhase(players, undefined) : undefined),
    nightActions: opts.nightActions ?? [],
    votes: opts.votes ?? [],
    nominations: opts.nominations ?? [],
    shortlistedIds: opts.shortlistedIds ?? [],
    chatLog: opts.chatLog ?? [],
  });
}
