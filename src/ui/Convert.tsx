import { useEffect, useRef, useState } from 'react';
import { saveBlob, saveZipOrFiles } from '../lib/download.ts';
import { fmtSize, MAX_ZIP_BYTES, plural, stripPdf } from '../lib/format.ts';
import type { ConvertFile, ConvertFormat } from '../lib/pdf/convert.ts';
import { parseRanges } from '../lib/pdf/ranges.ts';
import type { PdfApi } from '../lib/pdf/types.ts';
import { ChangeReview } from './ChangeReview.tsx';
import { EmptyDrop } from './DropFiles.tsx';
import { pdfsOnly, useDropFiles } from './dropEvents.ts';
import { AddButton, Button, Card, Icon, IconButton, IdBadge, Notice, PageBar, ProgressBar, Segmented, TextField, type IconName } from './kit.tsx';
import { prepareFile } from './Password.tsx';
import { toast } from './Toasts.tsx';

type Doc = { file: File; name: string; pageCount: number; origSize: number };

const FORMATS: Array<{ id: ConvertFormat; label: string; hint: string; icon: IconName; kind: string }> = [
  { id: 'png', label: 'Images (PNG)', hint: 'One sharp image per page. Best for scans.', icon: 'image', kind: 'PNG images' },
  { id: 'jpeg', label: 'Images (JPEG)', hint: 'Smaller images, good for photos.', icon: 'image', kind: 'JPEG images' },
  { id: 'html', label: 'HTML (.html)', hint: 'A simple web page with headings and lists.', icon: 'convert', kind: 'HTML file' },
];

const QUALITY = [
  { value: 96, label: 'Screen 96 dpi' },
  { value: 150, label: 'Standard 150' },
  { value: 300, label: 'Print 300' },
];

const isImage = (f: ConvertFormat) => f === 'png' || f === 'jpeg';
const blobOf = (f: ConvertFile) => new Blob([f.bytes as Uint8Array<ArrayBuffer>], { type: f.mime });

/** Rough size of an image export, for the summary only. */
function estimate(format: ConvertFormat, pages: number, dpi: number): number {
  const perPage = (format === 'png' ? 130_000 : 55_000) * (dpi / 150) ** 2;
  return pages * perPage;
}

