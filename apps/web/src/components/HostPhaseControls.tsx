'use client';

// ---------------------------------------------------------------------------
// HostPhaseControls — the host/moderator's in-game control strip. Under the
// human-moderator model (see server/realtime/phaseLoop.ts's module header),
// nothing about a phase auto-progresses: a phase resolves and its outcome
// sits in `pendingNarration` until the host reveals it, and the NEXT
// phase's timer sits unstarted until the host explicitly starts it. Every
// live phase screen (NightPhase, DiscussionPhase, VotingPhase) renders this
// at the top for the host, and nothing for anyone else — non-hosts see the
// exact same screens they always have; the moderator flow is additive, not
// a replacement for the normal player experience.
//
// One component for the whole flow (rather than one per phase) because the
// state machine is IDENTICAL everywhere: pendingNarration -> reveal it;
// no timer yet -> start it; timer running -> optionally end the phase
// early. NIGHT gets exactly one extra step layered in front of all of
// that: the moderator-driven sub-sequence (MAFIA -> DETECTIVE -> DOCTOR)
// must reach COMPLETE before there's anything to resolve/narrate at all —
// see @mafia/shared's NightSubPhaseSchema.
// ---------------------------------------------------------------------------

import { useState } from 'react';
import type { ModeratorNightHistoryEntry, ModeratorNightRoleState, PlayerView } from '@mafia/shared';
import { ROLE_LABEL } from '@/lib/roleLabels';
import { useSocket } from '@/lib/socket-context';
import { useToast } from '@/components/Toast';

export interface HostPhaseControlsProps {
  view: PlayerView;
}

const NIGHT_SUBPHASE_PROMPT_LABEL: Record<'MAFIA' | 'DETECTIVE' | 'DOCTOR', string> = {
  MAFIA: 'Prompt the Mafia',
  DETECTIVE: 'Prompt the Detective',
  DOCTOR: 'Prompt the Doctor',
};

/** True only for the player this view belongs to being the host — every
 * field this component acts on (`pendingNarration`, `nightSubPhase`,
 * `phaseTimer`) is already visible/absent per the normal redaction rules,
 * but the CONTROLS themselves must still only render for the host — a
 * non-host calling any of these events would just get NOT_HOST back from
 * the server, but there's no reason to show a button that can only ever
 * fail. */
function isHost(view: PlayerView): boolean {
  return view.players.find((p) => p.id === view.you.playerId)?.isHost ?? false;
}

export function HostPhaseControls({ view }: HostPhaseControlsProps) {
  if (!isHost(view)) return null;
  if (view.phase === 'LOBBY' || view.phase === 'GAME_OVER') return null;

  return <HostPhaseControlsInner view={view} />;
}

