'use client';

// ---------------------------------------------------------------------------
// DiscussionPhase — the nomination round. DAY_DISCUSSION no longer has
// free-text chat (see server/realtime/handlers/sendChat.ts's DAY-channel
// rejection): every living player publicly nominates one suspect (or
// declines), revocable up until the phase resolves, with a live public
// tally under each tile — see engine/nominations.ts. Once resolved, the
// set of nominated players becomes the ONLY valid DAY_VOTE targets (see
// VotingPhase.tsx's shortlist filtering).
//
// Mirrors VotingPhase.tsx's tap-then-confirm grid pattern closely (staged
// choice, revocable submission, live per-tile tally) — the two phases are
// now structurally similar by design. One deliberate difference: a DEAD
// player still sees the live grid+tally here (read-only, no tile
// interaction) rather than VotingPhase's "watching from beyond" message,
// since spectating who's being suspected is part of the game's spectator
// experience, same as watching chat used to be.
// ---------------------------------------------------------------------------

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PlayerId, PlayerView, PublicPlayer } from '@mafia/shared';
import { ActionBar, ActionButton } from '@/components/ActionBar';
import { ConnectionIndicator } from '@/components/ConnectionIndicator';
import { CountdownRing } from '@/components/CountdownRing';
import { DaySkyBackdrop } from '@/components/DaySkyBackdrop';
import { HostPhaseControls } from '@/components/HostPhaseControls';
import { IdentityBadge } from '@/components/IdentityBadge';
import { HowToPlayButton, HowToPlayModal } from '@/components/HowToPlayModal';
import { PhaseBanner } from '@/components/PhaseBanner';
import { PlayerTile } from '@/components/PlayerTile';
import { useToast } from '@/components/Toast';
import { useSocket } from '@/lib/socket-context';
import { vibrate } from '@/lib/useFeedback';
import { useStagedChoice } from '@/lib/useStagedChoice';
import { useThemeSync } from '@/lib/useThemeSync';
import { GameLog, GameLogButton } from './GameLog';
import { useGameLog } from '@/lib/useGameLog';
import { useUnreadGameLog } from '@/lib/useUnreadGameLog';
import { VoteAvatarStack } from './VoteAvatarStack';

export interface DiscussionPhaseProps {
  view: PlayerView;
  lastPhaseChange: Parameters<typeof useGameLog>[1];
}

const DECLINE_SENTINEL = '__DECLINE__';

