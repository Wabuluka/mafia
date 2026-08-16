'use client';

// ---------------------------------------------------------------------------
// Home — the app's entry screen: large Create Room / Join Room buttons.
// No game state, no room membership yet; this screen's only job is routing
// the player toward name entry (if needed) and then either room creation
// or the join-code flow.
// ---------------------------------------------------------------------------

import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/AppShell';
import { useStoredName } from '@/lib/useStoredName';

export default function HomePage() {
  const router = useRouter();
  const [storedName] = useStoredName();

  function goToCreate() {
    const target = '/lobby/create';
    router.push(storedName ? target : `/name?next=${encodeURIComponent(target)}`);
  }

  function goToJoin() {
    const target = '/join';
    router.push(storedName ? target : `/name?next=${encodeURIComponent(target)}`);
  }

  return (
    <AppShell
      header={
        <div className="px-4 py-3">
          <h1 className="text-lg font-bold">Mafia</h1>
        </div>
      }
    >
      <div className="flex h-full flex-col items-center justify-center gap-4 px-6">
        <div className="mb-4 flex flex-col items-center gap-1 text-center">
          <span aria-hidden="true" className="text-5xl">
            🔪
          </span>
          <h2 className="text-2xl font-bold">Mafia</h2>
          <p className="text-sm text-base-content/60">A game of trust and betrayal, played in the dark.</p>
        </div>

        <div className="flex w-full max-w-xs flex-col gap-3">
          <button
            type="button"
            onClick={goToCreate}
            className="flex min-h-14 items-center justify-center rounded-2xl bg-primary text-lg font-bold text-primary-content transition-transform active:scale-[0.98] motion-reduce:transition-none"
          >
            Create Room
          </button>
          <button
            type="button"
            onClick={goToJoin}
            className="flex min-h-14 items-center justify-center rounded-2xl bg-white/10 text-lg font-bold text-base-content transition-transform active:scale-[0.98] motion-reduce:transition-none"
          >
            Join Room
          </button>
        </div>
      </div>
    </AppShell>
  );
}