/** Convert a PDF to images, Markdown, text or HTML, all in the browser. */
export function Convert({ api }: { api: PdfApi }) {
  const [doc, setDoc] = useState<Doc | null>(null);
  const [format, setFormat] = useState<ConvertFormat>('png');
  const [scope, setScope] = useState<'all' | 'custom'>('all');
  const [range, setRange] = useState('');
  const [rangeTouched, setRangeTouched] = useState(false);
  const [dpi, setDpi] = useState(150);
  const [review, setReview] = useState(false);
  const [pct, setPct] = useState<number | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const clear = () => {
      setDoc(null);
      setWarnings([]);
      setRange('');
    };
    window.addEventListener('yh:clear', clear);
    return () => window.removeEventListener('yh:clear', clear);
  }, []);

  const open = async (files: File[] | FileList) => {
    const orig = pdfsOnly(files)[0];
    if (!orig) return;
    const ready = await prepareFile(api, orig);
    if (!ready) return;
    setDoc({ file: ready.file, name: orig.name, pageCount: ready.pageCount, origSize: orig.size });
    setWarnings([]);
    setRange('');
    setScope('all');
  };
  useDropFiles('convert', (f) => void open(f));

  const parsed = doc
    ? scope === 'all'
      ? { ok: true as const, indices: Array.from({ length: doc.pageCount }, (_, i) => i) }
      : range.trim() === ''
        ? { ok: false as const, message: 'Enter the pages to convert.' }
        : parseRanges(range, doc.pageCount)
    : null;
  const base = doc ? stripPdf(doc.name).replace(/[\\/:*?"<>|]/g, '_') : '';
  const count = parsed && parsed.ok ? parsed.indices.length : 0;
  const fmt = FORMATS.find((f) => f.id === format)!;
  const rangeError =
    scope === 'custom' && rangeTouched && parsed && !parsed.ok && doc
      ? /out of range/.test(parsed.message)
        ? `Page ${/"(\d+)"/.exec(parsed.message)?.[1] ?? ''} doesn't exist. This file has ${plural(doc.pageCount, 'page')}.`
        : parsed.message
      : null;

  const run = async () => {
    setReview(false);
    if (!doc || !parsed || !parsed.ok) return;
    setPct(0);
    setWarnings([]);
    try {
      const res = await api.convert(
        new Uint8Array(await doc.file.arrayBuffer()),
        { format, pages: parsed.indices, dpi, baseName: base },
        (d, t) => setPct(t > 0 ? Math.round((d / t) * 100) : 100),
      );
      setWarnings(res.warnings);
      if (res.files.length === 1) {
        const f = res.files[0]!;
        saveBlob(blobOf(f), f.name);
        toast(`${f.name} downloaded · ${fmtSize(f.bytes.length)}`, 'success');
      } else {
        const how = await saveZipOrFiles(res.files.map((f) => ({ name: f.name, data: blobOf(f) })), `${base}-${format}.zip`, MAX_ZIP_BYTES);
        toast(
          how === 'zip'
            ? `${base}-${format}.zip downloaded · ${plural(res.files.length, 'file')}`
            : `${plural(res.files.length, 'file')} downloaded one by one: together they are over ${fmtSize(MAX_ZIP_BYTES)}, too large for one ZIP`,
          'success',
        );
      }
    } catch (err) {
      toast(`The conversion didn't finish: ${err instanceof Error ? err.message : 'unknown problem'}. Try again.`, 'error');
    } finally {
      setPct(null);
    }
  };

  const zipped = isImage(format) && count !== 1;
  const sizeText = isImage(format) ? ` · about ${fmtSize(estimate(format, count, dpi))}` : '';

  return (
    <div className="space-y-7">
      <PageBar
        title="Convert"
        description="Export pages as images or a simple web page."
        status={
          !doc
            ? undefined
            : count === 0
              ? 'Choose pages to convert'
              : `${isImage(format) ? plural(count, fmt.kind.replace(/s$/, '')) : `1 ${fmt.kind}`} · ${zipped ? '.zip' : `.${format === 'jpeg' ? 'jpg' : format}`}`
        }
        add={doc && <AddButton label="Change PDF" onClick={() => inputRef.current?.click()} />}
      >
        {doc && (
          <Button
            variant="primary"
            size="sm"
            icon="download"
            loading={pct !== null}
            loadingLabel={`Converting ${pct}%`}
            onClick={() => {
              setRangeTouched(true);
              if (parsed && parsed.ok) setReview(true);
            }}
          >
            Convert and download
          </Button>
        )}
      </PageBar>

      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,.pdf"
        className="hidden"
        data-testid="convert-file-input"
        data-yh-add="true"
        onChange={(e) => {
          if (e.target.files?.length) void open(e.target.files);
          e.target.value = '';
        }}
      />

      {!doc ? (
        <EmptyDrop
          icon="convert"
          title="Open a PDF to convert"
          hint="Export pages as images or a simple web page."
          chooseLabel="Choose a PDF"
          onFiles={(f) => void open(f)}
          onChoose={() => inputRef.current?.click()}
        />
      ) : (
        <>
          <div className="grid items-start gap-6 lg:grid-cols-[3fr_2fr]">
            <div className="min-w-0 space-y-6">
            <Card title="Your PDF">
              <div className="flex items-center gap-3">
                <IdBadge n={1} />
                <span className="min-w-0 flex-1 truncate text-sm font-medium" title={doc.name}>
                  {doc.name}
                </span>
                <span className="shrink-0 text-xs text-text-muted tabular-nums">
                  {fmtSize(doc.file.size)} · {plural(doc.pageCount, 'page')}
                </span>
                <IconButton icon="trash" label={`Remove ${doc.name}`} tip="Remove this PDF" danger onClick={() => setDoc(null)} />
              </div>
            </Card>
            <Card title="Format">
              <fieldset className="grid gap-3 sm:grid-cols-2">
                <legend className="sr-only">Output format</legend>
                {FORMATS.map((f) => {
                  const on = f.id === format;
                  return (
                    <label
                      key={f.id}
                      className={`relative flex min-h-14 cursor-pointer items-center gap-3 rounded-lg px-3.5 py-2.5 transition-[border-color,background-color] duration-150 ${
                        on ? 'border-2 border-accent bg-accent-tint px-[13px] py-[9px]' : 'border border-border hover:border-border-hover'
                      } has-[:focus-visible]:shadow-focus`}
                    >
                      <input
                        type="radio"
                        name="format"
                        value={f.id}
                        checked={on}
                        onChange={() => {
                          setFormat(f.id);
                          setWarnings([]);
                        }}
                        aria-label={f.label}
                        className="absolute inset-0 h-full w-full cursor-pointer appearance-none rounded-lg opacity-0"
                      />
                      <span className={on ? 'text-accent' : 'text-text-muted'}>
                        <Icon name={f.icon} size={20} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium">{f.label}</span>
                        <span className="block text-xs leading-4 text-text-muted">{f.hint}</span>
                      </span>
                      <span aria-hidden="true" className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-[1.5px] ${on ? 'border-accent' : 'border-border-strong'}`}>
                        {on && <span className="h-2 w-2 rounded-full bg-accent" />}
                      </span>
                    </label>
                  );
                })}
              </fieldset>

              <div className="space-y-2">
                <p className="text-[13px] font-medium">Pages</p>
                <Segmented
                  label="Page selection"
                  value={scope}
                  onChange={(v) => {
                    setScope(v);
                    setRangeTouched(false);
                  }}
                  options={[
                    { value: 'all', label: 'All' },
                    { value: 'custom', label: 'Custom' },
                  ]}
                />
                {scope === 'custom' && (
                  <TextField
                    label="Page range"
                    value={range}
                    placeholder="All pages"
                    help="e.g. 1-3, 5, 8-11"
                    error={rangeError}
                    aria-label="Pages to convert"
                    className="max-w-xs"
                    onChange={(e) => {
                      setRange(e.target.value);
                      setRangeTouched(false);
                    }}
                    onBlur={() => setRangeTouched(true)}
                  />
                )}
              </div>

              {isImage(format) && (
                <div className="space-y-2">
                  <p className="text-[13px] font-medium">Quality</p>
                  <Segmented label="Image resolution" value={dpi} onChange={setDpi} options={QUALITY} />
                </div>
              )}
            </Card>
            </div>

            <aside aria-label="Output" className="min-w-0 lg:sticky lg:top-[calc(var(--header-h)+24px)]">
              <Card title="Output">
                <p className="text-sm tabular-nums" data-testid="convert-summary">
                  {count === 0
                    ? 'Choose which pages to convert.'
                    : `${isImage(format) ? plural(count, fmt.kind.replace(/s$/, '')) : `1 ${fmt.kind}`}${sizeText} · downloads as ${zipped ? '.zip' : `.${format === 'jpeg' ? 'jpg' : format}`}`}
                </p>
                <p className="text-xs text-text-muted">Your PDF isn&rsquo;t changed.</p>
                <Button
                  variant="primary"
                  size="xl"
                  icon="download"
                  className="w-full max-sm:hidden"
                  loading={pct !== null}
                  loadingLabel={`Converting ${pct}%`}
                  onClick={() => {
                    setRangeTouched(true);
                    if (parsed && parsed.ok) setReview(true);
                  }}
                >
                  Convert and download
                </Button>
                {pct !== null && <ProgressBar value={pct} label="Conversion progress" step="Converting pages" />}
                {warnings.map((w) => (
                  <Notice key={w} kind="warning">
                    {w}
                  </Notice>
                ))}
              </Card>
            </aside>
          </div>
        </>
      )}

      <ChangeReview
        open={review}
        title="Review before converting"
        summary={`${doc?.name ?? ''}: ${plural(count, 'page')} will be converted to ${fmt.label}${isImage(format) ? ` at ${dpi} dpi` : ''}. The PDF itself is not changed.`}
        sections={[]}
        confirmLabel="Confirm and convert"
        onCancel={() => setReview(false)}
        onConfirm={() => void run()}
      />
    </div>
  );
}
