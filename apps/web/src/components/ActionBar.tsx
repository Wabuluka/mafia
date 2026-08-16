'use client';

// ---------------------------------------------------------------------------
// ActionBar — the fixed bottom action region within thumb reach, meant to
// be the AppShell's `actionBar` slot (see AppShell.tsx). Handles the
// iOS home-indicator safe area itself so callers never need to think about
// `env(safe-area-inset-bottom)` — they just pass buttons.
// ---------------------------------------------------------------------------

import type { ReactNode } from 'react';

export interface ActionBarProps {
  children: ReactNode;
  /** A one-line status/context string shown above the buttons — e.g.
   * "3 of 6 players ready". Optional. */
  caption?: string;
}

export function ActionBar({ children, caption }: ActionBarProps) {
  return (
    <div className="border-t border-white/5 bg-elevated pb-safe-bottom">
      <div className="flex flex-col gap-2 px-4 pt-3">
        {caption && <p className="text-center text-sm text-base-content/60">{caption}</p>}
        <div className="flex gap-2 pb-3">{children}</div>
      </div>
    </div>
  );
}

export interface ActionButtonProps {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'danger' | 'neutral';
  disabled?: boolean;
  loading?: boolean;
  fullWidth?: boolean;
}

const VARIANT_CLASSES: Record<NonNullable<ActionButtonProps['variant']>, string> = {
  primary: 'bg-primary text-primary-content active:brightness-90',
  danger: 'bg-danger text-white active:brightness-90',
  neutral: 'bg-white/10 text-base-content active:bg-white/15',
};

/** A tap-target-correct button for use inside ActionBar. Minimum 44px
 * height (Apple's HIG floor) regardless of content, since these buttons
 * are the primary way a player interacts during a live phase. */
export function ActionButton({
  children,
  onClick,
  variant = 'primary',
  disabled = false,
  loading = false,
  fullWidth = true,
}: ActionButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || loading}
      className={[
        'flex min-h-11 items-center justify-center gap-2 rounded-xl px-5 text-base font-semibold transition-[transform,opacity] motion-reduce:transition-none',
        'active:scale-[0.98] disabled:opacity-40 disabled:active:scale-100',
        fullWidth ? 'flex-1' : '',
        VARIANT_CLASSES[variant],
      ].join(' ')}
    >
      {loading && (
        <span
          aria-hidden="true"
          className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none"
        />
      )}
      {children}
    </button>
  );
}
