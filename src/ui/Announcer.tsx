import { useEffect, useState } from 'react';

/** Polite screen-reader announcements for things that happen without a visible focus change. */
const listeners = new Set<(msg: string) => void>();

export function announce(message: string): void {
  for (const fn of listeners) fn(message);
}

export function LiveRegion() {
  const [msg, setMsg] = useState('');
  useEffect(() => {
    let t: number | undefined;
    const on = (m: string) => {
      // Clear first so announcing the same text twice is still read out.
      setMsg('');
      window.clearTimeout(t);
      t = window.setTimeout(() => setMsg(m), 30);
    };
    listeners.add(on);
    return () => {
      listeners.delete(on);
      window.clearTimeout(t);
    };
  }, []);
  return (
    <div aria-live="polite" aria-atomic="true" className="sr-only" data-testid="live-region">
      {msg}
    </div>
  );
}
