import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  pointerWithin,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { arrayMove } from '@dnd-kit/sortable';
import { useEffect, useReducer, useRef, useState } from 'react';
import { saveBlob, saveZipOrFiles } from '../lib/download.ts';
import { isWasmMemError } from '../lib/pdf/mupdfStream.ts';
import { fmtSize, MAX_FILE_BYTES, MAX_MERGE_SOURCE_BYTES, MAX_ZIP_BYTES, plural, stripPdf } from '../lib/format.ts';
import type { PageRef, PdfApi } from '../lib/pdf/types.ts';
import { parseRanges } from '../lib/pdf/ranges.ts';
import { closePdf, openPdf } from '../lib/render.ts';
import { initialOrgState, reducer, type FileEntry } from '../state/organize.ts';
import { announce } from './Announcer.tsx';
import { ChangeReview, type ReviewSection } from './ChangeReview.tsx';
import { ConfirmDialog } from './Confirm.tsx';
import { EmptyDrop, NewFileSlot } from './DropFiles.tsx';
import { pdfsOnly, useDropFiles } from './dropEvents.ts';
import { AddButton, Button, Card, Checkbox, Collapse, Icon, IconButton, IdBadge, Notice, PageBar, ProgressBar, Segmented, SelectField, TextField, UnitField } from './kit.tsx';
import { MAX_FILES, OutputCard, type SplitFile } from './OutputCard.tsx';
import { PageGrid } from './PageGrid.tsx';
import { PagePreview } from './PagePreview.tsx';
import { prepareFile } from './Password.tsx';
import { Thumb } from './Thumb.tsx';
import { toast } from './Toasts.tsx';
import { useMedia } from './useMedia.ts';

type OrganizeProps = {
  api: PdfApi;
  /** Hand a produced PDF to the Edit tab. */
  onEdit: (file: File) => void;
  active?: boolean;
};

let fileSeq = 1;
let splitSeq = 1;
let copySeq = 1;

type Pending = { kind: 'zip' | 'download' | 'edit'; ids: string[] };


/** Reads "1-3, 5" and says what is wrong in plain words. */
function rangeProblem(text: string, count: number): { ok: true; indices: number[] } | { ok: false; message: string } {
  const r = parseRanges(text, count);
  if (r.ok) return r;
  const out = /Page "(\d+)" out of range/.exec(r.message);
  if (out) return { ok: false, message: `Page ${out[1]} doesn't exist. This file has ${plural(count, 'page')}.` };
  return { ok: false, message: r.message };
}

/** Typing "1-3, 5" ticks exactly those pages of this file; the format is checked when you leave the field. */
function RangeField({ name, pageCount, onApply }: { name: string; pageCount: number; onApply: (indices: number[]) => void }) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  return (
    <TextField
      label="Select pages"
      value={text}
      placeholder="All pages"
      help="e.g. 1-3, 5, 8-11"
      error={error}
      aria-label={`Select pages of ${name}`}
      className="max-w-xs"
      onChange={(e) => {
        setText(e.target.value);
        const r = rangeProblem(e.target.value, pageCount);
        if (r.ok) {
          setError(null);
          onApply(r.indices);
        } else if (error) setError(null);
      }}
      onBlur={() => {
        if (!text.trim()) return setError(null);
        const r = rangeProblem(text, pageCount);
        setError(r.ok ? null : r.message);
      }}
    />
  );
}