export function DiscussionPhase({ view, lastPhaseChange }: DiscussionPhaseProps) {
  useThemeSync('day');
  const { emit, status } = useSocket();
  const toast = useToast();
  const [logOpen, setLogOpen] = useState(false);
  const [howToPlayOpen, setHowToPlayOpen] = useState(false);
  const gameLog = useGameLog(view.villageCode, lastPhaseChange);
  const [logUnread, markLogRead] = useUnreadGameLog(gameLog.length);

  const self = view.players.find((p) => p.id === view.you.playerId);
  const alive = self?.status === 'ALIVE';

  const currentRoundNominations = useMemo(
    () => view.nominations.filter((n) => n.dayNumber === view.roundNumber),
    [view.nominations, view.roundNumber],
  );
  const myExistingNomination = currentRoundNominations.find((n) => n.nominatorId === view.you.playerId);

  // Same "only the never-confirmed gap needs local storage" contract as
  // VotingPhase.tsx's staged choice — a CONFIRMED nomination is already
  // durable in `view.nominations` (public, same as a vote).
  const [stagedFromStorage, setStagedInStorage, clearStagedInStorage] = useStagedChoice(
    view.villageCode,
    view.phase,
    view.roundNumber,
  );
  const [staged, setStagedState] = useState<string | null>(
    myExistingNomination ? (myExistingNomination.targetId ?? DECLINE_SENTINEL) : stagedFromStorage,
  );
  const [submitting, setSubmitting] = useState(false);

  const setStaged = useCallback(
    (value: string | null) => {
      setStagedState(value);
      setStagedInStorage(value);
    },
    [setStagedInStorage],
  );

  const stagedRef = useRef(staged);
  stagedRef.current = staged;

  const toggleStagedTarget = useCallback(
    (playerId: string) => {
      const next = stagedRef.current === playerId ? null : playerId;
      setStaged(next);
    },
    [setStaged],
  );

  useEffect(() => {
    setStagedState(myExistingNomination ? (myExistingNomination.targetId ?? DECLINE_SENTINEL) : stagedFromStorage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.roundNumber, myExistingNomination?.targetId]);

  const nominationsByTarget = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const nomination of currentRoundNominations) {
      if (!nomination.targetId) continue;
      const list = map.get(nomination.targetId) ?? [];
      list.push(nomination.nominatorId);
      map.set(nomination.targetId, list);
    }
    return map;
  }, [currentRoundNominations]);

  const declinedNominatorIds = currentRoundNominations.filter((n) => !n.targetId).map((n) => n.nominatorId);

  useEffect(() => {
    if (myExistingNomination) clearStagedInStorage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myExistingNomination?.targetId]);

  // Confirmation haptic — fires only the moment the server echoes a
  // nomination back for THIS round that wasn't there a render ago (never on
  // mount-with-one-already-recorded, e.g. a reconnect). Mirrors NightPhase's
  // wasActedRef treatment of the same "server confirmed, not optimistic tap"
  // distinction, adapted to this phase's revocable-nomination model (there's
  // no single hasActedThisPhase boolean here — nominations can change, so
  // the ref resets every round, not just once).
  const hadNominationRef = useRef(Boolean(myExistingNomination));
  useEffect(() => {
    const hasNow = Boolean(myExistingNomination);
    if (hasNow && !hadNominationRef.current) vibrate(15);
    hadNominationRef.current = hasNow;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myExistingNomination?.targetId, view.roundNumber]);

  async function handleConfirm() {
    if (!staged || submitting) return;
    setSubmitting(true);
    const targetId = staged === DECLINE_SENTINEL ? undefined : (staged as PlayerId);
    const result = await emit.submitNomination({ villageCode: view.villageCode, targetId });
    setSubmitting(false);
    if (!result.ok) {
      toast.show(result.error.message, { tone: 'danger' });
    } else {
      toast.show(staged === DECLINE_SENTINEL ? 'You declined to nominate anyone.' : 'Your nomination has been cast.', {
        tone: 'success',
      });
    }
  }

  const phaseTimer = view.phaseTimer;
  const hasChanges = staged !== (myExistingNomination ? (myExistingNomination.targetId ?? DECLINE_SENTINEL) : null);

  return (
    <div className="relative flex h-full flex-col">
      <DaySkyBackdrop />

      <div className="relative z-10 flex flex-col gap-3 px-4 py-4">
        <div className="flex items-start justify-between gap-2">
          <PhaseBanner tone="day" label="Discussion" narration="Who do you suspect? Nominate someone before the vote." />
          <div className="flex items-center gap-2">
            <ConnectionIndicator status={status} />
            <IdentityBadge name={self?.name ?? ''} role={view.you.role} isModerator={view.you.isModerator} />
            <HowToPlayButton onClick={() => setHowToPlayOpen(true)} />
            <GameLogButton onClick={() => { setLogOpen(true); markLogRead(); }} hasUnread={logUnread} />
          </div>
        </div>
        {phaseTimer && (
          <div className="flex justify-center">
            <CountdownRing endsAt={phaseTimer.endsAt} durationMs={phaseTimer.durationMs} size={56} strokeWidth={5} />
          </div>
        )}

        <HostPhaseControls view={view} />
      </div>

      <div className="relative z-10 flex flex-1 flex-col overflow-y-auto px-4 pb-4">
        {/* Unlike VotingPhase, a dead player still sees the live grid+tally
         * here (read-only) rather than a generic "watching from beyond"
         * message — see the module header. */}
        <div className="m-auto flex w-full max-w-2xl flex-col gap-4">
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(5.5rem, 1fr))' }}>
            {/* The host/moderator is never nominatable — see
             * Player.isHost's doc comment in @mafia/shared/entities.ts —
             * excluded from the grid entirely, same treatment as
             * NightPhase.tsx's TargetGrid. */}
            {view.players.filter((p) => !p.isHost).map((p) => {
              // The moderator never nominates (see Player.isHost's doc
              // comment) — the grid stays visible to them for moderating
              // context, same as it does for a dead spectator, but no tile
              // is ever tappable on their behalf.
              const isTargetable = alive && !view.you.isModerator && p.status === 'ALIVE' && p.id !== view.you.playerId;
              const nominators = nominationsByTarget.get(p.id) ?? [];
              return (
                <div key={p.id} className="flex flex-col items-center gap-1.5">
                  <NominationTargetTile
                    player={p}
                    isSelf={p.id === view.you.playerId}
                    isTargetable={isTargetable}
                    selected={staged === p.id}
                    onToggle={toggleStagedTarget}
                  />
                  <VoteAvatarStack voterIds={nominators} players={view.players} />
                </div>
              );
            })}
          </div>

          {alive && !view.you.isModerator && (
            <button
              type="button"
              onClick={() => setStaged(staged === DECLINE_SENTINEL ? null : DECLINE_SENTINEL)}
              aria-pressed={staged === DECLINE_SENTINEL}
              className={[
                'flex min-h-14 items-center justify-center gap-2 rounded-2xl border-2 text-base font-semibold transition-colors motion-reduce:transition-none',
                staged === DECLINE_SENTINEL
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-base-content/10 bg-elevated text-base-content/70 active:bg-base-content/5',
              ].join(' ')}
            >
              <span aria-hidden="true">🤷</span>
              Decline to nominate
              {declinedNominatorIds.length > 0 && (
                <span className="text-sm font-normal text-base-content/50">({declinedNominatorIds.length})</span>
              )}
            </button>
          )}
        </div>
      </div>

      {alive && !view.you.isModerator && (
        <div className="relative z-10">
          <ActionBar
            caption={
              staged
                ? hasChanges
                  ? 'Tap Confirm to lock in your choice.'
                  : 'Your nomination has been recorded. You can still change it.'
                : 'Select a player or decline, then confirm.'
            }
          >
            <ActionButton onClick={handleConfirm} disabled={!staged || !hasChanges} loading={submitting}>
              Confirm
            </ActionButton>
          </ActionBar>
        </div>
      )}

      <GameLog open={logOpen} onClose={() => setLogOpen(false)} entries={gameLog} players={view.players} />
      <HowToPlayModal open={howToPlayOpen} onClose={() => setHowToPlayOpen(false)} myRole={view.you.role} />
    </div>
  );
}

