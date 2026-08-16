'use client';

// ---------------------------------------------------------------------------
// NightPhase — the night-phase screen. This is where redaction is most
// visible in the UI, so read this before changing anything here.
//
// STRUCTURAL PARITY, ON PURPOSE: every role renders through the exact same
// shell (NightSkyBackdrop -> PhaseBanner -> CountdownRing -> ONE content
// card in the same position with the same padding). A villager's content
// card is a waiting message; an acting role's content card is a
// TargetGrid. Same card, same size class, same position in the layout —
// deliberately, so a player glancing at a neighbor's screen sees "a phone
// showing a dark screen with a card on it" in every case, never a shape
// that gives away "this person has something to do." The ACTUAL data
// difference (what's inside the card) is real; the SHAPE of the screen
// around it is identical. Never add a role-specific top-level layout
// change here — extend the shared shell instead.
//
// OPTIMISTIC UI: staging a target (tap) is always local-only — see
// TargetGrid's own header comment. Pressing Confirm immediately reflects
// the submission as "sent" (locks the grid, shows a pending state) before
// the server acknowledges; if the ack comes back `ok: false`, the staged
// selection and lock are rolled back and the rejection reason is shown as
// a toast, so the player can immediately try again rather than being
// stuck looking submitted while nothing actually happened server-side.
// ---------------------------------------------------------------------------

import { useEffect, useState } from 'react';
import type { ChatMessage, PlayerId, PlayerView } from '@mafia/shared';
import { ActionBar, ActionButton } from '@/components/ActionBar';
import { CountdownRing } from '@/components/CountdownRing';
import { DetectiveResultCard } from '@/components/DetectiveResultCard';
import { MafiaChatPanel } from '@/components/MafiaChatPanel';
import { MafiaTally } from '@/components/MafiaTally';
import { NightSkyBackdrop } from '@/components/NightSkyBackdrop';
import { PhaseBanner } from '@/components/PhaseBanner';
import { TargetGrid, type TargetGridPlayer } from '@/components/TargetGrid';
import { useToast } from '@/components/Toast';
import { useSocket } from '@/lib/socket-context';

export interface NightPhaseProps {
  view: PlayerView;
}

interface BuildTargetGridPlayersOptions {
  accentTeammateIds?: Set<string>;
  cornerLabelFor?: (id: string) => string | undefined;
  disabledReasonFor?: (id: string) => string | undefined;
}

function buildTargetGridPlayers(view: PlayerView, options: BuildTargetGridPlayersOptions = {}): TargetGridPlayer[] {
  const { accentTeammateIds, cornerLabelFor, disabledReasonFor } = options;
  return view.players.map((p) => ({
    ...p,
    isSelf: p.id === view.you.playerId,
    accent: accentTeammateIds?.has(p.id) ? 'mafia' : null,
    cornerLabel: cornerLabelFor?.(p.id),
    disabledReason: disabledReasonFor?.(p.id),
  }));
}

export function NightPhase({ view }: NightPhaseProps) {
  const { emit } = useSocket();
  const toast = useToast();

  const [stagedTargetId, setStagedTargetId] = useState<PlayerId | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Locked once a submission is confirmed and NOT rejected — the whole
  // grid disables so the player can't accidentally submit twice; only a
  // fresh round (roundNumber change) or a rejection unlocks it again.
  const [locked, setLocked] = useState(view.you.hasActedThisPhase);

  // hasActedThisPhase flips server-side once an action lands — treat that
  // as the ground truth for "locked", overriding local optimistic state
  // (covers a reconnect/resync landing mid-phase with an action already
  // recorded from before the drop).
  useEffect(() => {
    setLocked(view.you.hasActedThisPhase);
    if (view.you.hasActedThisPhase) setSubmitting(false);
  }, [view.you.hasActedThisPhase, view.roundNumber]);

  // Reset staging at the start of every new round.
  useEffect(() => {
    setStagedTargetId(null);
  }, [view.roundNumber]);

  async function handleConfirm() {
    if (!stagedTargetId || locked || submitting) return;

    const previousLocked = locked;
    setSubmitting(true);
    setLocked(true); // optimistic: lock immediately so a double-tap can't double-submit

    const result = await emit.submitNightAction({ villageCode: view.villageCode, targetId: stagedTargetId });

    setSubmitting(false);

    if (!result.ok) {
      // Rollback: unlock and keep the staged target selected so the
      // player can immediately see what was rejected and retry or change it.
      setLocked(previousLocked);
      toast.show(result.error.message, { tone: 'danger' });
    } else {
      toast.show('Your choice has been made.', { tone: 'success' });
    }
  }

  const role = view.you.role;
  const self = view.players.find((p) => p.id === view.you.playerId);
  const alive = self?.status === 'ALIVE';

  const phaseTimer = view.phaseTimer;

  return (
    <div className="relative flex h-full flex-col">
      <NightSkyBackdrop />

      <div className="relative z-10 flex flex-col gap-4 px-4 py-4">
        <PhaseBanner
          tone="night"
          label="The town is asleep"
          narration={roleNarration(role, alive)}
        />

        {phaseTimer && (
          <div className="flex justify-center">
            <CountdownRing endsAt={phaseTimer.endsAt} durationMs={phaseTimer.durationMs} />
          </div>
        )}
      </div>

      <div className="relative z-10 flex-1 overflow-y-auto px-4 pb-4">
        {/* The one content card every role renders, in the same position —
         * see the module header. Its CONTENTS differ by role/alive-state;
         * its presence, size, and placement never do. */}
        <div className="flex min-h-[16rem] flex-col gap-4 rounded-2xl bg-elevated/40 p-4">
          {!alive ? (
            <DeadNightContent view={view} />
          ) : role === 'MAFIA' ? (
            <MafiaNightContent
              view={view}
              stagedTargetId={stagedTargetId}
              onStage={setStagedTargetId}
              locked={locked}
            />
          ) : role === 'DETECTIVE' ? (
            <DetectiveNightContent view={view} stagedTargetId={stagedTargetId} onStage={setStagedTargetId} locked={locked} />
          ) : role === 'DOCTOR' ? (
            <DoctorNightContent view={view} stagedTargetId={stagedTargetId} onStage={setStagedTargetId} locked={locked} />
          ) : (
            <WaitingNightContent />
          )}
        </div>
      </div>

      {alive && (role === 'MAFIA' || role === 'DETECTIVE' || role === 'DOCTOR') && (
        <div className="relative z-10">
          <ActionBar
            caption={
              locked
                ? 'Your choice has been made. Waiting for the night to end…'
                : stagedTargetId
                  ? 'Tap Confirm to lock in your choice.'
                  : 'Select a player, then confirm.'
            }
          >
            <ActionButton onClick={handleConfirm} disabled={!stagedTargetId || locked} loading={submitting}>
              Confirm
            </ActionButton>
          </ActionBar>
        </div>
      )}
    </div>
  );
}

