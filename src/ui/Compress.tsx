import { useEffect, useRef, useState } from 'react';
import type { CompressLevel, CompressResult } from '../lib/pdf/compress.ts';
import { saveBlob, saveZipOrFiles } from '../lib/download.ts';
import { fmtDuration, fmtSize, MAX_ZIP_BYTES, midTruncate, plural, stripPdf } from '../lib/format.ts';
import type { WorkerApi } from '../lib/worker/client.ts';
import { ChangeReview } from './ChangeReview.tsx';
import { ConfirmDialog } from './Confirm.tsx';
import { EmptyDrop } from './DropFiles.tsx';
import { pdfsOnly, useDropFiles } from './dropEvents.ts';
import { AddButton, Button, Card, Checkbox, IconButton, IdBadge, Notice, PageBar, ProgressBar, Segmented, StatusPill, UnitField } from './kit.tsx';
import { prepareFile } from './Password.tsx';
import { toast } from './Toasts.tsx';

type Item = { id: number; file: File; name: string; size: number; pages: number };

let seq = 1;

const LEVEL_TEXT: Record<CompressLevel, string> = {
  0: 'Already under the limit, unchanged',
  1: 'Lossless clean-up only',
  2: 'Images recompressed, text kept',
  3: 'Pages converted to images, text can no longer be selected',
};