interface NominationTargetTileProps {
  player: PublicPlayer;
  isSelf: boolean;
  isTargetable: boolean;
  selected: boolean;
  onToggle: (playerId: PlayerId) => void;
}

function NominationTargetTileImpl({ player, isSelf, isTargetable, selected, onToggle }: NominationTargetTileProps) {
  const handleSelect = useCallback(() => {
    onToggle(player.id);
  }, [onToggle, player.id]);

  return (
    <PlayerTile
      playerId={player.id}
      name={player.name}
      alive={player.status === 'ALIVE'}
      isSelf={isSelf}
      connected={player.connected}
      selected={selected}
      disabled={!isTargetable}
      onSelect={isTargetable ? handleSelect : undefined}
    />
  );
}

/** Same memoization rationale as VotingPhase.tsx's VoteTargetTile — see
 * that component's doc comment for the full "why a custom comparator"
 * explanation, which applies identically here. */
const NominationTargetTile = memo(NominationTargetTileImpl, (prev, next) => {
  return (
    prev.player.id === next.player.id &&
    prev.player.name === next.player.name &&
    prev.player.status === next.player.status &&
    prev.player.connected === next.player.connected &&
    prev.isSelf === next.isSelf &&
    prev.isTargetable === next.isTargetable &&
    prev.selected === next.selected &&
    prev.onToggle === next.onToggle
  );
});
