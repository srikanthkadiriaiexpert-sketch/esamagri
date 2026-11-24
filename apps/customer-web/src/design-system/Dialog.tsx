import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Button } from './Button';

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children?: ReactNode;
  confirmLabel?: string;
  onConfirm?: () => void;
  confirmAccent?: 'green' | 'amber' | 'neutral';
  danger?: boolean;
}

/**
 * Centered confirmation dialog — reserved for short yes/no decisions
 * (e.g. "Remove item?", "Log out?"). Anything longer or scrollable
 * should use <Sheet> instead to stay mobile-first.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  confirmLabel,
  onConfirm,
  confirmAccent = 'green',
  danger = false,
}: DialogProps) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center px-6">
      <button aria-label="Close" onClick={onClose} className="absolute inset-0 animate-fade-in bg-slate-900/40" />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
        // The dialog had no height bound at all: a long description on a
        // 360x800 phone, or any phone with the keyboard up, could grow it
        // past the viewport with no way to reach the buttons. It is now
        // capped at the VISIBLE viewport (85dvh, falling back to 85vh) and
        // scrolls inside itself instead of overflowing off-screen.
        className="relative flex max-h-dialog w-full max-w-sm flex-col overflow-y-auto rounded-2xl bg-white p-5 shadow-sheet"
      >
        <h2 id="dialog-title" className="text-lg font-bold text-slate-900">
          {title}
        </h2>
        {description ? <p className="mt-1.5 text-sm text-slate-500">{description}</p> : null}
        {children ? <div className="mt-3">{children}</div> : null}
        <div className="mt-5 flex gap-2.5">
          <Button variant="outline" accent="neutral" fullWidth onClick={onClose}>
            Cancel
          </Button>
          {onConfirm ? (
            <Button
              variant={danger ? 'danger' : 'primary'}
              accent={confirmAccent}
              fullWidth
              onClick={onConfirm}
            >
              {confirmLabel ?? 'Confirm'}
            </Button>
          ) : null}
        </div>
      </div>
    </div>,
    document.body
  );
}
