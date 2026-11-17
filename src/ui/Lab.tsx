import { useState } from 'react';
import { detectProfile, type Profile } from '../lab/sla.ts';
import { runCustomStress, suites, type Result } from '../lab/suites.ts';
import type { PdfApi } from '../lib/pdf/types.ts';
import { toast } from './Toasts.tsx';

const SCALES = [0.1, 0.25, 0.5, 1] as const;

type LabProps = {
  api: PdfApi & { lastHeapMb(): number | null };
};

export function Lab({ api }: LabProps) {
  const [profile, setProfile] = useState<Profile>(() => detectProfile());
  const [scale, setScale] = useState<number>(1);
  const [enabled, setEnabled] = useState<Set<string>>(() => new Set(suites.map((s) => s.id)));
  const [results, setResults] = useState<Record<string, Result>>({});
  const [running, setRunning] = useState<string | null>(null);

  const [customCount, setCustomCount] = useState(5);
  const [customMaxMb, setCustomMaxMb] = useState(2);
  const [customMixed, setCustomMixed] = useState(true);

  const makeCtx = () => ({
    api,
    profile,
    scale,
    hasCanvas: true,
    heap: () => api.lastHeapMb(),
  });

  const runSuite = async (id: string) => {
    const suite = suites.find((s) => s.id === id);
    if (!suite) return;
    setRunning(id);
    try {
      const res = id === 'CUSTOM'
        ? await runCustomStress(makeCtx(), customCount, customMaxMb, customMixed)
        : await suite.run(makeCtx());
      setResults((prev) => ({ ...prev, [id]: res }));
    } catch (err) {
      setResults((prev) => ({
        ...prev,
        [id]: {
          id,
          title: suite.title,
          status: 'fail',
          ms: 0,
          mbPerSec: null,
          pagesPerSec: null,
          peakHeapMb: api.lastHeapMb(),
          slaMs: null,
          details: err instanceof Error ? err.message : String(err),
        },
      }));
    } finally {
      setRunning(null);
    }
  };

  const runAll = async () => {
    for (const s of suites) {
      if (!enabled.has(s.id)) continue;
      await runSuite(s.id);
    }
  };

  const toggle = (id: string) => {
    setEnabled((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const copyJson = async () => {
    const ordered = suites.map((s) => results[s.id]).filter(Boolean);
    try {
      await navigator.clipboard.writeText(JSON.stringify({ profile, scale, results: ordered }, null, 2));
      toast('Results JSON copied to clipboard', 'success');
    } catch {
      toast('Could not copy to clipboard', 'error');
    }
  };

  const badge = (status?: Result['status']) => {
    if (status === 'pass') return 'bg-emerald-100 text-emerald-800';
    if (status === 'fail') return 'bg-red-100 text-red-800';
    if (status === 'skip') return 'bg-amber-100 text-amber-800';
    return 'bg-gray-100 text-gray-600';
  };

  return (
    <div className="space-y-4">
      <div className="bg-white border rounded-lg p-4 flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-sm">
          <span className="font-medium">Profile</span>
          <select
            aria-label="Profile"
            value={profile}
            onChange={(e) => setProfile(e.target.value as Profile)}
            disabled={running !== null}
            className="border rounded px-2 py-1 text-sm"
          >
            <option value="desktop">Desktop</option>
            <option value="mobile">Mobile</option>
          </select>
        </label>

        <label className="flex items-center gap-2 text-sm">
          <span className="font-medium">Scale</span>
          <select
            aria-label="Scale"
            value={scale}
            onChange={(e) => setScale(Number(e.target.value))}
            disabled={running !== null}
            className="border rounded px-2 py-1 text-sm"
          >
            {SCALES.map((sc) => (
              <option key={sc} value={sc}>
                {sc}x
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          onClick={() => void runAll()}
          disabled={running !== null}
          className="px-4 py-1.5 bg-blue-600 text-white rounded text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
        >
          {running ? `Running ${running}…` : 'Run all'}
        </button>

        <button
          type="button"
          onClick={() => void copyJson()}
          disabled={Object.keys(results).length === 0}
          className="px-3 py-1.5 border rounded text-sm hover:bg-gray-50 disabled:opacity-50"
        >
          Copy JSON
        </button>
      </div>

      <div className="bg-white border rounded-lg p-4 flex flex-wrap items-end gap-4">
        <div className="text-sm font-medium w-full sm:w-auto">Custom merge stress</div>
        <label className="text-xs flex flex-col gap-1">
          <span>Count</span>
          <input
            type="number"
            min={1}
            max={200}
            value={customCount}
            onChange={(e) => setCustomCount(Math.max(1, Number(e.target.value) || 1))}
            className="border rounded px-2 py-1 w-20 text-sm"
          />
        </label>
        <label className="text-xs flex flex-col gap-1">
          <span>Max MB each</span>
          <input
            type="number"
            min={0.1}
            max={100}
            step={0.5}
            value={customMaxMb}
            onChange={(e) => setCustomMaxMb(Math.max(0.1, Number(e.target.value) || 0.1))}
            className="border rounded px-2 py-1 w-24 text-sm"
          />
        </label>
        <label className="text-sm flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={customMixed}
            onChange={(e) => setCustomMixed(e.target.checked)}
          />
          <span>Mixed sizes</span>
        </label>
        <button
          type="button"
          onClick={() => void runSuite('CUSTOM')}
          disabled={running !== null}
          className="px-3 py-1.5 bg-gray-800 text-white rounded text-sm hover:bg-gray-900 disabled:opacity-50"
        >
          Run custom
        </button>
      </div>

      <div className="bg-white border rounded-lg overflow-x-auto">
        <table className="w-full text-sm text-left">
          <thead className="bg-gray-50 border-b text-xs uppercase text-gray-600">
            <tr>
              <th className="p-2.5">Use</th>
              <th className="p-2.5">ID</th>
              <th className="p-2.5">Title</th>
              <th className="p-2.5">Status</th>
              <th className="p-2.5 text-right">ms</th>
              <th className="p-2.5 text-right">MB/s</th>
              <th className="p-2.5 text-right">pages/s</th>
              <th className="p-2.5 text-right">Peak heap MB</th>
              <th className="p-2.5 text-right">SLA ms</th>
              <th className="p-2.5">Details</th>
              <th className="p-2.5">Run</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {suites.map((s) => {
              const r = results[s.id];
              return (
                <tr key={s.id} className="hover:bg-gray-50" data-suite-row={s.id}>
                  <td className="p-2.5">
                    <input
                      type="checkbox"
                      checked={enabled.has(s.id)}
                      onChange={() => toggle(s.id)}
                      aria-label={`Enable ${s.id}`}
                    />
                  </td>
                  <td className="p-2.5 font-mono font-medium whitespace-nowrap">{s.id}</td>
                  <td className="p-2.5">{s.title}</td>
                  <td className="p-2.5">
                    <span
                      data-suite-status={s.id}
                      className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${badge(r?.status)}`}
                    >
                      {r ? r.status : 'idle'}
                    </span>
                  </td>
                  <td className="p-2.5 text-right font-mono">{r ? r.ms : '—'}</td>
                  <td className="p-2.5 text-right font-mono">{r?.mbPerSec ?? '—'}</td>
                  <td className="p-2.5 text-right font-mono">{r?.pagesPerSec ?? '—'}</td>
                  <td className="p-2.5 text-right font-mono">
                    {r ? (r.peakHeapMb !== null ? r.peakHeapMb : 'n/a') : '—'}
                  </td>
                  <td className="p-2.5 text-right font-mono">{r?.slaMs ?? '—'}</td>
                  <td className="p-2.5 text-xs text-gray-600 max-w-xs break-words">{r?.details ?? ''}</td>
                  <td className="p-2.5">
                    <button
                      type="button"
                      onClick={() => void runSuite(s.id)}
                      disabled={running !== null}
                      className="px-2 py-1 border rounded text-xs hover:bg-gray-100 disabled:opacity-50"
                    >
                      Run
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-gray-500">
        Peak heap sampled at progress points, Chrome only; Wasm memory excluded. Known mobile ceiling:
        pdf.js preview rendering holds an in-memory copy of opened file bytes.
      </p>
    </div>
  );
}
