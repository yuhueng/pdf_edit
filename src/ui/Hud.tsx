import { useEffect, useState } from 'react';

type TimingEntry = { id: number; label: string; ms: number };

let seq = 1;

/** Recent worker timings. `compact` shows only the latest one (phone header). */
export function Hud({ compact = false }: { compact?: boolean }) {
  const [entries, setEntries] = useState<TimingEntry[]>([]);

  useEffect(() => {
    const onTiming = (e: Event) => {
      const detail = (e as CustomEvent<{ label: string; ms: number }>).detail;
      if (!detail) return;
      setEntries((prev) => [{ id: seq++, label: detail.label, ms: detail.ms }, ...prev].slice(0, 5));
    };
    window.addEventListener('yh:timing', onTiming);
    return () => window.removeEventListener('yh:timing', onTiming);
  }, []);

  if (entries.length === 0) return null;

  if (compact) {
    const t = entries[0]!;
    return (
      <span aria-label="Latest worker timing" className="text-[11px] text-gray-300 font-mono tabular-nums truncate">
        {t.label} {t.ms.toFixed(0)}ms
      </span>
    );
  }

  return (
    <div
      aria-label="Recent worker timings"
      className="flex flex-wrap items-center gap-3"
    >
      <span className="font-medium">Timings:</span>
      {entries.map((t) => (
        <span key={t.id} className="font-mono">
          {t.label}: <span className="text-ok">{t.ms.toFixed(1)} ms</span>
        </span>
      ))}
    </div>
  );
}