/** Split & Merge: pick pages from any PDF, arrange them into new files, download. */
export function Organize({ api, onEdit, active = true }: OrganizeProps) {
  const [state, dispatch] = useReducer(reducer, initialOrgState);
  const [splits, setSplits] = useState<SplitFile[]>([]);
  const [progress, setProgress] = useState<number | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [confirmAuto, setConfirmAuto] = useState(false);
  const [dragging, setDragging] = useState<{ page: PageRef; count: number } | null>(null);
  const [preview, setPreview] = useState<{ list: string; index: number } | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<'selection' | 'auto'>('selection');
  const [autoSrc, setAutoSrc] = useState('');
  const [autoN, setAutoN] = useState(1);
  const [dupes, setDupes] = useState<File[]>([]);
  const phone = useMedia('(max-width: 639px)');
  const inputRef = useRef<HTMLInputElement | null>(null);
  const filesRef = useRef<FileEntry[]>([]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 6 } }),
  );

  useEffect(() => {
    filesRef.current = state.files;
  }, [state.files]);

  // PDFs are temporary: "Clear all now" and tab close both drop every open document.
  useEffect(() => {
    const closeAll = () => filesRef.current.forEach((f) => closePdf(f.id));
    const onClear = () => {
      closeAll();
      dispatch({ t: 'reset' });
      setSplits([]);
      setCollapsed(new Set());
      setDupes([]);
    };
    window.addEventListener('yh:clear', onClear);
    window.addEventListener('pagehide', closeAll);
    return () => {
      window.removeEventListener('yh:clear', onClear);
      window.removeEventListener('pagehide', closeAll);
    };
  }, []);

  // Esc clears the selection (when nothing else has it).
  useEffect(() => {
    if (!active) return;
    const on = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) && (t as HTMLInputElement).type !== 'checkbox');
      if (e.key === 'Escape' && !typing && !document.querySelector('dialog[open]') && state.selected.size > 0) {
        dispatch({ t: 'clearSelection' });
        announce('Selection cleared');
      }
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [active, state.selected.size]);

  const addFiles = async (incoming: File[] | FileList, keepDuplicates = false) => {
    const added: FileEntry[] = [];
    const known = new Set(filesRef.current.map((f) => `${f.name}|${f.origSize ?? f.size}`));
    const dup: File[] = [];
    for (const orig of pdfsOnly(incoming)) {
      const key = `${orig.name}|${orig.size}`;
      if (known.has(key) && !keepDuplicates) {
        dup.push(orig);
        continue;
      }
      known.add(key);
      try {
        const ready = await prepareFile(api, orig);
        if (!ready) continue;
        const id = `f${fileSeq++}`;
        try {
          await openPdf(ready.file, id);
        } catch (err) {
          closePdf(id);
          throw err;
        }
        added.push({ id, name: orig.name, size: ready.file.size, origSize: orig.size, file: ready.file, pageCount: ready.pageCount });
      } catch (err) {
        toast(`${orig.name} couldn't be read: ${err instanceof Error ? err.message : 'unknown problem'}`, 'error');
      }
    }
    if (dup.length > 0) setDupes((p) => [...p, ...dup]);
    if (added.length > 0) {
      dispatch({ t: 'addFiles', files: added });
      // With 5 or more files, long ones start folded so the page stays easy to scan.
      const total = filesRef.current.length + added.length;
      if (total >= 5) setCollapsed((prev) => new Set([...prev, ...added.filter((f) => f.pageCount > 8).map((f) => f.id)]));
      if (!autoSrc) setAutoSrc(added[0]!.id);
      announce(`${plural(added.length, 'file')} added`);
    }
  };
  useDropFiles('organize', (files) => void addFiles(files));

  const removeFile = (fileId: string) => {
    const entry = state.files.find((f) => f.id === fileId);
    if (!entry) return;
    const idx = state.files.findIndex((f) => f.id === fileId);
    const removedPages = splits.reduce((n, s) => n + s.pages.filter((p) => p.fileId === fileId).length, 0);
    const savedSplits = splits;
    closePdf(fileId);
    dispatch({ t: 'removeFile', fileId });
    setSplits((prev) => prev.map((s) => ({ ...s, pages: s.pages.filter((p) => p.fileId !== fileId) })));
    toast(`${entry.name} removed${removedPages ? ` and ${plural(removedPages, 'page')} from your new files` : ''}`, 'info', {
      label: 'Undo',
      onClick: () => {
        void openPdf(entry.file, entry.id).then(() => {
          dispatch({ t: 'addFiles', files: [entry] });
          const order = filesRef.current.map((f) => f.id).filter((id) => id !== entry.id);
          order.splice(Math.min(idx, order.length), 0, entry.id);
          dispatch({ t: 'reorderFiles', ids: order });
          setSplits(savedSplits);
        });
      },
    });
  };

  const fileNo = (fileId: string) => state.files.findIndex((f) => f.id === fileId) + 1;
  const nameOfFile = (fileId: string) => state.files.find((f) => f.id === fileId)?.name ?? '';
  const caption = (p: PageRef) => `File ${fileNo(p.fileId)}, page ${p.srcIndex + 1}`;

  /** The source files a new file uses. The worker reads them itself, so the page never holds their bytes. */
  const inputsFor = (pages: PageRef[]): Array<{ id: string; file: File }> => {
    const used = new Set(pages.map((p) => p.fileId));
    return state.files.filter((f) => used.has(f.id)).map((f) => ({ id: f.id, file: f.file }));
  };

  // ---- New files ----
  // Each page in a new file is a copy with its own id, so one source page can go into several files.
  const copyPages = (ids: string[]): PageRef[] =>
    ids
      .map((id) => state.pages.find((p) => p.id === id))
      .filter((p): p is PageRef => !!p)
      .map((p) => ({ ...p, id: `${p.id}~${copySeq++}` }));

  const orderedSelection = () => state.pages.filter((p) => state.selected.has(p.id)).map((p) => p.id);

  const newName = (n: number) => `Untitled ${n}`;

  const addToSplit = (splitId: string, ids: string[]) => {
    const copies = copyPages(ids);
    if (copies.length === 0) return;
    if (splitId === 'new') {
      if (splits.length >= MAX_FILES) {
        toast(`You can build up to ${MAX_FILES} files at a time.`, 'info');
        return;
      }
      const name = newName(splits.length + 1);
      setSplits((prev) => [...prev, { id: `s${splitSeq++}`, name, pages: copies }]);
      announce(`${plural(copies.length, 'page')} added to new file ${name}`);
    } else {
      const target = splits.find((s) => s.id === splitId);
      const dup = copies.filter((c) => target?.pages.some((p) => p.id.split('~')[0] === c.id.split('~')[0])).length;
      setSplits((prev) => prev.map((s) => (s.id === splitId ? { ...s, pages: [...s.pages, ...copies] } : s)));
      if (dup > 0) toast(`${plural(dup, 'page')} already in ${target?.name ?? 'this file'}, added again.`, 'info');
      announce(`${plural(copies.length, 'page')} added to ${target?.name ?? 'file'}`);
    }
    // Added pages are un-ticked, so pressing Add twice cannot put them in a file twice by accident.
    dispatch({ t: 'clearSelection' });
  };

  const newEmptyFile = () => {
    if (splits.length >= MAX_FILES) return toast(`You can build up to ${MAX_FILES} files at a time.`, 'info');
    setSplits((prev) => [...prev, { id: `s${splitSeq++}`, name: newName(prev.length + 1), pages: [] }]);
  };

  const deleteSplit = (id: string) => {
    const idx = splits.findIndex((s) => s.id === id);
    const gone = splits[idx];
    if (!gone) return;
    setSplits((prev) => prev.filter((s) => s.id !== id));
    toast(`${gone.name || 'File'} deleted. Its pages stay in your sources.`, 'info', {
      label: 'Undo',
      onClick: () =>
        setSplits((prev) => {
          const next = [...prev];
          next.splice(Math.min(idx, next.length), 0, gone);
          return next;
        }),
    });
  };

  const duplicateSplit = (id: string) => {
    if (splits.length >= MAX_FILES) return toast(`You can build up to ${MAX_FILES} files at a time.`, 'info');
    const src = splits.find((s) => s.id === id);
    if (!src) return;
    setSplits((prev) => [...prev, { id: `s${splitSeq++}`, name: `${src.name} copy`, pages: src.pages.map((p) => ({ ...p, id: `${p.id.split('~')[0]}~${copySeq++}` })) }]);
  };

  // Auto-split: cut one source into files of `n` pages.
  const autoFiles = (srcId: string, n: number) => {
    const total = state.files.find((f) => f.id === srcId)?.pageCount ?? 0;
    return total === 0 ? 0 : Math.ceil(total / Math.max(1, Math.floor(n)));
  };
  const autoCount = autoFiles(autoSrc, autoN);
  const autoTooMany = autoCount > MAX_FILES;
  const runAuto = () => {
    setConfirmAuto(false);
    const size = Math.max(1, Math.floor(autoN));
    const all = copyPages(state.pages.filter((p) => p.fileId === autoSrc).map((p) => p.id));
    const base = stripPdf(nameOfFile(autoSrc));
    const made: SplitFile[] = [];
    for (let i = 0; i < all.length; i += size) {
      made.push({ id: `s${splitSeq++}`, name: `${base} part ${made.length + 1}`, pages: all.slice(i, i + size) });
    }
    setSplits(made);
    dispatch({ t: 'clearSelection' });
    announce(`${plural(made.length, 'file')} created`);
  };
  const requestAuto = () => {
    if (autoTooMany || autoCount === 0) return;
    if (splits.some((s) => s.pages.length > 0)) setConfirmAuto(true);
    else runAuto();
  };

  // Output names are unique across all files that have pages.
  const nameOf = (() => {
    const used = new Set<string>();
    const map = new Map<string, string>();
    splits.forEach((f, i) => {
      if (f.pages.length === 0) return;
      const base = (f.name.trim() || `Untitled ${i + 1}`).replace(/\.pdf$/i, '').replace(/[\\/:*?"<>|]/g, '_');
      let name = `${base}.pdf`;
      for (let n = 2; used.has(name); n++) name = `${base}-${n}.pdf`;
      used.add(name);
      map.set(f.id, name);
    });
    return map;
  })();
  const ready = splits.filter((s) => s.pages.length > 0);
  const readyPages = ready.reduce((n, s) => n + s.pages.length, 0);
  const estimate = ready.reduce(
    (sum, s) => sum + s.pages.reduce((n, p) => {
      const f = state.files.find((x) => x.id === p.fileId);
      return n + (f ? f.size / f.pageCount : 0);
    }, 0),
    0,
  );

  // Which new files each source page already went into (copies are named `<source id>~n`).
  const usedBy = new Map<string, string[]>();
  for (const s of ready) {
    const label = stripPdf(nameOf.get(s.id) ?? '');
    for (const p of s.pages) {
      const src = p.id.split('~')[0]!;
      const list = usedBy.get(src) ?? [];
      if (!list.includes(label)) list.push(label);
      usedBy.set(src, list);
    }
  }

  // Nothing is built until a button is pressed, then the review, then this runs.
  const run = async () => {
    const job = pending;
    setPending(null);
    if (!job) return;
    const files = ready.filter((s) => job.ids.includes(s.id));
    if (files.length === 0) return;
    // Building a file loads every source PDF it takes pages from, at once, in the browser's memory.
    const tooBig = files.find((f) => inputsFor(f.pages).reduce((n, i) => n + i.file.size, 0) > MAX_MERGE_SOURCE_BYTES);
    if (tooBig) {
      toast(
        `${nameOf.get(tooBig.id)} takes pages from more than ${fmtSize(MAX_MERGE_SOURCE_BYTES)} of PDFs, more than the browser can load at once. Build it from fewer or smaller files.`,
        'error',
      );
      return;
    }
    setProgress(0);
    try {
      // Each result becomes a Blob straight away, so the page never keeps a second copy of a large file.
      const parts: Array<{ name: string; data: Blob; pages: number }> = [];
      for (let i = 0; i < files.length; i++) {
        const f = files[i]!;
        const data = await api.mergeFiles(inputsFor(f.pages), f.pages);
        parts.push({ name: nameOf.get(f.id)!, data, pages: f.pages.length });
        setProgress(Math.round(((i + 1) / files.length) * 100));
      }
      if (job.kind === 'zip') {
        const how = await saveZipOrFiles(parts, 'merged.zip', MAX_ZIP_BYTES);
        toast(
          how === 'zip'
            ? `merged.zip downloaded · ${plural(parts.length, 'PDF')}`
            : `${plural(parts.length, 'PDF')} downloaded one by one: together they are over ${fmtSize(MAX_ZIP_BYTES)}, too large for one ZIP`,
          'success',
        );
      } else {
        const p = parts[0]!;
        if (job.kind === 'download') {
          saveBlob(p.data, p.name);
          toast(`${p.name} downloaded · ${plural(p.pages, 'page')} · ${fmtSize(p.data.size)}`, 'success');
        } else onEdit(new File([p.data], p.name, { type: 'application/pdf' }));
      }
    } catch (err) {
      if (isWasmMemError(err)) {
        toast(`This file would be too large to build in the browser (the most is about ${fmtSize(MAX_FILE_BYTES)}). Put fewer pages in it, or split it into several files.`, 'error');
        return;
      }
      toast(`Couldn't build the file: ${err instanceof Error ? err.message : 'unknown problem'}. Try again.`, 'error');
    } finally {
      setProgress(null);
    }
  };

  const onDragStart = (e: DragStartEvent) => {
    const page = state.pages.find((p) => p.id === e.active.id);
    if (page) setDragging({ page, count: state.selected.has(page.id) ? state.selected.size : 1 });
  };
  const onDragEnd = (e: DragEndEvent) => {
    setDragging(null);
    const id = String(e.active.id);
    const over = e.over ? String(e.over.id) : '';
    if (id.startsWith('m|')) {
      // Reordering inside one new file.
      const [, splitId, pageId] = id.split('|');
      const [, overSplit, overPage] = over.split('|');
      if (overSplit !== splitId || !overPage || overPage === pageId) return;
      setSplits((prev) =>
        prev.map((s) => {
          if (s.id !== splitId) return s;
          const from = s.pages.findIndex((p) => p.id === pageId);
          const to = s.pages.findIndex((p) => p.id === overPage);
          return from < 0 || to < 0 ? s : { ...s, pages: arrayMove(s.pages, from, to) };
        }),
      );
      return;
    }
    const target = over.startsWith('split:') ? over.slice(6) : over.startsWith('m|') ? over.split('|')[1]! : '';
    if (!target) return;
    addToSplit(target, state.selected.has(id) ? orderedSelection() : [id]);
  };

  const movePage = (splitId: string, pageId: string, delta: -1 | 1) => {
    setSplits((prev) =>
      prev.map((s) => {
        if (s.id !== splitId) return s;
        const i = s.pages.findIndex((p) => p.id === pageId);
        const j = i + delta;
        if (i < 0 || j < 0 || j >= s.pages.length) return s;
        announce(`Page moved to position ${j + 1} in ${s.name}`);
        return { ...s, pages: arrayMove(s.pages, i, j) };
      }),
    );
  };

  const selectedCount = state.selected.size;
  const hasFiles = state.files.length > 0;
  const busy = progress !== null;

  const sections: ReviewSection[] = pending
    ? ready
        .filter((s) => pending.ids.includes(s.id))
        .map((s) => ({
          title: nameOf.get(s.id)!,
          tiles: s.pages.map((p) => ({ key: p.id, page: p, added: true })),
        }))
    : [];

  const previewPages: PageRef[] =
    preview === null ? [] : preview.list === 'pick' ? state.pages : (splits.find((s) => s.id === preview.list)?.pages ?? []);

  const downloadLabel = ready.length > 1 ? `Download ${plural(ready.length, 'PDF')} (.zip)` : 'Download PDF';
  const startDownload = () => setPending(ready.length > 1 ? { kind: 'zip', ids: ready.map((s) => s.id) } : { kind: 'download', ids: ready.map((s) => s.id) });

  // ---- The "New files" panel (an aside on desktop, below the pages on tablet, a bottom sheet on phones) ----
  const buildPanel = (
    <div className="space-y-4">
      <p className="text-xs text-text-muted tabular-nums">
        {splits.length} of {MAX_FILES} files
      </p>
      <Segmented
        label="How to make new files"
        value={mode}
        onChange={setMode}
        options={[
          { value: 'selection', label: 'By selection' },
          { value: 'auto', label: 'Auto-split' },
        ]}
      />

      {mode === 'selection' ? (
        <div className="space-y-3">
          <Button
            variant="secondary"
            className="w-full"
            disabled={selectedCount === 0 || splits.length >= MAX_FILES}
            onClick={() => addToSplit('new', orderedSelection())}
          >
            New file from selection ({selectedCount})
          </Button>
          {selectedCount === 0 && splits.length === 0 && (
            <p className="text-xs text-text-muted">{phone ? 'Tick pages above, then add them to a file.' : 'Tick pages on the left, or drag them here.'}</p>
          )}
          {splits.map((s) => (
            <OutputCard
              key={s.id}
              file={s}
              nameOf={nameOfFile}
              selectedCount={selectedCount}
              busy={busy}
              onAddSelected={() => addToSplit(s.id, orderedSelection())}
              onRename={(name) => setSplits((prev) => prev.map((x) => (x.id === s.id ? { ...x, name } : x)))}
              onDelete={() => deleteSplit(s.id)}
              onDuplicate={() => duplicateSplit(s.id)}
              onDownload={() => setPending({ kind: 'download', ids: [s.id] })}
              onEdit={() => setPending({ kind: 'edit', ids: [s.id] })}
              onRemovePage={(pid) => setSplits((prev) => prev.map((x) => (x.id === s.id ? { ...x, pages: x.pages.filter((p) => p.id !== pid) } : x)))}
              onMovePage={(pid, d) => movePage(s.id, pid, d)}
              onPreview={(i) => setPreview({ list: s.id, index: i })}
              moveButtons={phone}
            />
          ))}
          {!phone && <NewFileSlot disabled={splits.length >= MAX_FILES}>
            {splits.length >= MAX_FILES ? `Limit reached: ${MAX_FILES} files` : 'Drop pages here to start a new file'}
          </NewFileSlot>}
          <Button variant="dashed" icon="plus" className="w-full" disabled={splits.length >= MAX_FILES} onClick={newEmptyFile}>
            New file
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          <SelectField label="Split" value={autoSrc} onChange={(e) => setAutoSrc(e.target.value)}>
            {state.files.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </SelectField>
          <UnitField
            label="Pages per file"
            unit={autoN === 1 ? 'page' : 'pages'}
            min={1}
            value={autoN}
            onChange={(e) => setAutoN(Math.max(1, Math.floor(Number(e.target.value)) || 1))}
            error={autoTooMany ? `That would make ${autoCount} files. The limit is ${MAX_FILES}.` : null}
          />
          <Button variant="secondary" className="w-full" disabled={autoTooMany || autoCount === 0} onClick={requestAuto}>
            Create {plural(autoCount, 'file')}
          </Button>
        </div>
      )}

      <div className="space-y-3 border-t border-divider pt-4">
        <p className="text-sm text-text-muted tabular-nums" data-testid="build-summary">
          {ready.length === 0 ? 'Nothing to download yet' : `${plural(ready.length, 'file')} · ${plural(readyPages, 'page')} · ~${fmtSize(estimate)}`}
        </p>
        <Button
          variant="primary"
          size="xl"
          icon="download"
          className="w-full"
          disabled={ready.length === 0}
          loading={busy}
          loadingLabel={`Building ${progress}%`}
          onClick={startDownload}
        >
          {downloadLabel}
        </Button>
        {ready.length === 0 && <p className="text-xs text-text-muted">Add pages to a file first.</p>}
        {busy && <ProgressBar value={progress} label="Merge progress" step="Building your files" />}
      </div>
    </div>
  );

  const auto = state.files.find((f) => f.id === autoSrc);

  return (
    <div className="space-y-7">
      <PageBar
        title="Split & Merge"
        description="Pick pages from any PDF, arrange them into new files, download."
        hideActionAt="lg"
        status={
          !hasFiles
            ? undefined
            : selectedCount > 0
              ? `${plural(selectedCount, 'page')} selected`
              : ready.length > 0
                ? `${plural(ready.length, 'file')} · ${plural(readyPages, 'page')}`
                : plural(state.files.length, 'file')
        }
        add={hasFiles && <AddButton label="Add PDFs" onClick={() => inputRef.current?.click()} />}
      >
        {selectedCount > 0 ? (
          <Button variant="primary" size="sm" disabled={splits.length >= MAX_FILES} onClick={() => addToSplit('new', orderedSelection())}>
            New file
          </Button>
        ) : ready.length > 0 ? (
          <Button variant="primary" size="sm" icon="download" onClick={startDownload}>
            {ready.length > 1 ? 'Download all' : 'Download PDF'}
          </Button>
        ) : null}
      </PageBar>

      <input
        ref={inputRef}
        type="file"
        multiple
        accept="application/pdf,.pdf"
        className="hidden"
        data-testid="organize-file-input"
        data-yh-add="true"
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) {
            void addFiles(e.target.files);
            e.target.value = '';
          }
        }}
      />

      {!hasFiles ? (
        <EmptyDrop
          onFiles={(f) => void addFiles(f)}
          icon="layers"
          title="Add PDFs to split or merge"
          hint="Pick pages from several files and build new ones."
          onChoose={() => inputRef.current?.click()}
        />
      ) : (
        <>
          {dupes.length > 0 && (
            <Notice
              kind="warning"
              action={
                <div className="flex w-full shrink-0 gap-2 sm:ml-auto sm:w-auto sm:gap-1 max-sm:[&>*]:flex-1">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      const d = dupes;
                      setDupes([]);
                      void addFiles(d, true);
                    }}
                  >
                    Keep both
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => setDupes([])}>
                    Remove duplicate
                  </Button>
                </div>
              }
            >
              {dupes.length === 1 ? dupes[0]!.name + ' is already in your list (same name and size).' : plural(dupes.length, 'file') + ' are already in your list (same name and size).'}
            </Notice>
          )}

          <DndContext
            sensors={phone ? [] : sensors}
            collisionDetection={pointerWithin}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            onDragCancel={() => setDragging(null)}
          >
            <div className="grid items-start gap-6 lg:grid-cols-[3fr_2fr]">
              <Card
                title="Pick pages"
                aside={
                  <div className="flex flex-wrap items-center gap-2">
                    <span role="status" className="text-sm text-text-muted tabular-nums" data-testid="selected-count">
                      {selectedCount} of {state.pages.length} selected
                    </span>
                    <Button size="md" disabled={state.pages.length === 0} onClick={() => dispatch({ t: 'selectAll' })}>
                      Select all
                    </Button>
                    {selectedCount > 0 && (
                      <Button size="md" variant="ghost" onClick={() => dispatch({ t: 'clearSelection' })}>
                        Clear
                      </Button>
                    )}
                  </div>
                }
              >
                <div className="space-y-0">
                  {state.files.map((f, fi) => {
                    const filePages = state.pages.filter((p) => p.fileId === f.id);
                    const isOpen = !collapsed.has(f.id);
                    const picked = filePages.filter((p) => state.selected.has(p.id)).length;
                    return (
                      <section
                        key={f.id}
                        data-testid={`merge-group-${f.id}`}
                        aria-label={f.name}
                        className="border-t border-divider py-4 first:border-t-0 first:pt-0"
                      >
                        <div className="flex items-center gap-3">
                          <h3 className="min-w-0 flex-1">
                            <button
                              type="button"
                              aria-expanded={isOpen}
                              onClick={() =>
                                setCollapsed((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(f.id)) next.delete(f.id);
                                  else next.add(f.id);
                                  return next;
                                })
                              }
                              className="flex min-h-10 w-full min-w-0 items-center gap-2.5 rounded-md text-left max-sm:flex-wrap max-sm:gap-y-0"
                            >
                              <Icon name="next" size={16} className={`text-text-muted transition-transform duration-200 ${isOpen ? 'rotate-90' : ''}`} />
                              <IdBadge n={fi + 1} />
                              <span className="min-w-0 flex-1 truncate text-[15px] leading-[22px] font-semibold max-sm:text-sm" title={f.name}>
                                {f.name}
                              </span>
                              <span className="shrink-0 text-xs text-text-muted tabular-nums max-sm:order-last max-sm:basis-full max-sm:pl-[26px]">
                                {picked > 0 ? `${picked} of ` : ''}
                                {plural(filePages.length, 'page')}
                                {!isOpen ? ' · Show' : ''}
                              </span>
                            </button>
                          </h3>
                          <Checkbox
                            bordered
                            label={
                              <span className="text-[13px] font-semibold text-accent">
                                <span className="max-sm:hidden">Select all</span>
                                <span className="sm:hidden">All</span>
                              </span>
                            }
                            aria-label={`Select all pages of ${f.name}`}
                            checked={picked === filePages.length && picked > 0}
                            indeterminate={picked > 0 && picked < filePages.length}
                            disabled={filePages.length === 0}
                            onChange={(e) => dispatch({ t: 'setMany', ids: filePages.map((p) => p.id), on: e.target.checked })}
                          />
                          <IconButton icon="trash" label={`Remove ${f.name}`} tip="Remove this PDF" danger onClick={() => removeFile(f.id)} />
                        </div>
                        <Collapse open={isOpen}>
                          <div className="space-y-4 pt-3">
                            <RangeField
                              name={f.name}
                              pageCount={f.pageCount}
                              onApply={(idx) => {
                                const set = new Set(idx);
                                dispatch({ t: 'setMany', ids: filePages.map((p) => p.id), on: false });
                                dispatch({ t: 'setMany', ids: filePages.filter((p) => set.has(p.srcIndex)).map((p) => p.id), on: true });
                              }}
                            />
                            {isOpen && (
                              <PageGrid
                                pages={filePages}
                                fileName={f.name}
                                fileNo={fi + 1}
                                selected={state.selected}
                                usedBy={usedBy}
                                onSetMany={(ids, on) => dispatch({ t: 'setMany', ids, on })}
                                onToggle={(id) => dispatch({ t: 'select', id, on: !state.selected.has(id) })}
                                onZoom={(i) => setPreview({ list: 'pick', index: state.pages.indexOf(filePages[i]!) })}
                              />
                            )}
                          </div>
                        </Collapse>
                      </section>
                    );
                  })}
                </div>
              </Card>

              <aside aria-label="New files" className="min-w-0 lg:sticky lg:top-[calc(var(--header-h)+24px)]">
                <Card title="New files">{buildPanel}</Card>
              </aside>
            </div>

            <DragOverlay>
              {dragging && (
                <div className="relative w-20 rounded-md border border-border bg-surface p-1 shadow-3" style={{ transform: 'scale(1.03) rotate(1deg)' }}>
                  <Thumb page={dragging.page} width={72} />
                  {dragging.count > 1 && (
                    <span className="absolute -right-2 -top-2 rounded-pill bg-accent px-1.5 py-0.5 text-xs font-semibold text-white">{dragging.count}</span>
                  )}
                </div>
              )}
            </DragOverlay>
          </DndContext>
        </>
      )}

      <ChangeReview
        open={pending !== null}
        title="Review before downloading"
        summary={`${plural(sections.length, 'new PDF')} will be created${pending?.kind === 'zip' ? ' and bundled into one .zip' : ''}. Your originals are not changed.`}
        sections={sections}
        confirmLabel="Confirm and merge"
        onCancel={() => setPending(null)}
        onConfirm={() => void run()}
        caption={caption}
      />
      <ConfirmDialog
        open={confirmAuto}
        title="Replace your new files?"
        message={`Auto-split replaces the ${plural(splits.length, 'file')} you built with ${plural(autoCount, 'new file')} from ${auto?.name ?? 'this PDF'}.`}
        confirmLabel="Replace files"
        danger
        onConfirm={runAuto}
        onCancel={() => setConfirmAuto(false)}
      />
      <PagePreview
        pages={previewPages}
        index={preview ? preview.index : null}
        onIndex={(i) => setPreview(i === null || !preview ? null : { list: preview.list, index: i })}
        caption={caption}
      />
    </div>
  );
}
