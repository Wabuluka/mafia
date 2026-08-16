'use client';

// ---------------------------------------------------------------------------
// Modal — a bottom-sheet on mobile (slides up from the bottom edge, which is
// where a thumb already is) rather than a centered dialog. Renders nothing
// when closed; the caller controls open state entirely (no internal
// open/close state to get out of sync with the rest of the app).
//
// Animation: the sheet transitions with `transform: translateY(...)` and
// the scrim with `opacity` — both compositor-only, no layout thrash — and
// both respect prefers-reduced-motion via the `motion-reduce:` variants
// (the keyframes themselves are also neutralized globally, see globals.css,
// so this is belt-and-suspenders for the entrance transition specifically).
// ---------------------------------------------------------------------------

import { useEffect, useId, type ReactNode } from 'react';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  /** Optional footer, typically action buttons — kept visually distinct
   * from `children` (a border-top separates it) like ActionBar. */
  footer?: ReactNode;
}

export function Modal({ open, onClose, title, children, footer }: ModalProps) {
  const titleId = useId();

  // Lock body scroll while the sheet is open — the shell already disables
  // body scrolling globally (see globals.css), but a modal opened over a
  // page that DOES scroll internally (its content region) still needs this
  // so a background drag can't scroll content behind the sheet.
  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      {/* Scrim */}
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 h-full w-full bg-black/60 animate-fade-in motion-reduce:animate-none"
      />

      {/* Sheet */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={[
          'relative flex max-h-[85dvh] flex-col rounded-t-3xl border-t border-white/10 bg-elevated-2 pb-safe-bottom',
          'animate-sheet-in motion-reduce:animate-none',
        ].join(' ')}
      >
        {/* Drag-handle affordance — decorative, but signals "this is a
         * sheet you could swipe" even though swipe-to-dismiss isn't wired
         * up in this pure-presentation pass. */}
        <div className="flex justify-center pt-2.5">
          <div aria-hidden="true" className="h-1 w-10 rounded-full bg-white/15" />
        </div>

        <div className="flex items-center justify-between px-5 pb-2 pt-3">
          <h2 id={titleId} className="text-xl font-bold">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-9 w-9 items-center justify-center rounded-full bg-white/5 text-base-content/70 active:bg-white/10"
          >
            <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="overflow-y-auto px-5 pb-4">{children}</div>

        {footer && <div className="border-t border-white/5 px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}
