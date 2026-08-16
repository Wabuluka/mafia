'use client';

// ---------------------------------------------------------------------------
// Name entry — a single field, remembered in localStorage for return
// visits (see lib/useStoredName.ts). Reached from Home only when no name
// is stored yet; `?next=` carries where to go once a name is chosen so
// this screen stays a generic detour rather than hardcoding "always go to
// create" or "always go to join".
// ---------------------------------------------------------------------------

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { ActionBar, ActionButton } from '@/components/ActionBar';
import { useStoredName } from '@/lib/useStoredName';

const MAX_NAME_LENGTH = 24;

function NameEntryForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [, setStoredName] = useStoredName();
  const [name, setName] = useState('');

  const trimmed = name.trim();
  const valid = trimmed.length > 0 && trimmed.length <= MAX_NAME_LENGTH;
  const next = searchParams.get('next') ?? '/';

  function handleContinue() {
    if (!valid) return;
    setStoredName(trimmed);
    router.push(next);
  }

  return (
    <AppShell
      header={
        <div className="flex items-center gap-2 px-4 py-3">
          <button type="button" onClick={() => router.back()} aria-label="Back" className="flex h-9 w-9 items-center justify-center rounded-full active:bg-white/10">
            <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 4l-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <h1 className="text-lg font-bold">What&apos;s your name?</h1>
        </div>
      }
      actionBar={
        <ActionBar>
          <ActionButton onClick={handleContinue} disabled={!valid}>
            Continue
          </ActionButton>
        </ActionBar>
      }
    >
      <div className="flex flex-col gap-3 px-6 py-8">
        <p className="text-sm text-base-content/60">
          This is what other players will see. We&apos;ll remember it for next time.
        </p>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value.slice(0, MAX_NAME_LENGTH))}
          onKeyDown={(e) => e.key === 'Enter' && handleContinue()}
          placeholder="Your name"
          maxLength={MAX_NAME_LENGTH}
          autoFocus
          autoComplete="off"
          className="min-h-14 rounded-2xl border-2 border-white/10 bg-elevated px-4 text-lg text-base-content outline-none focus:border-primary"
        />
        <span className="self-end text-xs text-base-content/40">
          {trimmed.length}/{MAX_NAME_LENGTH}
        </span>
      </div>
    </AppShell>
  );
}

export default function NameEntryPage() {
  // useSearchParams needs a Suspense boundary in the App Router.
  return (
    <Suspense fallback={null}>
      <NameEntryForm />
    </Suspense>
  );
}
