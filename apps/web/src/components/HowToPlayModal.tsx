'use client';

// ---------------------------------------------------------------------------
// HowToPlayModal — the one place a player can learn (a) the overall rules
// and flow of the game, and (b) if a role has been assigned to them yet,
// exactly what THEIR role does. Reachable from a persistent header button
// (HowToPlayButton) present on the lobby and every in-game phase screen —
// same "small icon button in the header opens a bottom-sheet Modal" pattern
// as GameLogButton/GameLog (see day/GameLog.tsx), so it never competes with
// the phase's own primary action for attention.
//
// `myRole` is optional and BY DESIGN: this same modal serves the lobby
// (before roles are assigned — general rules only, see LobbyPage) and every
// in-game screen (`view.you.role` — see NightPhase/DiscussionPhase/
// VotingPhase). When present, the player's own role card renders first and
// most prominently, since "what am I" is almost always the more urgent
// question than "how does the game work in general" once a game is live.
//
// ICONS: every glyph here is a hand-drawn inline SVG on the shared 20x20
// viewBox — same convention as PlayerTile/Modal/ShareVillageCode elsewhere
// in this app — rather than emoji, which render inconsistently across
// platforms/fonts and don't inherit `currentColor` for tinting against the
// team-colored accents used throughout (see ROLE_ICON_TONE below).
// ---------------------------------------------------------------------------

import type { ReactNode } from 'react';
import { ROLE_DISPLAY_LABEL, ROLE_TEAM, type Role } from '@mafia/shared';
import { Modal } from '@/components/Modal';
import { TEAM_LABEL } from '@/lib/roleLabels';

export interface HowToPlayModalProps {
  open: boolean;
  onClose: () => void;
  /** The local player's own role, if one has been assigned yet (absent in
   * the lobby, before the game starts). When given, it's shown first as
   * "Your role" — see the module header. */
  myRole?: Role;
}

// -----------------------------------------------------------------------
// Icons — one 20x20 viewBox function per glyph, `stroke="currentColor"` so
// each inherits the tone class it's rendered with (team color for roles,
// neutral for phase steps) instead of carrying its own fixed color.
// -----------------------------------------------------------------------

function IconIndicator({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 20 20" className="h-full w-full" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      {children}
    </svg>
  );
}

function MoonIcon() {
  return (
    <IconIndicator>
      <path d="M14.5 11.5A6 6 0 018.5 5.5a6 6 0 106 6z" strokeLinecap="round" strokeLinejoin="round" />
    </IconIndicator>
  );
}

function SunIcon() {
  return (
    <IconIndicator>
      <circle cx="10" cy="10" r="3.25" />
      <path
        d="M10 2.5v2M10 15.5v2M17.5 10h-2M4.5 10h-2M15.3 4.7l-1.4 1.4M6.1 13.9l-1.4 1.4M15.3 15.3l-1.4-1.4M6.1 6.1L4.7 4.7"
        strokeLinecap="round"
      />
    </IconIndicator>
  );
}

function ChatIcon() {
  return (
    <IconIndicator>
      <path
        d="M3 5.5A1.5 1.5 0 014.5 4h11A1.5 1.5 0 0117 5.5v6a1.5 1.5 0 01-1.5 1.5H9l-3.5 3v-3H4.5A1.5 1.5 0 013 11.5v-6z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </IconIndicator>
  );
}

function BallotIcon() {
  return (
    <IconIndicator>
      <path d="M5 3h10a1 1 0 011 1v11.5L13 14l-3 1.5L7 14l-3 1.5V4a1 1 0 011-1z" strokeLinejoin="round" />
      <path d="M7.5 7.5l1.5 1.5 3.5-3.5" strokeLinecap="round" strokeLinejoin="round" />
    </IconIndicator>
  );
}

function VillagerIcon() {
  return (
    <IconIndicator>
      <circle cx="10" cy="6.5" r="2.75" />
      <path d="M4.5 17c0-3.3 2.5-5.5 5.5-5.5s5.5 2.2 5.5 5.5" strokeLinecap="round" />
    </IconIndicator>
  );
}

function MafiaIcon() {
  return (
    <IconIndicator>
      <path d="M10 2.5l6 3v4c0 4-2.6 6.9-6 8-3.4-1.1-6-4-6-8v-4l6-3z" strokeLinejoin="round" />
      <path d="M7.6 10l1.8 1.8 3.2-3.6" strokeLinecap="round" strokeLinejoin="round" />
    </IconIndicator>
  );
}

function DetectiveIcon() {
  return (
    <IconIndicator>
      <circle cx="8.5" cy="8.5" r="4.5" />
      <path d="M15.5 15.5l-3.6-3.6" strokeLinecap="round" />
    </IconIndicator>
  );
}

function DoctorIcon() {
  return (
    <IconIndicator>
      <path d="M8 3h4v3.5h3.5v4H12V14a2 2 0 01-2 2 2 2 0 01-2-2v-3.5H4.5v-4H8V3z" strokeLinejoin="round" />
    </IconIndicator>
  );
}

function JesterIcon() {
  return (
    <IconIndicator>
      <path
        d="M4 5l4.2 3.2a1.8 1.8 0 001.6 0L14 5v6.2a5.8 5.8 0 01-4 5.3 5.8 5.8 0 01-4-5.3V5z"
        strokeLinejoin="round"
      />
      <circle cx="4" cy="4" r="1" fill="currentColor" stroke="none" />
      <circle cx="14" cy="4" r="1" fill="currentColor" stroke="none" />
      <circle cx="9" cy="2.3" r="1" fill="currentColor" stroke="none" />
    </IconIndicator>
  );
}