function HostPhaseControlsInner({ view }: HostPhaseControlsProps) {
  const { emit } = useSocket();
  const toast = useToast();
  const [narrationDraft, setNarrationDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const pending = view.pendingNarration;
  const draft = narrationDraft ?? pending?.text ?? '';

  async function handleAdvanceNightSubPhase() {
    setBusy(true);
    const result = await emit.advanceNightSubPhase({ villageCode: view.villageCode });
    setBusy(false);
    if (!result.ok) toast.show(result.error.message, { tone: 'danger' });
  }

  async function handleReveal() {
    if (!draft.trim()) return;
    setBusy(true);
    const result = await emit.revealNarration({ villageCode: view.villageCode, text: draft.trim() });
    setBusy(false);
    if (!result.ok) {
      toast.show(result.error.message, { tone: 'danger' });
    } else {
      setNarrationDraft(null);
    }
  }

  async function handleStartTimer() {
    setBusy(true);
    const result = await emit.startPhaseTimer({ villageCode: view.villageCode });
    setBusy(false);
    if (!result.ok) toast.show(result.error.message, { tone: 'danger' });
  }

  async function handleEndPhaseNow() {
    setBusy(true);
    const result = await emit.endPhaseNow({ villageCode: view.villageCode });
    setBusy(false);
    if (!result.ok) toast.show(result.error.message, { tone: 'danger' });
  }

  // Step 1 (NIGHT only): walk the moderator-driven sub-sequence before
  // there's anything to resolve/narrate — see NightSubPhaseSchema.
  if (view.phase === 'NIGHT' && view.nightSubPhase && view.nightSubPhase !== 'COMPLETE') {
    const roleLabel = ROLE_LABEL[view.nightSubPhase] ?? view.nightSubPhase;
    const roleStates = view.you.moderatorNightView?.currentRound?.roles ?? [];
    return (
      <HostCard tone="night" icon="🌙" eyebrow="Moderator · night sequence">
        <p className="text-base font-semibold text-base-content">
          Waiting on the <span className="text-mafia-accent">{roleLabel}</span>
        </p>
        <p className="text-sm text-base-content/60">Once they&apos;ve acted, advance to call on the next role.</p>
        {roleStates.length > 0 && <ModeratorNightRoster roles={roleStates} />}
        <HostButton onClick={handleAdvanceNightSubPhase} disabled={busy} loading={busy}>
          {NIGHT_SUBPHASE_PROMPT_LABEL[view.nightSubPhase]}
        </HostButton>
      </HostCard>
    );
  }

  // Step 2: a phase has resolved and is waiting for the host to reveal
  // what happened before anyone sees it — the highest-stakes action in this
  // component (irreversible, broadcasts to the whole village), so it gets
  // the strongest visual treatment: the primary tone, an urgency eyebrow,
  // and the only state where the action button reads as a distinct verb
  // ("Reveal") rather than a neutral "advance".
  if (pending) {
    // The most recent resolved night's recap, shown above the narration
    // editor when we're revealing a NIGHT — so the moderator can announce
    // saves/kills/investigations accurately. `history` is oldest-first;
    // its last entry is the night that just resolved.
    const nightRecap =
      pending.forPhase === 'NIGHT'
        ? view.you.moderatorNightView?.history.at(-1)
        : undefined;
    return (
      <HostCard tone="reveal" icon="📣" eyebrow="Ready to reveal">
        {nightRecap && <ModeratorNightRecap entry={nightRecap} />}
        <p className="text-sm text-base-content/70">Edit the wording if you like, then share it with everyone.</p>
        <textarea
          value={draft}
          onChange={(e) => setNarrationDraft(e.target.value)}
          rows={3}
          maxLength={1000}
          className="w-full resize-none rounded-xl border border-primary/25 bg-elevated-2 px-3 py-2.5 text-sm leading-relaxed text-base-content outline-none focus:border-primary"
          placeholder="What happened…"
        />
        <HostButton onClick={handleReveal} disabled={busy || !draft.trim()} loading={busy}>
          Reveal to everyone
        </HostButton>
      </HostCard>
    );
  }

  // Step 3: the phase is live with no timer running yet — waiting for the
  // host to kick off the countdown.
  if (!view.phaseTimer) {
    return (
      <HostCard tone="neutral" icon="⏱" eyebrow="Moderator">
        <p className="text-sm text-base-content/70">Everyone&apos;s ready when you are.</p>
        <HostButton onClick={handleStartTimer} disabled={busy} loading={busy}>
          Start the timer
        </HostButton>
      </HostCard>
    );
  }

  // Step 4: the phase's timer is running — the host may still force it to
  // resolve early (e.g. discussion has clearly wrapped up). Lowest-stakes,
  // most-frequent state — deliberately the quietest treatment: a compact
  // single-line row, secondary button styling, no eyebrow/icon competing
  // for attention while the phase is simply running normally.
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl bg-base-content/[0.04] px-4 py-2">
      <span className="text-xs text-base-content/45">Phase in progress</span>
      <button
        type="button"
        onClick={handleEndPhaseNow}
        disabled={busy}
        className="min-h-8 shrink-0 rounded-lg px-3 text-xs font-semibold text-base-content/70 underline decoration-base-content/25 underline-offset-2 transition-opacity motion-reduce:transition-none active:opacity-60 disabled:opacity-40"
      >
        End phase now
      </button>
    </div>
  );
}

