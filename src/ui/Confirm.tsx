import { useEffect, useRef } from 'react';
import { Button } from './kit.tsx';

/** A small "are you sure?" dialog (native <dialog>, so Esc and focus handling come for free). */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  danger = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const dlg = useRef<HTMLDialogElement | null>(null);

  useEffect(() => {
    const d = dlg.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={dlg}
      aria-label={title}
      onClose={onCancel}
      className="yh-dialog"
    >
      {open && (
        <div className="p-6 space-y-4">
          <h2 className="text-xl leading-7 font-semibold">{title}</h2>
          <p className="text-sm text-text-muted">{message}</p>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
            <Button variant={danger ? 'destructive' : 'primary'} onClick={onConfirm} className="px-4">
              {confirmLabel}
            </Button>
          </div>
        </div>
      )}
    </dialog>
  );
}
