'use client';

// ---------------------------------------------------------------------------
// GameTimeline — renders the ordered gameEvents log (GET /api/games/:id/events)
// as a readable recap: each night's actions, each day's vote breakdown
// (who voted for whom, including abstains), grouped by round. CHAT events
// are deliberately skipped here — a blow-by-blow chat replay isn't what
// "who voted for whom" calls for, and mafia/dead-channel messages
// shouldn't resurface to players who weren't entitled to see them live
// just because the game ended (the events endpoint returns everything
// once COMPLETED, so this is a presentation choice, not a security one).
// ---------------------------------------------------------------------------

import type { GameEvent, GameSummaryPlayer } from '@/lib/api';
import { ROLE_LABEL } from '@/lib/roleLabels';

export interface GameTimelineProps {
  events: GameEvent[];
  players: GameSummaryPlayer[];
}

function nameFor(players: GameSummaryPlayer[], id: string): string {
  return players.find((p) => p.id === id)?.name ?? 'A player';
}

interface RoundGroup {
  roundNumber: number;
  nightActions: Extract<GameEvent, { type: 'NIGHT_ACTION' }>[];
  votes: Extract<GameEvent, { type: 'VOTE' }>[];
}

function groupByRound(events: GameEvent[]): RoundGroup[] {
  const groups = new Map<number, RoundGroup>();

  function groupFor(roundNumber: number): RoundGroup {
    let group = groups.get(roundNumber);
    if (!group) {
      group = { roundNumber, nightActions: [], votes: [] };
      groups.set(roundNumber, group);
    }
    return group;
  }

  for (const event of events) {
    if (event.type === 'NIGHT_ACTION') {
      groupFor(event.payload.action.nightNumber).nightActions.push(event);
    } else if (event.type === 'VOTE') {
      groupFor(event.payload.vote.dayNumber).votes.push(event);
    }
  }

  return [...groups.values()].sort((a, b) => a.roundNumber - b.roundNumber);
}

/** Only the last vote per voter counts for the final tally display (see
 * VotingPhase.tsx — votes are revocable up until the phase ends), but the
 * full change history is still meaningful for a recap, so this keeps
 * every vote event in submission order rather than collapsing to just the
 * final one. */
function describeNightAction(event: Extract<GameEvent, { type: 'NIGHT_ACTION' }>, players: GameSummaryPlayer[]): string {
  const { action } = event.payload;
  const actorName = nameFor(players, action.actorId);
  const roleLabel = ROLE_LABEL[action.actorRole] ?? action.actorRole;
  if (!action.targetId) {
    return `${actorName} (${roleLabel}) took no action.`;
  }
  const targetName = nameFor(players, action.targetId);
  const verb = action.actorRole === 'DOCTOR' ? 'protected' : action.actorRole === 'DETECTIVE' ? 'investigated' : 'targeted';
  return `${actorName} (${roleLabel}) ${verb} ${targetName}.`;
}

function describeVote(event: Extract<GameEvent, { type: 'VOTE' }>, players: GameSummaryPlayer[]): string {
  const { vote } = event.payload;
  const voterName = nameFor(players, vote.voterId);
  if (!vote.targetId) {
    return `${voterName} abstained.`;
  }
  return `${voterName} voted for ${nameFor(players, vote.targetId)}.`;
}

export function GameTimeline({ events, players }: GameTimelineProps) {
  const rounds = groupByRound(events);

  if (rounds.length === 0) {
    return <p className="py-4 text-center text-sm text-base-content/50">No timeline recorded for this game.</p>;
  }

  return (
    <ol className="flex flex-col gap-4">
      {rounds.map((round) => (
        <li key={round.roundNumber} className="rounded-xl bg-elevated p-4">
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-base-content/40">
            Round {round.roundNumber}
          </h4>

          {round.nightActions.length > 0 && (
            <div className="mb-3 flex flex-col gap-1">
              <span className="text-xs font-semibold text-base-content/50">Night</span>
              {round.nightActions.map((event) => (
                <p key={`${event.sequence}`} className="text-sm text-base-content/80">
                  {describeNightAction(event, players)}
                </p>
              ))}
            </div>
          )}

          {round.votes.length > 0 && (
            <div className="flex flex-col gap-1">
              <span className="text-xs font-semibold text-base-content/50">Vote</span>
              {round.votes.map((event) => (
                <p key={`${event.sequence}`} className="text-sm text-base-content/80">
                  {describeVote(event, players)}
                </p>
              ))}
            </div>
          )}

          {round.nightActions.length === 0 && round.votes.length === 0 && (
            <p className="text-sm text-base-content/50">Nothing recorded for this round.</p>
          )}
        </li>
      ))}
    </ol>
  );
}