function HostCard({
  tone,
  icon,
  eyebrow,
  children,
}: {
  tone: 'night' | 'reveal' | 'neutral';
  icon: string;
  eyebrow: string;
  children: React.ReactNode;
}) {
  const toneClasses =
    tone === 'night'
      ? 'bg-mafia-accent/10 ring-1 ring-inset ring-mafia-accent/20'
      : tone === 'reveal'
        ? 'bg-primary/10 ring-1 ring-inset ring-primary/30'
        : 'bg-base-content/5 ring-1 ring-inset ring-base-content/10';
  const eyebrowColor = tone === 'night' ? 'text-mafia-accent' : tone === 'reveal' ? 'text-primary' : 'text-base-content/50';

  return (
    <div className={`flex flex-col gap-2.5 rounded-2xl px-4 py-3.5 ${toneClasses}`}>
      <div className="flex items-center gap-1.5">
        <span aria-hidden="true" className="text-sm leading-none">
          {icon}
        </span>
        <span className={`text-xs font-semibold uppercase tracking-wide ${eyebrowColor}`}>{eyebrow}</span>
      </div>
      {children}
    </div>
  );
}

/** Live acted-status + target for each acting role this night — the panel
 * the moderator reads to know whether it's safe to advance. Shows the
 * actual choice inline (not just a checkmark): the moderator is already a
 * full spectator, and the reveal recap shows the same detail. */
function ModeratorNightRoster({ roles }: { roles: ModeratorNightRoleState[] }) {
  return (
    <ul className="flex flex-col gap-1 rounded-xl bg-base-content/[0.04] px-3 py-2 text-sm">
      {roles.map((r) => {
        const label = ROLE_LABEL[r.role] ?? r.role;
        if (!r.hasLivingHolder) {
          return (
            <li key={r.role} className="flex items-center justify-between gap-2 text-base-content/35">
              <span>{label}</span>
              <span className="text-xs">not in play</span>
            </li>
          );
        }
        const verb = r.role === 'MAFIA' ? 'targeting' : r.role === 'DETECTIVE' ? 'investigating' : 'protecting';
        return (
          <li key={r.role} className="flex items-center justify-between gap-2">
            <span className="text-base-content/70">{label}</span>
            {r.submitted ? (
              <span className="text-right text-base-content">
                <span aria-hidden="true" className="mr-1 text-mafia-accent">
                  ✓
                </span>
                {r.targetName ? (
                  <>
                    {verb} <span className="font-semibold">{r.targetName}</span>
                  </>
                ) : (
                  'skipped'
                )}
              </span>
            ) : (
              <span className="text-xs text-base-content/40">waiting…</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Structured kill / save / death / investigation recap for one resolved
 * night — rendered above the narration editor while revealing a NIGHT, and
 * reused as each row of the moderator's night-history log. */
export function ModeratorNightRecap({ entry }: { entry: ModeratorNightHistoryEntry }) {
  const Row = ({ label, value }: { label: string; value: React.ReactNode }) => (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-base-content/50">{label}</span>
      <span className="text-right text-base-content">{value}</span>
    </div>
  );
  return (
    <div className="flex flex-col gap-1 rounded-xl bg-base-content/[0.04] px-3 py-2.5 text-sm">
      <Row
        label="Mafia targeted"
        value={entry.mafiaTargetName ?? <span className="text-base-content/40">no kill</span>}
      />
      {entry.doctorTargetName && (
        <Row
          label="Doctor protected"
          value={
            <>
              {entry.doctorTargetName}
              {entry.saveLanded && <span className="ml-1.5 font-semibold text-mafia-accent">— SAVED</span>}
            </>
          }
        />
      )}
      <Row
        label="Result"
        value={
          entry.diedName ? (
            <span className="font-semibold">
              {entry.diedName} died{entry.diedRole ? ` (${ROLE_LABEL[entry.diedRole] ?? entry.diedRole})` : ''}
            </span>
          ) : (
            'No one died'
          )
        }
      />
      {entry.detectiveTargetName && (
        <Row
          label="Detective checked"
          value={
            <>
              {entry.detectiveTargetName}
              <span className="ml-1.5 text-base-content/60">
                → {entry.detectiveFoundMafia ? 'mafia' : 'not mafia'}
              </span>
            </>
          }
        />
      )}
    </div>
  );
}

function HostButton({
  children,
  onClick,
  disabled,
  loading = false,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex min-h-10 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-content transition-[transform,opacity] motion-reduce:transition-none active:scale-[0.98] active:opacity-90 disabled:opacity-40 disabled:active:scale-100"
    >
      {loading && (
        <span
          aria-hidden="true"
          className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none"
        />
      )}
      {children}
    </button>
  );
}
