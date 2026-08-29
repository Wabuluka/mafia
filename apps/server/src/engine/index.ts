// ---------------------------------------------------------------------------
// engine/ — the pure Mafia game engine. Read before adding to this module.
//
// PURITY CONTRACT
// ---------------------------------------------------------------------------
// Every function in this directory is pure: no database access, no socket
// I/O, no timers, no `Date.now()` / `Math.random()`. Anything
// non-deterministic the engine needs (a timestamp, a role-assignment seed)
// is passed in by the caller as a plain argument. This is what makes the
// entire rules engine unit-testable without mocks and reproducible from a
// stored seed.
//
// Fallible operations (`applyNightAction`, `castVote`) return an
// `EngineResult<T>` discriminated union — `{ ok: true, value }` or
// `{ ok: false, reason, message }` — and never throw for an expected
// rejection (dead player acting, wrong phase, etc). A thrown error here
// means a programmer mistake, not a game-rule violation.
//
// Phase-resolution functions (`resolveNight`, `resolveVote`) return a
// `Resolution` (`{ state, effects }`) describing what happened as data; the
// impure caller (the socket/game-loop layer) is responsible for actually
// broadcasting narration, persisting checkpoints, etc.
// ---------------------------------------------------------------------------

export {
  assignRoles,
  type AssignedPlayer,
  type AssignRolesConfig,
  type UnassignedPlayer,
} from './assignRoles';
export { applyNightAction, resolveNight, type SubmitNightActionInput } from './nightActions';
export { castVote, resolveVote, ABSTAIN, type CastVoteInput, type VoteTarget } from './voting';
export {
  nominate,
  resolveNominations,
  DECLINE,
  type SubmitNominationInput,
  type NominationTarget,
} from './nominations';
export { checkWinCondition, checkJesterWin, type WinVerdict } from './winCondition';
export { redactStateFor } from './redact';
export { createRng, shuffle, type Rng } from './rng';
export {
  ok,
  reject,
  type EngineResult,
  type EngineRejectionReason,
  type EngineEffect,
  type Resolution,
} from './types';
