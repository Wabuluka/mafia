// ---------------------------------------------------------------------------
// Test-only helpers for building FullGameState fixtures without repeating
// object boilerplate in every test. Not part of the engine's public API.
// ---------------------------------------------------------------------------

import { brandFullGameState, type FullGameState, type Phase, type PlayerId, type Role } from '@mafia/shared';

export interface FixturePlayerSpec {
  id: string;
  name: string;
  role: Role;
  status?: 'ALIVE' | 'DEAD';
  isHost?: boolean;
}

export interface BuildStateOptions {
  phase?: Phase;
  roundNumber?: number;
  players: FixturePlayerSpec[];
  nightActions?: FullGameState['nightActions'];
  votes?: FullGameState['votes'];
  chatLog?: FullGameState['chatLog'];
}

export function pid(id: string): PlayerId {
  return id as PlayerId;
}

/** Builds a minimal, valid FullGameState for a test. Every field a test
 * doesn't care about gets an empty/neutral default. */
export function buildState(opts: BuildStateOptions): FullGameState {
  return brandFullGameState({
    roomCode: 'ABCD' as FullGameState['roomCode'],
    phase: opts.phase ?? 'NIGHT',
    roundNumber: opts.roundNumber ?? 1,
    players: opts.players.map((p) => ({
      id: pid(p.id),
      name: p.name,
      role: p.role,
      status: p.status ?? 'ALIVE',
      connected: true,
      isHost: p.isHost ?? false,
      isReady: true,
      joinedAt: 0,
    })),
    nightActions: opts.nightActions ?? [],
    votes: opts.votes ?? [],
    chatLog: opts.chatLog ?? [],
  });
}
