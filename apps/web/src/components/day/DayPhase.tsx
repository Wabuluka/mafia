'use client';

// ---------------------------------------------------------------------------
// DayPhase — orchestrates the daytime sequence: a reveal screen (dawn or
// elimination) shown exactly once per transition, then the live
// DAY_DISCUSSION/DAY_VOTE screen underneath.
//
// QUEUE, NOT "LATEST WINS" — READ BEFORE CHANGING THIS FILE:
// The server's phase timer keeps running regardless of whether a client
// has acknowledged a reveal (see scheduler.ts — timing is entirely
// server-driven, never gated on client acks). With short enough phase
// durations (or a slow client), a SECOND `phaseChanged` can legitimately
// arrive before the player has dismissed the first one's reveal — e.g.
// DAY_VOTE resolves (elimination reveal should show), then that night
// resolves too before the player taps through. A naive "show whatever
// `lastPhaseChange` currently is" approach would have the second event's
// arrival silently swap out the first reveal's content mid-display,
// skipping the elimination reveal the player never got to see — this was
// an actual bug caught by an end-to-end multi-client test, not a
// hypothetical. The fix: `useVillageState`'s `phaseChangeQueue` is an
// append-only queue; this component always renders the FRONT entry's
// reveal (if any) and only advances to the next one once the player
// dismisses the current one (`dequeuePhaseChange`), so no transition is
// ever silently dropped — reveals simply queue up and play in order.
// ---------------------------------------------------------------------------

import type { PhaseChangedPayload, PlayerView } from '@mafia/shared';
import { DawnReveal } from './DawnReveal';
import { DiscussionPhase } from './DiscussionPhase';
import { EliminationReveal } from './EliminationReveal';
import { VotingPhase } from './VotingPhase';

export interface DayPhaseProps {
  view: PlayerView;
  lastPhaseChange: PhaseChangedPayload | null;
  phaseChangeQueue: PhaseChangedPayload[];
  dequeuePhaseChange: () => void;
}

export function DayPhase({ view, lastPhaseChange, phaseChangeQueue, dequeuePhaseChange }: DayPhaseProps) {
  const nextReveal = phaseChangeQueue.find(
    (change) => change.previousPhase === 'NIGHT' || change.previousPhase === 'DAY_VOTE',
  );

  if (nextReveal) {
    // Key by a transition identity so React remounts (rather than
    // re-animating in place) when the queue advances to a different
    // transition — each reveal's internal timers (see DawnReveal /
    // EliminationReveal) are meant to start fresh per transition, not
    // resume/interrupt a previous one's.
    const key = `${nextReveal.previousPhase}-${nextReveal.state.roundNumber}`;
    if (nextReveal.previousPhase === 'NIGHT') {
      return (
        <DawnReveal
          key={key}
          outcome={nextReveal.outcome}
          players={nextReveal.state.players}
          onDone={dequeuePhaseChange}
        />
      );
    }
    return (
      <EliminationReveal
        key={key}
        outcome={nextReveal.outcome}
        players={nextReveal.state.players}
        onDone={dequeuePhaseChange}
      />
    );
  }

  if (view.phase === 'DAY_DISCUSSION') {
    return <DiscussionPhase view={view} lastPhaseChange={lastPhaseChange} />;
  }

  if (view.phase === 'DAY_VOTE') {
    return <VotingPhase view={view} lastPhaseChange={lastPhaseChange} />;
  }

  return null;
}