function roleNarration(role: string | undefined, alive: boolean): string {
  if (!alive) return 'You are no longer among the living, but you may watch.';
  switch (role) {
    case 'MAFIA':
      return 'Choose who your family will silence tonight.';
    case 'DETECTIVE':
      return 'Choose someone to investigate.';
    case 'DOCTOR':
      return 'Choose someone to protect from harm.';
    default:
      return 'Everyone is asleep. Something is happening in the dark.';
  }
}

/** The villager (and any other non-acting, living role's) content —
 * structurally the SAME card shape as every acting role's grid, just with
 * a waiting message instead of a grid. See the module header for why this
 * parity matters. */
function WaitingNightContent() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
      <span aria-hidden="true" className="text-4xl">
        😴
      </span>
      <p className="text-base-content/60">You have nothing to do tonight.</p>
      <p className="text-sm text-base-content/40">Try to get some sleep.</p>
    </div>
  );
}

function DeadNightContent({ view }: { view: PlayerView }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
      <span aria-hidden="true" className="text-4xl">
        👻
      </span>
      <p className="text-base-content/60">You are watching from beyond.</p>
      {view.chatLog.some((m) => m.channel === 'DEAD') && (
        <p className="text-sm text-base-content/40">Check the dead chat to talk with other spirits.</p>
      )}
    </div>
  );
}

interface RoleNightContentProps {
  view: PlayerView;
  stagedTargetId: PlayerId | null;
  onStage: (id: PlayerId | null) => void;
  locked: boolean;
}

function MafiaNightContent({ view, stagedTargetId, onStage, locked }: RoleNightContentProps) {
  const { emit } = useSocket();
  const teammateIds = new Set(view.you.mafiaTeammateIds ?? []);
  const players = buildTargetGridPlayers(view, { accentTeammateIds: teammateIds });
  const mafiaMessages = view.chatLog.filter((m: ChatMessage) => m.channel === 'MAFIA');

  return (
    <div className="flex flex-col gap-4">
      <TargetGrid players={players} stagedTargetId={stagedTargetId} onStage={onStage} disabled={locked} />
      {view.you.mafiaNightTargets && (
        <MafiaTally targets={view.you.mafiaNightTargets} players={view.players} selfPlayerId={view.you.playerId} />
      )}
      <MafiaChatPanel
        messages={mafiaMessages}
        selfPlayerId={view.you.playerId}
        onSend={(body) => void emit.sendChat({ villageCode: view.villageCode, body })}
      />
    </div>
  );
}

function DetectiveNightContent({ view, stagedTargetId, onStage, locked }: RoleNightContentProps) {
  const players = buildTargetGridPlayers(view);
  return (
    <div className="flex flex-col gap-4">
      <TargetGrid players={players} stagedTargetId={stagedTargetId} onStage={onStage} disabled={locked} />
      <DetectiveResultCard results={view.you.detectiveResults ?? []} players={view.players} />
    </div>
  );
}

function DoctorNightContent({ view, stagedTargetId, onStage, locked }: RoleNightContentProps) {
  const lastProtectedId = view.you.lastProtectedPlayerId;
  const players = buildTargetGridPlayers(view, {
    disabledReasonFor: (id) => (id === lastProtectedId ? 'Protected last night' : undefined),
  });
  return (
    <TargetGrid players={players} stagedTargetId={stagedTargetId} onStage={onStage} disabled={locked} />
  );
}