function InfoIcon() {
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <circle cx="10" cy="10" r="7.25" />
      <path d="M10 9.25v4.25" strokeLinecap="round" />
      <circle cx="10" cy="6.75" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  );
}

const ROLE_ICON: Record<Role, () => ReactNode> = {
  VILLAGER: VillagerIcon,
  MAFIA: MafiaIcon,
  DETECTIVE: DetectiveIcon,
  DOCTOR: DoctorIcon,
  JESTER: JesterIcon,
};

/** Tone classes for each role's icon + badge, matching the team-color
 * convention used elsewhere (RoleDistributionList's TEAM_DOT_CLASS,
 * PlayerTile's mafia accent) — town roles share the village accent, mafia
 * gets the mafia accent, the jester gets its own neutral secondary tone. */
const ROLE_TONE_CLASS: Record<Role, string> = {
  VILLAGER: 'text-village-accent bg-village-accent/10',
  DETECTIVE: 'text-village-accent bg-village-accent/10',
  DOCTOR: 'text-village-accent bg-village-accent/10',
  MAFIA: 'text-mafia-accent bg-mafia-accent/10',
  JESTER: 'text-secondary bg-secondary/10',
};

const ROLE_DESCRIPTION: Record<Role, string> = {
  VILLAGER:
    'No special power — your vote is your only weapon. Watch the discussion closely, and vote out whoever you suspect is Mafia.',
  MAFIA:
    'Each night, agree with your teammates on someone to silence. By day, blend in and steer suspicion elsewhere. Win once the Mafia equal or outnumber the town.',
  DETECTIVE:
    "Each night, investigate one player to learn their team — Town or Mafia, not their exact role. Guide the town's votes with what you learn, without exposing yourself.",
  DOCTOR:
    "Each night, protect one player from the Mafia's kill. You can't protect the same player two nights running.",
  JESTER:
    'You win alone — and only — if the town votes you out. Act just suspicious enough to get eliminated, without giving the act away.',
};

const ROLE_ORDER: Role[] = ['VILLAGER', 'MAFIA', 'DETECTIVE', 'DOCTOR', 'JESTER'];

interface PhaseStep {
  icon: () => ReactNode;
  label: string;
  description: string;
}

const PHASE_STEPS: PhaseStep[] = [
  {
    icon: MoonIcon,
    label: 'Night',
    description: 'Everyone closes their eyes. The Mafia secretly choose a victim; the Detective investigates; the Doctor protects.',
  },
  {
    icon: SunIcon,
    label: 'Dawn',
    description: 'The village learns who, if anyone, was lost overnight.',
  },
  {
    icon: ChatIcon,
    label: 'Discussion',
    description: 'Everyone talks it out and shares suspicions in the open chat.',
  },
  {
    icon: BallotIcon,
    label: 'Vote',
    description: 'The village votes to eliminate one player, or abstains. A tie eliminates no one.',
  },
];

export function HowToPlayModal({ open, onClose, myRole }: HowToPlayModalProps) {
  return (
    <Modal open={open} onClose={onClose} title="How to play">
      <div className="flex flex-col gap-6 pb-2">
        {myRole && (
          <section className="flex flex-col gap-2">
            <SectionLabel>Your role</SectionLabel>
            <RoleCard role={myRole} emphasized />
          </section>
        )}

        <section className="flex flex-col gap-3">
          <SectionLabel>The basics</SectionLabel>
          <ol className="flex flex-col gap-3">
            {PHASE_STEPS.map((step) => (
              <li key={step.label} className="flex gap-3">
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-elevated text-base-content/70">
                  <span className="h-4 w-4">{step.icon()}</span>
                </span>
                <p className="text-sm leading-snug text-base-content/80">
                  <strong className="text-base-content">{step.label}</strong> — {step.description}
                </p>
              </li>
            ))}
          </ol>
          <p className="rounded-xl bg-elevated/60 p-3 text-sm leading-snug text-base-content/60">
            This cycle repeats until one team wins: the <strong className="text-base-content">town</strong> wins by
            eliminating every Mafia member, the <strong className="text-base-content">Mafia</strong> win once they
            equal or outnumber everyone left, and the <strong className="text-base-content">Jester</strong> wins
            alone by getting voted out.
          </p>
        </section>

        <section className="flex flex-col gap-2">
          <SectionLabel>All roles</SectionLabel>
          <div className="flex flex-col gap-2">
            {ROLE_ORDER.filter((role) => role !== myRole).map((role) => (
              <RoleCard key={role} role={role} />
            ))}
          </div>
        </section>
      </div>
    </Modal>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return <h3 className="text-xs font-semibold uppercase tracking-wide text-base-content/40">{children}</h3>;
}

function RoleCard({ role, emphasized = false }: { role: Role; emphasized?: boolean }) {
  const Icon = ROLE_ICON[role];
  return (
    <div
      className={[
        'flex gap-3 rounded-xl p-3',
        emphasized ? 'border border-primary/40 bg-primary/10' : 'bg-elevated',
      ].join(' ')}
    >
      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${ROLE_TONE_CLASS[role]}`}>
        <span className="h-5 w-5">
          <Icon />
        </span>
      </span>
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-1.5">
          <span className="font-semibold text-base-content">{ROLE_DISPLAY_LABEL[role]}</span>
          <span className="text-xs text-base-content/40">· {TEAM_LABEL[ROLE_TEAM[role]]}</span>
        </div>
        <p className="text-sm leading-snug text-base-content/70">{ROLE_DESCRIPTION[role]}</p>
      </div>
    </div>
  );
}

export function HowToPlayButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="How to play"
      className="flex h-9 w-9 items-center justify-center rounded-full bg-base-content/5 text-base-content/70 active:bg-base-content/10"
    >
      <InfoIcon />
    </button>
  );
}
