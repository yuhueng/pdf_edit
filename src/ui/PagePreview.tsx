import { useEffect, useRef, useState } from 'react';
import type { PageRef } from '../lib/pdf/types.ts';
import { renderPage } from '../lib/render.ts';
import { IconButton, Segmented } from './kit.tsx';
import { usePinch } from './usePinch.ts';

type Props = {
  pages: PageRef[];
  /** Index into `pages`, or null when closed. */
  index: number | null;
  onIndex: (i: number | null) => void;
  /** Shown above the page, e.g. "File 2, page 3". */
  caption?: (p: PageRef) => string;
};

const SIZES = [50, 75, 100, 150] as const;
const clampSize = (n: number) => Math.min(400, Math.max(25, Math.round(n)));
const BASE_SCALE = 1.4; // 100% is the size the preview always used

/** One page, large: choose its size (50%, 75%, 100%, 150%), step through pages, or jump to a page number. */
export function PagePreview({ pages, index, onIndex, caption }: Props) {
  const dlg = useRef<HTMLDialogElement | null>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const [size, setSize] = useState<number>(100); // a percentage: the buttons set 50 to 150, a pinch anything in between
  const scroller = useRef<HTMLDivElement | null>(null);
  usePinch(scroller, () => canvas.current, (f) => setSize((s) => clampSize(s * f)));
  const [jump, setJump] = useState('');
  const page = index === null ? undefined : pages[index];

  useEffect(() => {
    const d = dlg.current;
    if (!d) return;
    if (page && !d.open) d.showModal();
    if (!page && d.open) d.close();
  }, [page]);

  useEffect(() => {
    if (!page || !canvas.current) return;
    void renderPage(page.fileId, page.srcIndex, canvas.current, (BASE_SCALE * size) / 100).catch(() => {});
  }, [page, size]);

  useEffect(() => {
    if (index === null) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      if (e.key === 'ArrowLeft' && index > 0) onIndex(index - 1);
      if (e.key === 'ArrowRight' && index < pages.length - 1) onIndex(index + 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, pages.length, onIndex]);

  const go = () => {
    const n = parseInt(jump, 10);
    if (Number.isFinite(n)) onIndex(Math.max(0, Math.min(pages.length - 1, n - 1)));
    setJump('');
  };

  return (
    <dialog
      ref={dlg}
      aria-label="Page preview"
      onClose={() => onIndex(null)}
      onClick={(e) => e.target === dlg.current && onIndex(null)}
      className="yh-dialog yh-dialog-wide"
    >
      {page && index !== null && (
        <div className="space-y-3 p-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-[17px] leading-6 font-semibold">{caption ? caption(page) : `Page ${page.srcIndex + 1}`}</h2>
            <IconButton icon="close" label="Close preview" onClick={() => onIndex(null)} />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <Segmented
              label="Preview size"
              size="sm"
              value={size}
              onChange={(v) => setSize(v)}
              options={SIZES.map((s) => ({ value: s, label: `${s}%` }))}
            />
            <div className="flex items-center gap-1">
              <IconButton icon="prev" label="Previous page in preview" disabled={index <= 0} onClick={() => onIndex(index - 1)} />
              <span className="min-w-14 text-center text-xs tabular-nums text-text-muted">
                {index + 1} / {pages.length}
              </span>
              <IconButton icon="next" label="Next page in preview" disabled={index >= pages.length - 1} onClick={() => onIndex(index + 1)} />
              {pages.length > 1 && (
                <form
                  className="ml-1 flex items-center gap-1"
                  onSubmit={(e) => {
                    e.preventDefault();
                    go();
                  }}
                >
                  <input
                    type="number"
                    min={1}
                    max={pages.length}
                    value={jump}
                    placeholder="Go to"
                    aria-label="Go to preview page"
                    onChange={(e) => setJump(e.target.value)}
                    className="min-h-8 w-16 rounded-md border border-border-strong bg-surface px-2 text-xs tabular-nums"
                  />
                  <button type="submit" className="min-h-8 px-1.5 text-xs font-semibold text-accent">
                    Go
                  </button>
                </form>
              )}
            </div>
          </div>

          <div ref={scroller} className="flex max-h-[68dvh] touch-pan-x touch-pan-y justify-center overflow-auto rounded-lg bg-surface-sunken p-3">
            <canvas ref={canvas} style={{ transform: `rotate(${page.rotation}deg)` }} className="shrink-0 bg-white shadow-2" />
          </div>
        </div>
      )}
    </dialog>
  );
}
