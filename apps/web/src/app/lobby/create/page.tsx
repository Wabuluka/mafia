'use client';

// ---------------------------------------------------------------------------
// /lobby/create — not a screen a player lingers on; it creates a room via
// the HTTP API and immediately redirects into /lobby/[code]. Kept as its
// own route (rather than doing this inline in the Home screen's button
// handler) so the loading/error states around room creation have a place
// to render without blocking Home's own layout.
// ---------------------------------------------------------------------------

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { ApiError, createOrResumeSession, createRoom } from '@/lib/api';
import { useStoredName } from '@/lib/useStoredName';

export default function CreateRoomPage() {
  const router = useRouter();
  const [storedName] = useStoredName();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      try {
        await createOrResumeSession(storedName || undefined);
        const room = await createRoom();
        if (!cancelled) router.replace(`/lobby/${room.code}`);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : 'Could not create a room. Check your connection and try again.');
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
    // Runs once on mount; storedName is read at that moment (a name
    // change after mount shouldn't re-trigger room creation).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  return (
    <AppShell header={<div className="px-4 py-3"><h1 className="text-lg font-bold">Creating room…</h1></div>}>
      <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
        {error ? (
          <>
            <p className="text-danger">{error}</p>
            <button
              type="button"
              onClick={() => router.push('/')}
              className="min-h-11 rounded-xl bg-white/10 px-5 text-base font-semibold active:bg-white/15"
            >
              Back to Home
            </button>
          </>
        ) : (
          <span
            aria-hidden="true"
            className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent motion-reduce:animate-none"
          />
        )}
      </div>
    </AppShell>
  );
}
