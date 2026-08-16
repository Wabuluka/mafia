// ---------------------------------------------------------------------------
// Night phase: submitting an action, and resolving the night once every
// role has acted (or the phase timer — owned by the caller, not the engine
// — expires). Pure: no clocks, no I/O. The caller supplies `now` for the
// action's `submittedAt` timestamp; the engine never calls Date.now().
// ---------------------------------------------------------------------------

import type { FullGameState, NightAction, PlayerId, Role } from '@mafia/shared';
import { ok, reject, type EngineEffect, type EngineResult, type Resolution } from './types';

/** Roles that submit a night action. Order here also governs resolution
 * order in `resolveNight` (doctor must be known before the kill resolves). */
const NIGHT_ACTING_ROLES: readonly Role[] = ['MAFIA', 'DOCTOR', 'DETECTIVE'];

function findPlayer(state: FullGameState, playerId: PlayerId) {
  return state.players.find((p) => p.id === playerId);
}

export interface SubmitNightActionInput {
  actorId: PlayerId;
  /** Omit for an explicit no-target / skip action. */
  targetId?: PlayerId;
  /** Caller-supplied id for the resulting NightAction record (e.g. uuid). */
  actionId: string;
  /** Caller-supplied wall-clock timestamp; the engine never reads the clock. */
  now: number;
}

/**
 * Validates and records one player's night action. Rejects (never throws)
 * when: the actor doesn't exist, is dead, the phase isn't NIGHT, the
 * actor's role doesn't act at night, the actor already acted this night, or
 * the target doesn't exist / is dead (mafia and doctor may not target a
 * corpse; detective investigating a dead player is pointless but harmless,
 * so it's rejected too for a consistent rule across roles).
 */
export function applyNightAction(
  state: FullGameState,
  input: SubmitNightActionInput,
): EngineResult<FullGameState> {
  if (state.phase !== 'NIGHT') {
    return reject('WRONG_PHASE', 'Night actions can only be submitted during the NIGHT phase.');
  }

  const actor = findPlayer(state, input.actorId);
  if (!actor) {
    return reject('PLAYER_NOT_FOUND', 'Actor is not a player in this game.');
  }
  if (actor.status === 'DEAD') {
    return reject('PLAYER_DEAD', 'Dead players cannot take night actions.');
  }
  if (!actor.role || !NIGHT_ACTING_ROLES.includes(actor.role)) {
    return reject('WRONG_ROLE', `${actor.role ?? 'unknown role'} does not act at night.`);
  }

  const alreadyActed = state.nightActions.some(
    (a) => a.actorId === input.actorId && a.nightNumber === state.roundNumber,
  );
  if (alreadyActed) {
    return reject('ALREADY_ACTED', 'This player already submitted a night action this round.');
  }

  if (input.targetId !== undefined) {
    const target = findPlayer(state, input.targetId);
    if (!target) {
      return reject('INVALID_TARGET', 'Target is not a player in this game.');
    }
    if (target.status === 'DEAD') {
      return reject('TARGET_DEAD', 'Cannot target a player who is already dead.');
    }
  }

  const action: NightAction = {
    id: input.actionId,
    actorId: input.actorId,
    actorRole: actor.role,
    targetId: input.targetId,
    nightNumber: state.roundNumber,
    submittedAt: input.now,
  };

  return ok({
    ...state,
    nightActions: [...state.nightActions, action],
  });
}

/** Every night action submitted for the current round, keyed by role. There
 * can be multiple MAFIA actors; the last one submitted wins for the kill
 * target, matching a "mafia agrees on one target, last vote counts" house
 * rule — simple and deterministic. */
function actionsThisRound(state: FullGameState) {
  return state.nightActions.filter((a) => a.nightNumber === state.roundNumber);
}

/**
 * Resolves the NIGHT phase: applies the doctor's save against the mafia's
 * kill, computes deaths, and produces narration. Enforces that a doctor may
 * not protect the same target on two consecutive nights (no-repeat-
 * protection). Always succeeds — resolveNight only ever runs when the phase
 * is already NIGHT, which the caller (phase-transition logic) guarantees.
 */
export function resolveNight(state: FullGameState): Resolution {
  const actions = actionsThisRound(state);

  const mafiaAction = actions.filter((a) => a.actorRole === 'MAFIA').at(-1);
  const doctorAction = actions.find((a) => a.actorRole === 'DOCTOR');
  const detectiveAction = actions.find((a) => a.actorRole === 'DETECTIVE');

  const doctorRepeatedProtection =
    doctorAction?.targetId !== undefined && wasProtectedLastNight(state, doctorAction.targetId, state.roundNumber);

  // A repeated protection is a no-op protection: the save doesn't apply,
  // but the doctor's action is still recorded (already appended in
  // applyNightAction) so night-action history stays a faithful log of what
  // was attempted, not just what succeeded.
  const effectiveSaveTargetId = doctorRepeatedProtection ? undefined : doctorAction?.targetId;

  const killTargetId = mafiaAction?.targetId;
  const killWasSaved = killTargetId !== undefined && killTargetId === effectiveSaveTargetId;
  const diedThisNight = killTargetId !== undefined && !killWasSaved ? killTargetId : undefined;

  let players = state.players;
  if (diedThisNight !== undefined) {
    players = players.map((p) => (p.id === diedThisNight ? { ...p, status: 'DEAD' } : p));
  }

  const effects: EngineEffect[] = [];

  if (diedThisNight !== undefined) {
    const victim = state.players.find((p) => p.id === diedThisNight);
    effects.push({ type: 'PLAYER_DIED', playerId: diedThisNight, cause: 'MAFIA_KILL' });
    effects.push({
      type: 'NARRATION',
      text: `${victim?.name ?? 'A player'} was found dead. The town wakes to grim news.`,
    });
  } else if (killTargetId !== undefined && killWasSaved) {
    effects.push({
      type: 'NARRATION',
      text: 'The mafia struck last night, but their target was saved by the doctor.',
    });
  } else {
    effects.push({ type: 'NARRATION', text: 'The night passes without incident.' });
  }

  if (detectiveAction?.targetId !== undefined) {
    const target = state.players.find((p) => p.id === detectiveAction.targetId);
    if (target?.role) {
      effects.push({
        type: 'PRIVATE_DETECTIVE_RESULT',
        playerId: detectiveAction.actorId,
        result: {
          targetId: detectiveAction.targetId,
          isMafia: target.role === 'MAFIA',
          nightNumber: state.roundNumber,
        },
      });
    }
  }

  return {
    state: { ...state, players },
    effects,
  };
}

/** True if the doctor protected this exact target on the immediately
 * preceding night (roundNumber - 1). Only the immediately preceding night
 * counts — protecting the same person two nights ago, then someone else,
 * then them again is allowed; only back-to-back repeats are blocked. */
function wasProtectedLastNight(state: FullGameState, targetId: PlayerId, currentRound: number): boolean {
  const previousRound = currentRound - 1;
  if (previousRound < 1) return false;
  return state.nightActions.some(
    (a) => a.actorRole === 'DOCTOR' && a.nightNumber === previousRound && a.targetId === targetId,
  );
}
