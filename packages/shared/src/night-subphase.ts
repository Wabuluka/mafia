// ---------------------------------------------------------------------------
// Night sub-phase sequencing — the single source of truth for "which role
// is prompted next" within a NIGHT phase under the moderator-driven flow
// (see NightSubPhaseSchema in enums.ts). Shared between the engine
// (nightActions.ts's WRONG_SUB_PHASE check), the realtime layer
// (phaseLoop.ts initializing NIGHT, advanceNightSubPhase.ts stepping
// through it, earlyResolution.ts's readiness check), and redact.ts, so all
// four never risk disagreeing about the sequence or which roles get
// skipped.
// ---------------------------------------------------------------------------

import type { NightSubPhase } from './enums';
import type { Player } from './entities';

/** The fixed moderator-prompt order. Deliberately independent from
 * nightActions.ts's NIGHT_ACTING_ROLES, which governs resolution order
 * (doctor's save must be known before the mafia's kill resolves) — the two
 * orderings are allowed to diverge. */
const NIGHT_SUBPHASE_ORDER: readonly Exclude<NightSubPhase, 'COMPLETE'>[] = ['MAFIA', 'DETECTIVE', 'DOCTOR'];

/**
 * Returns the first sub-phase, starting strictly AFTER `from` in
 * NIGHT_SUBPHASE_ORDER (or from the very start, if `from` is undefined),
 * for which a living player holds that role — or `'COMPLETE'` once every
 * remaining role in the order has no living holder. Passing `undefined`
 * for `from` computes the INITIAL sub-phase for a freshly started NIGHT.
 *
 * A role with no living holder (never assigned in a small game, or died on
 * a previous night) is silently skipped — there's no one to prompt, so
 * waiting on it would stall NIGHT forever. This mirrors
 * earlyResolution.ts's existing "vacuously ready" fallback for the old
 * simultaneous-submission model.
 */
export function nextApplicableNightSubPhase(
  players: readonly Pick<Player, 'role' | 'status'>[],
  from: NightSubPhase | undefined,
): NightSubPhase {
  const livingRoles = new Set(players.filter((p) => p.status === 'ALIVE' && p.role).map((p) => p.role));

  const startIndex = from === undefined || from === 'COMPLETE' ? 0 : NIGHT_SUBPHASE_ORDER.indexOf(from) + 1;

  for (let i = startIndex; i < NIGHT_SUBPHASE_ORDER.length; i++) {
    const candidate = NIGHT_SUBPHASE_ORDER[i];
    if (candidate !== undefined && livingRoles.has(candidate)) return candidate;
  }
  return 'COMPLETE';
}
