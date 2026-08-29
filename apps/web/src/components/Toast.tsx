'use client';

// ---------------------------------------------------------------------------
// Toast — a single top-of-screen notification, with a Context-based
// provider so any component can trigger one via `useToast().show(...)`
// without prop-drilling a callback down through the tree. Auto-dismisses
// after a duration, and is dismissible by tap.
//
// ONE AT A TIME, BY DESIGN: only ever one toast is shown. A `show()` call
// while a previous toast is still visible REPLACES it outright (new
// message, new tone, timer restarted from zero) rather than stacking a
// second one below/above it — multiple simultaneous alerts were confusing
// during rapid bursts of events (e.g. several players joining/leaving in
// quick succession), and a replaced message is assumed less costly than a
// pile of overlapping ones. If a message is important enough to guarantee
// the player sees it, don't rely on toast — this is a transient, replaceable
// notice, not a queue or a log (see GameLog for the persistent equivalent
// used during a phase).
// ---------------------------------------------------------------------------

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

export type ToastTone = 'info' | 'success' | 'danger';

interface ToastRecord {
  id: number;
  message: string;
  tone: ToastTone;
}

export interface ToastOptions {
  tone?: ToastTone;
  /** Milliseconds before auto-dismiss. */
  durationMs?: number;
}

interface ToastContextValue {
  show: (message: string, options?: ToastOptions) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const DEFAULT_DURATION_MS = 3500;

const TONE_CLASSES: Record<ToastTone, string> = {
  info: 'bg-elevated-2 text-base-content',
  success: 'bg-village-accent/20 text-village-accent',
  danger: 'bg-danger/20 text-danger',
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastRecord | null>(null);
  const nextId = useRef(0);
  // Tracks the auto-dismiss timer so a new `show()` can cancel whatever
  // the PREVIOUS toast scheduled — without this, replacing a toast still
  // visible would leave its old timer running, which could dismiss the
  // NEW toast early (or, if the new one runs longer, fire harmlessly late,
  // but the early-dismiss case is the real bug this guards against).
  const dismissTimer = useRef<number | undefined>(undefined);

  const dismiss = useCallback((id: number) => {
    setToast((prev) => (prev?.id === id ? null : prev));
  }, []);

  const show = useCallback(
    (message: string, options?: ToastOptions) => {
      window.clearTimeout(dismissTimer.current);

      const id = nextId.current++;
      const tone = options?.tone ?? 'info';
      setToast({ id, message, tone });
      dismissTimer.current = window.setTimeout(() => dismiss(id), options?.durationMs ?? DEFAULT_DURATION_MS);
    },
    [dismiss],
  );

  const value = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={value}>
      {children}

      {/* Sits below the safe-area top inset, above the app header's
       * z-index (see AppShell.tsx) so the toast is never hidden behind it.
       * Keyed by `toast.id` so a replacement re-triggers the entrance
       * animation instead of the new message silently swapping into the
       * still-mounted previous toast's element. */}
      <div
        className="pointer-events-none fixed inset-x-0 top-0 z-[60] flex flex-col items-center px-4 pt-3"
        style={{ paddingTop: 'calc(0.75rem + env(safe-area-inset-top, 0px))' }}
        aria-live="polite"
        aria-atomic="true"
      >
        {toast && (
          <button
            key={toast.id}
            type="button"
            onClick={() => dismiss(toast.id)}
            className={[
              'pointer-events-auto w-full max-w-sm rounded-xl px-4 py-3 text-left text-sm font-medium shadow-lg',
              'animate-toast-in motion-reduce:animate-none',
              TONE_CLASSES[toast.tone],
            ].join(' ')}
          >
            {toast.message}
          </button>
        )}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be called within a <ToastProvider>.');
  }
  return ctx;
}