const PRESETS = [1, 2, 5, 10];
const MB = 1024 * 1024;
const outName = (n: string) => `${stripPdf(n)}-compressed.pdf`;
/** A finished file: the numbers, and the PDF kept as a Blob (the browser can move large Blobs out of page memory). */
type Done = Omit<CompressResult, 'bytes'> & { blob: Blob; ms: number };
/** A file being compressed: overall progress 0–1, what it is doing, and when it started. */
type Live = { frac: number; stage: string; start: number };
const blobOf = (r: Done) => r.blob;
/** Files larger than this run one at a time: several multi-hundred-MB jobs side by side can exhaust memory. */
const SOLO_BYTES = 256 * MB;
const fmtMb = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(1)} MB`;
/**
 * Starting guess for the time estimates: about 8 MB a second plus a second and a half of set-up (measured:
 * 500 MB of colour scans in 68 s, 1 GB of large photos in 84 s). Replaced by the speed measured on this
 * device as soon as a file finishes.
 */
const DEFAULT_BYTES_PER_MS = (8 * MB) / 1000;
const SETUP_MS = 1500;

/** Compress PDFs to a size limit. Every file shows where it stands against the limit before anything runs. */
export function Compress({ api, onEdit }: { api: WorkerApi; onEdit: (f: File) => void }) {
  const [items, setItems] = useState<Item[]>([]);
  const [maxMb, setMaxMb] = useState(5);
  const [allowRaster, setAllowRaster] = useState(false);
  const [review, setReview] = useState(false);
  const [missed, setMissed] = useState<number[] | null>(null); // files whose smallest version is still over the limit
  const [results, setResults] = useState<Record<number, Done>>({});
  const [queue, setQueue] = useState<number[]>([]);
  const [live, setLive] = useState<Record<number, Live>>({}); // files being compressed right now
  const [running, setRunning] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  // Speed measured on this device: bytes and milliseconds of every file compressed so far.
  const [measured, setMeasured] = useState({ bytes: 0, ms: 0 });
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const clear = () => {
      setItems([]);
      setResults({});
    };
    window.addEventListener('yh:clear', clear);
    return () => window.removeEventListener('yh:clear', clear);
  }, []);

  // Ticks once a second while compressing, so elapsed time and estimates stay current.
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);

  const bytesPerMs = () => (measured.ms > 0 ? measured.bytes / measured.ms : DEFAULT_BYTES_PER_MS);
  /** Expected time to compress a file of `size` bytes on this device. */
  const estimateMs = (size: number) => SETUP_MS + size / bytesPerMs();
  /** Time left for a running file, or null while there is no fair estimate yet. */
  const leftMs = (it: Item, l: Live): number | null => {
    const elapsed = now - l.start;
    const prior = estimateMs(it.size);
    // Early on (clean-up has no steps to count) trust the size-based guess; once the image pass has run a
    // while, trust the file's own pace.
    const w = Math.min(1, Math.max(0, (l.frac - 0.25) / 0.35));
    const total = (1 - w) * prior + w * (l.frac > 0 ? elapsed / l.frac : prior);
    const left = total - elapsed;
    return left < 2000 && l.frac < 0.9 ? null : Math.max(1000, left);
  };

  /** Files over SOLO_BYTES run one at a time; smaller ones side by side, one per worker. */
  const lanesFor = (sizes: number[]) => (sizes.some((n) => n > SOLO_BYTES) ? 1 : Math.max(1, Math.min(api.concurrency, sizes.length)));
  /** Whole-batch estimate: the files' times shared over the lanes that run side by side. */
  const totalEstimateMs = (sizes: number[]) => {
    const lanes = lanesFor(sizes);
    const sum = sizes.reduce((a, n) => a + estimateMs(n), 0);
    return Math.max(sum / lanes, ...sizes.map(estimateMs));
  };

  const maxBytes = Math.max(1, Math.round(maxMb * MB));
  // What a file is worth now: its compressed size if it has been compressed, else its original size.
  const sizeNow = (it: Item) => results[it.id]?.after ?? it.size;
  const needs = items.filter((it) => sizeNow(it) > maxBytes);

  const add = async (files: File[] | FileList) => {
    const next: Item[] = [];
    const seen = new Set(items.map((i) => `${i.name}|${i.file.size}`));
    for (const f of pdfsOnly(files)) {
      const ready = await prepareFile(api, f);
      if (!ready) continue;
      const key = `${f.name}|${ready.file.size}`;
      if (seen.has(key)) {
        toast(`${f.name} is already in the list (same name and size), so it wasn't added again.`, 'info');
        continue;
      }
      seen.add(key);
      next.push({ id: seq++, file: ready.file, name: f.name, size: ready.file.size, pages: ready.pageCount });
    }
    if (next.length) setItems((p) => [...p, ...next]);
  };
  useDropFiles('compress', (f) => void add(f));

  const run = async () => {
    setReview(false);
    const todo = needs;
    setRunning(true);
    setQueue(todo.map((t) => t.id));
    try {
      // Up to `concurrency` files at once. Each worker call detaches its buffer, so each gets its own copy.
      const lane = [...todo];
      const over: number[] = [];
      const worker = async () => {
        for (let it = lane.shift(); it; it = lane.shift()) {
          const id = it.id;
          const start = Date.now();
          setNow(start);
          setLive((p) => ({ ...p, [id]: { frac: 0, stage: 'Reading the file', start } }));
          const result = await api.compress(new Uint8Array(await it.file.arrayBuffer()), maxBytes, allowRaster, (d, t, stage) =>
            setLive((p) => ({ ...p, [id]: { frac: t > 0 ? d / t : 1, stage: stage ?? p[id]?.stage ?? 'Compressing', start } })),
          );
          const { bytes, ...meta } = result;
          const ms = Date.now() - start;
          setMeasured((m) => ({ bytes: m.bytes + it.size, ms: m.ms + Math.max(0, ms - SETUP_MS) }));
          const done: Done = { ...meta, ms, blob: new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/pdf' }) };
          setResults((r) => ({ ...r, [id]: done }));
          if (result.after > maxBytes) over.push(id);
          setQueue((q) => q.filter((x) => x !== id));
          setLive((p) => {
            const rest = { ...p };
            delete rest[id];
            return rest;
          });
        }
      };
      const lanes = lanesFor(todo.map((t) => t.size));
      await Promise.all(Array.from({ length: lanes }, worker));
      if (over.length) setMissed(over);
      toast(`Compressed ${plural(todo.length, 'file')}`, 'success');
    } catch (err) {
      toast(`Compression didn't finish: ${err instanceof Error ? err.message : 'unknown problem'}. Try again.`, 'error');
    } finally {
      setRunning(false);
      setLive({});
      setQueue([]);
    }
  };

  const doneItems = items.filter((it) => results[it.id]);
  const saveMany = async (list: Array<{ it: Item; r: Done }>) => {
    const how = await saveZipOrFiles(list.map(({ it, r }) => ({ name: outName(it.name), data: r.blob })), 'compressed.zip', MAX_ZIP_BYTES);
    if (how === 'files') toast(`${plural(list.length, 'PDF')} downloaded one by one: together they are over ${fmtSize(MAX_ZIP_BYTES)}, too large for one ZIP`, 'info');
  };
  const zipAll = () => void saveMany(doneItems.map((it) => ({ it, r: results[it.id]! })));

  const status = (it: Item) => {
    const r = results[it.id];
    const l = live[it.id];
    if (l) return <StatusPill kind="working">Compressing… {Math.round(l.frac * 100)}%</StatusPill>;
    if (queue.includes(it.id)) return <StatusPill kind="neutral">Waiting · takes about {fmtDuration(estimateMs(it.size))}</StatusPill>;
    if (r) {
      return r.after <= maxBytes ? (
        <StatusPill kind="success">
          Done · −{Math.max(0, Math.round((1 - r.after / r.before) * 100))}% · {fmtDuration(r.ms)}
        </StatusPill>
      ) : (
        <StatusPill kind="danger">
          Couldn&rsquo;t reach {fmtMb(maxMb)} · smallest was {fmtSize(r.after)}
        </StatusPill>
      );
    }
    return it.size <= maxBytes ? (
      <StatusPill kind="success">Under {fmtMb(maxMb)} · no change needed</StatusPill>
    ) : (
      <StatusPill kind="warning">Over by {fmtSize(it.size - maxBytes)}</StatusPill>
    );
  };

  return (
    <div className="space-y-7">
      <PageBar
        title="Compress"
        description="Shrink PDFs to fit an upload limit. Only files over the limit are changed."
        status={
          items.length === 0
            ? undefined
            : needs.length === 0 && doneItems.length > 0
              ? `${plural(doneItems.length, 'file')} ready`
              : needs.length > 0
                ? `${plural(needs.length, 'file')} over ${fmtMb(maxMb)}`
                : `All under ${fmtMb(maxMb)}`
        }
        add={items.length > 0 && <AddButton label="Add PDFs" onClick={() => inputRef.current?.click()} />}
      >
        {items.length === 0 ? null : needs.length === 0 && doneItems.length > 0 ? (
          <Button
            variant="primary"
            size="sm"
            icon="download"
            onClick={() => {
              if (doneItems.length === 1) {
                const it = doneItems[0]!;
                saveBlob(blobOf(results[it.id]!), outName(it.name));
              } else {
                zipAll();
              }
            }}
          >
            {doneItems.length === 1 ? 'Download PDF' : 'Download all'}
          </Button>
        ) : (
          <Button
            variant="primary"
            size="sm"
            icon="compress"
            disabled={needs.length === 0}
            loading={running}
            loadingLabel="Compressing…"
            onClick={() => setReview(true)}
          >
            {needs.length === 0 ? 'Compress' : `Compress ${plural(needs.length, 'file')}`}
          </Button>
        )}
      </PageBar>

      <input
        ref={inputRef}
        type="file"
        multiple
        accept="application/pdf,.pdf"
        className="hidden"
        data-testid="compress-file-input"
        data-yh-add="true"
        onChange={(e) => {
          if (e.target.files?.length) void add(e.target.files);
          e.target.value = '';
        }}
      />

      {items.length === 0 ? (
        <EmptyDrop
          icon="compress"
          title="Add PDFs to compress"
          hint="Set a size limit; only files over it are changed."
          onFiles={(f) => void add(f)}
          onChoose={() => inputRef.current?.click()}
        />
      ) : (
        <>
          <div className="grid items-start gap-6 lg:grid-cols-[3fr_2fr]">
            <Card
                        title="Files"
                        aside={
                          <div className="flex gap-2">
                            {doneItems.length > 1 && (
                              <Button size="md" icon="download" onClick={zipAll} data-testid="compress-zip">
                                Download all ({plural(doneItems.length, 'PDF')}, .zip)
                              </Button>
                            )}
                          </div>
                        }
                      >
                        <ul className="-my-2 divide-y divide-divider" data-testid="compress-files">
                          {items.map((it, i) => {
                            const r = results[it.id];
                            return (
                              <li
                                key={it.id}
                                className="relative flex flex-col gap-2 py-3 sm:min-h-14 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3"
                                data-testid={`compress-status-${it.id}`}
                                data-ms={r?.ms}
                              >
                                <div className="flex min-w-0 flex-1 items-center gap-2.5">
                                  <IdBadge n={i + 1} />
                                  <span className="truncate text-sm" title={it.name}>
                                    {midTruncate(it.name, 36)}
                                  </span>
                                  <span className="shrink-0 font-mono text-[13px] text-text-muted tabular-nums">{r ? `${fmtSize(r.before)} → ${fmtSize(r.after)}` : fmtSize(it.size)}</span>
                                </div>
                                <div className="flex flex-wrap items-center gap-2">
                                  {status(it)}
                                  {r && r.level === 3 && <StatusPill kind="warning">Pages are images</StatusPill>}
                                  <IconButton
                                    icon="trash"
                                    label={`Remove ${it.name}`}
                                    tip="Remove this PDF"
                                    size="sm"
                                    danger
                                    disabled={running}
                                    onClick={() => {
                                      setItems((p) => p.filter((x) => x.id !== it.id));
                                      setResults((p) => Object.fromEntries(Object.entries(p).filter(([k]) => Number(k) !== it.id)));
                                    }}
                                  />
                                  {r && (
                                    <>
                                      <Button size="sm" icon="download" aria-label={`Download ${outName(it.name)}`} onClick={() => saveBlob(blobOf(r), outName(it.name))}>
                                        Download
                                      </Button>
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        aria-label={`Edit ${outName(it.name)}`}
                                        onClick={() => onEdit(new File([blobOf(r)], outName(it.name), { type: 'application/pdf' }))}
                                      >
                                        Edit PDF
                                      </Button>
                                    </>
                                  )}
                                </div>
                                {r && <p className="sr-only">{LEVEL_TEXT[r.level]}</p>}
                                {live[it.id] &&
                                  (() => {
                                    const l = live[it.id]!;
                                    const left = leftMs(it, l);
                                    const elapsed = fmtDuration(now - l.start);
                                    return (
                                      <div className="flex w-full basis-full" data-testid={`compress-progress-${it.id}`}>
                                        <ProgressBar
                                          value={l.frac * 100}
                                          label={`Compressing ${it.name}`}
                                          step={`${l.stage} · ${elapsed} so far · ${left === null ? 'estimating time left…' : `about ${fmtDuration(left)} left`}`}
                                        />
                                      </div>
                                    );
                                  })()}
                              </li>
                            );
                          })}
                        </ul>
                        {doneItems.some((it) => results[it.id]!.after > maxBytes) && !allowRaster && (
                          <Notice kind="info">Some files couldn&rsquo;t reach the limit. Turning pages into images (above) may get them smaller.</Notice>
                        )}
                      </Card>
            <aside aria-label="Target size" className="min-w-0 lg:sticky lg:top-[calc(var(--header-h)+24px)]">
              <Card title="Target size">
                          <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
                            <UnitField
                              label="Target size"
                              unit="MB"
                              min={0.1}
                              step={0.1}
                              value={maxMb}
                              aria-label="Max size per file (MB)"
                              onChange={(e) => setMaxMb(Math.max(0.1, Number(e.target.value) || 0.1))}
                            />
                            <Segmented
                              label="Size presets"
                              value={PRESETS.includes(maxMb) ? maxMb : -1}
                              onChange={(v) => setMaxMb(v)}
                              options={PRESETS.map((p) => ({ value: p, label: `${p} MB` }))}
                            />
                          </div>
                          <Checkbox
                            checked={allowRaster}
                            onChange={(e) => setAllowRaster(e.target.checked)}
                            label="Turn pages into images if needed"
                            help="Gets smaller files, but text can no longer be selected or searched."
                          />
                          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-divider pt-4 max-sm:justify-center">
                        <p className="min-w-0 flex-1 text-sm text-text-muted max-sm:hidden">
                              {needs.length === 0
                                ? `All files are already under ${fmtMb(maxMb)}.`
                                : items.length > needs.length
                                  ? `${plural(items.length - needs.length, 'file')} already under the limit will be left alone.`
                                  : ''}
                            </p>
                            <Button
                              className="max-sm:hidden"
                              variant="primary"
                              size="xl"
                              icon="compress"
                              disabled={needs.length === 0}
                              loading={running}
                              loadingLabel="Compressing…"
                              onClick={() => setReview(true)}
                            >
                              {needs.length === 0 ? 'Compress' : `Compress ${plural(needs.length, 'file')}`}
                            </Button>
                          </div>
                        </Card>

            </aside>
          </div>
        </>
      )}

      <ChangeReview
        open={review}
        title="Review before compressing"
        summary={`${plural(needs.length, 'file')} will be shrunk to at most ${fmtMb(maxMb)} each. Your originals are not changed.`}
        extra={
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-text-muted">
                <th className="py-1 font-medium">File</th>
                <th className="font-medium">Now</th>
                <th className="font-medium">Limit</th>
                <th className="font-medium">Time (est.)</th>
              </tr>
            </thead>
            <tbody>
              {needs.map((it) => (
                <tr key={it.id} className="border-t border-divider">
                  <td className="max-w-[220px] truncate py-1.5">{it.name}</td>
                  <td className="tabular-nums">{fmtSize(sizeNow(it))}</td>
                  <td className="tabular-nums">{fmtMb(maxMb)}</td>
                  <td className="tabular-nums">~{fmtDuration(estimateMs(sizeNow(it)))}</td>
                </tr>
              ))}
            </tbody>
            {needs.length > 1 && (
              <tfoot>
                <tr className="border-t border-divider text-text-muted">
                  <td className="py-1.5" colSpan={3}>
                    All files
                  </td>
                  <td className="tabular-nums">~{fmtDuration(totalEstimateMs(needs.map(sizeNow)))}</td>
                </tr>
              </tfoot>
            )}
          </table>
        }
        sections={[]}
        confirmLabel="Confirm and compress"
        onCancel={() => setReview(false)}
        onConfirm={() => void run()}
      />
      <ConfirmDialog
        open={!!missed}
        title="Smallest version is still over the limit"
        message={
          missed && missed.length === 1
            ? `${items.find((i) => i.id === missed[0])?.name ?? 'The file'} could only get down to ${fmtSize(results[missed[0]!]?.after ?? 0)}, above ${fmtMb(maxMb)}. Download that smallest version anyway?`
            : `${missed?.length ?? 0} files could not get under ${fmtMb(maxMb)}. Their smallest versions are ready. Download them anyway?`
        }
        confirmLabel="Download smallest"
        onCancel={() => setMissed(null)}
        onConfirm={() => {
          const ready = (missed ?? []).flatMap((id) => {
            const it = items.find((i) => i.id === id);
            const r = results[id];
            return it && r ? [{ it, r }] : [];
          });
          if (ready.length === 1) saveBlob(blobOf(ready[0]!.r), outName(ready[0]!.it.name));
          else void saveMany(ready);
          setMissed(null);
        }}
      />
    </div>
  );
}
