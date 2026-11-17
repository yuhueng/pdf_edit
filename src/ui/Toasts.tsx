import { useEffect, useRef, useState } from 'react';
import { Icon, IconButton } from './kit.tsx';

export type ToastKind = 'info' | 'error' | 'success';
export type ToastAction = { label: string; onClick: () => void };
export type ToastItem = { id: number; message: string; kind: ToastKind; action?: ToastAction };

let nextToastId = 1;
let items: ToastItem[] = [];
const listeners = new Set<(next: ToastItem[]) => void>();

function notify() {
  for (const fn of listeners) fn(items);
}

export function toast(message: string, kind: ToastKind = 'info', action?: ToastAction): void {
  // At most 3 at once; the oldest makes room for the newest.
  items = [...items, { id: nextToastId++, message, kind, action }].slice(-3);
  notify();
}

export function dismissToast(id: number): void {
  items = items.filter((t) => t.id !== id);
  notify();
}

const ICON_COLOUR: Record<ToastKind, string> = {
  info: 'text-white',
  success: 'text-[#7fd1a3]',
  error: 'text-[#f4a49b]',
};

/** 5s by default, 8s when there is an Undo, errors stay until dismissed. Pauses on hover and focus. */
function duration(t: ToastItem): number | null {
  if (t.kind === 'error') return null;
  return t.action ? 8000 : 5000;
}

function ToastView({ t }: { t: ToastItem }) {
  const [paused, setPaused] = useState(false);
  const left = useRef(duration(t));

  useEffect(() => {
    if (left.current === null || paused) return;
    const started = Date.now();
    const id = window.setTimeout(() => dismissToast(t.id), left.current);
    return () => {
      window.clearTimeout(id);
      if (left.current !== null) left.current -= Date.now() - started;
    };
  }, [paused, t.id]);

  return (
    <div
      role={t.kind === 'error' ? 'alert' : 'status'}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      style={{ animation: 'yh-toast-in 200ms var(--ease-enter) both' }}
      className="pointer-events-auto flex items-center gap-3 rounded-lg bg-text px-4 py-3 text-sm text-white shadow-3"
    >
      <span className={ICON_COLOUR[t.kind]}>
        <Icon name={t.kind === 'error' ? 'alert' : t.kind === 'success' ? 'check' : 'info'} size={16} />
      </span>
      <span className="flex-1 break-words">{t.message}</span>
      {t.action && (
        <button
          type="button"
          onClick={() => {
            t.action!.onClick();
            dismissToast(t.id);
          }}
          className="min-h-9 px-2 rounded-sm font-semibold text-[#a8e0c2] hover:bg-white/10"
        >
          {t.action.label}
        </button>
      )}
      <IconButton
        icon="close"
        label="Dismiss"
        size="sm"
        onClick={() => dismissToast(t.id)}
        className="!text-white/70 hover:!text-white hover:!bg-white/10"
      />
    </div>
  );
}

export function Toasts() {
  const [list, setList] = useState<ToastItem[]>(items);

  useEffect(() => {
    listeners.add(setList);
    return () => {
      listeners.delete(setList);
    };
  }, []);

  return (
    <div
      aria-label="Notifications"
      // Bottom centre; on phones it clears the bottom tab bar.
      className="pointer-events-none fixed inset-x-4 bottom-[calc(var(--bottom-bar-h)+16px)] z-[var(--z-toast)] mx-auto flex max-w-[480px] flex-col gap-2 sm:bottom-6"
    >
      {list.map((t) => (
        <ToastView key={t.id} t={t} />
      ))}
    </div>
  );
}
