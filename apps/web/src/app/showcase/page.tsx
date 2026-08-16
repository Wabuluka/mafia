'use client';

// ---------------------------------------------------------------------------
// /showcase — a single route rendering every design-system primitive at
// once, with no game logic behind any of it (props are hand-fed constants
// or trivial local state purely to demonstrate interaction). This is the
// visual foundation prompt's deliverable: something to look at before any
// real game screen exists.
// ---------------------------------------------------------------------------

import { useState } from 'react';
import { ActionBar, ActionButton } from '@/components/ActionBar';
import { AppShell } from '@/components/AppShell';
import { CountdownRing } from '@/components/CountdownRing';
import { Modal } from '@/components/Modal';
import { PhaseBanner } from '@/components/PhaseBanner';
import { PlayerTile } from '@/components/PlayerTile';
import { useToast } from '@/components/Toast';

const SAMPLE_PLAYERS = [
  { id: 'p1', name: 'Alex', alive: true, isHost: true, connected: true },
  { id: 'p2', name: 'Bailey Jordan', alive: true, connected: true },
  { id: 'p3', name: 'Casey', alive: false, connected: true },
  { id: 'p4', name: 'Drew', alive: true, connected: false },
  { id: 'p5', name: 'Emerson', alive: true, connected: true },
  { id: 'p6', name: 'Finley', alive: false, connected: true },
];

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3 border-b border-white/5 pb-8">
      <div>
        <h2 className="text-xl font-bold">{title}</h2>
        {description && <p className="text-sm text-base-content/60">{description}</p>}
      </div>
      {children}
    </section>
  );
}

function Swatch({ name, className }: { name: string; className: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className={`h-14 w-full rounded-xl border border-white/10 ${className}`} />
      <span className="text-xs text-base-content/60">{name}</span>
    </div>
  );
}

function ShowcaseContent() {
  const [selectedPlayer, setSelectedPlayer] = useState<string | null>('p2');
  const [modalOpen, setModalOpen] = useState(false);
  const toast = useToast();
  const [ringEndsAt] = useState(() => Date.now() + 45_000);

  return (
    <div className="flex flex-col gap-8 px-4 py-6">
      <Section title="Color tokens" description="Semantic tokens, not raw Tailwind color classes.">
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
          <Swatch name="surface" className="bg-surface" />
          <Swatch name="elevated" className="bg-elevated" />
          <Swatch name="elevated-2" className="bg-elevated-2" />
          <Swatch name="danger" className="bg-danger" />
          <Swatch name="mafia-accent" className="bg-mafia-accent" />
          <Swatch name="village-accent" className="bg-village-accent" />
        </div>
      </Section>

      <Section title="Typography scale" description="16px body floor stops iOS zoom-on-focus; every step is legible at arm's length.">
        <div className="flex flex-col gap-2">
          <p className="text-3xl font-bold">3xl — Countdown numeral</p>
          <p className="text-2xl font-bold">2xl — Phase banner</p>
          <p className="text-xl font-semibold">xl — Section header</p>
          <p className="text-lg">lg — Player name / emphasized body</p>
          <p className="text-base">base (16px) — Body text floor</p>
          <p className="text-sm text-base-content/70">sm — Secondary text</p>
          <p className="text-xs text-base-content/50">xs — Meta / timestamps only</p>
        </div>
      </Section>

      <Section title="PhaseBanner">
        <div className="flex flex-col gap-3">
          <PhaseBanner tone="night" label="Night falls" narration="The town sleeps. Someone is not." />
          <PhaseBanner tone="day" label="Discussion" narration="Who do you suspect?" />
          <PhaseBanner tone="vote" label="Time to vote" narration="Choose wisely — a tie saves everyone." />
          <PhaseBanner tone="neutral" label="Lobby" narration="Waiting for the host to start." />
        </div>
      </Section>

      <Section title="CountdownRing" description="Counts down from an absolute server timestamp, never a local duration.">
        <div className="flex items-center gap-6">
          <CountdownRing endsAt={ringEndsAt} durationMs={45_000} />
          <CountdownRing endsAt={Date.now() + 8_000} durationMs={45_000} size={56} strokeWidth={5} />
        </div>
      </Section>

      <Section title="PlayerTile" description="Tap a tile to select it. Dead/disconnected states are visually distinct signals.">
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
          {SAMPLE_PLAYERS.map((p) => (
            <PlayerTile
              key={p.id}
              playerId={p.id}
              name={p.name}
              alive={p.alive}
              isHost={p.id === 'p1'}
              isSelf={p.id === 'p5'}
              connected={p.connected}
              selected={selectedPlayer === p.id}
              disabled={!p.alive}
              onSelect={() => setSelectedPlayer(p.id)}
            />
          ))}
        </div>
      </Section>

      <Section title="Modal (bottom sheet)">
        <ActionButton fullWidth={false} onClick={() => setModalOpen(true)}>
          Open modal
        </ActionButton>
        <Modal
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          title="Confirm your vote"
          footer={
            <div className="flex gap-2">
              <ActionButton variant="neutral" onClick={() => setModalOpen(false)}>
                Cancel
              </ActionButton>
              <ActionButton variant="danger" onClick={() => setModalOpen(false)}>
                Confirm
              </ActionButton>
            </div>
          }
        >
          <p className="text-base-content/80">
            You are about to vote to eliminate <span className="font-semibold text-base-content">Bailey Jordan</span>.
            This cannot be undone once the vote resolves.
          </p>
        </Modal>
      </Section>

      <Section title="Toast">
        <div className="flex flex-wrap gap-2">
          <ActionButton fullWidth={false} variant="neutral" onClick={() => toast.show('Reconnecting to the server…')}>
            Info toast
          </ActionButton>
          <ActionButton
            fullWidth={false}
            variant="neutral"
            onClick={() => toast.show('Your vote was recorded.', { tone: 'success' })}
          >
            Success toast
          </ActionButton>
          <ActionButton
            fullWidth={false}
            variant="neutral"
            onClick={() => toast.show('Connection lost. Retrying…', { tone: 'danger' })}
          >
            Danger toast
          </ActionButton>
        </div>
      </Section>

      <Section
        title="AppShell + ActionBar"
        description="This entire page is already rendered inside an AppShell — scroll up to see the fixed header, and the ActionBar below is fixed to the bottom within thumb reach."
      >
        <p className="text-sm text-base-content/60">
          See the fixed bottom bar with primary/neutral/danger action buttons.
        </p>
      </Section>
    </div>
  );
}

export default function ShowcasePage() {
  return (
    <AppShell
      header={
        <div className="flex items-center justify-between px-4 py-3">
          <h1 className="text-lg font-bold">Component Showcase</h1>
          <span className="rounded-full bg-white/5 px-2.5 py-1 text-xs text-base-content/60">
            No game logic
          </span>
        </div>
      }
      actionBar={
        <ActionBar caption="Fixed action bar — always within thumb reach">
          <ActionButton variant="neutral">Leave</ActionButton>
          <ActionButton variant="primary">Ready up</ActionButton>
        </ActionBar>
      }
    >
      <ShowcaseContent />
    </AppShell>
  );
}
