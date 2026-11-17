import { useWindowVirtualizer } from '@tanstack/react-virtual';
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { PageRef } from '../lib/pdf/types.ts';
import { IconButton } from './kit.tsx';
import { PageThumb } from './PageThumb.tsx';
import { useMedia } from './useMedia.ts';

type Props = {
  pages: PageRef[];
  fileName: string;
  fileNo: number;
  selected: Set<string>;
  /** Source page id -> names of the new files it was added to. */
  usedBy?: Map<string, string[]>;
  /** Add (on) or remove (off) several pages from the selection at once. */
  onSetMany: (ids: string[], on: boolean) => void;
  onToggle: (id: string) => void;
  onZoom: (index: number) => void;
  /** Viewer mode: no checks, no dragging. */
  readOnly?: boolean;
  /** Prefix for labels in mixed views, e.g. "F2 · ". */
  labelPrefix?: string;
};

const GAP = 14;
const GAP_MOBILE = 10;
const EXTRA = 22 /* label */ + 26; /* room for the "In <file>" pill, so rows keep one height */

/**
 * The pages of one file. The grid never scrolls by itself: a long file makes the page longer. Rows are
 * virtualised against the window, so only the rows near the screen are drawn.
 */
function WindowGrid({ pages, fileName, fileNo, selected, usedBy, onSetMany, onToggle, onZoom, readOnly, labelPrefix = '' }: Props) {
  const root = useRef<HTMLDivElement | null>(null);
  const anchor = useRef<number | null>(null);
  const [geo, setGeo] = useState({ cols: 4, w: 120, gap: GAP });
  const [margin, setMargin] = useState(0);

  // Column count: auto-fill, minimum thumbnail 120px (96px on phones).
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const measure = () => {
      const total = el.clientWidth;
      const phone = window.innerWidth < 640;
      const min = phone ? 96 : 120;
      const gap = phone ? GAP_MOBILE : GAP;
      const cols = Math.max(2, Math.floor((total + gap) / (min + gap)));
      setGeo({ cols, w: (total - gap * (cols - 1)) / cols, gap });
      setMargin(el.getBoundingClientRect().top + window.scrollY);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    ro.observe(document.body); // content above this grid growing or shrinking moves it
    return () => ro.disconnect();
  }, [pages.length]);

  const rowH = Math.ceil((geo.w * 4) / 3) + EXTRA + geo.gap;
  const rows = Math.ceil(pages.length / geo.cols);
  const virt = useWindowVirtualizer({ count: rows, estimateSize: () => rowH, overscan: 3, scrollMargin: margin });

  useEffect(() => {
    virt.measure();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowH, geo.cols]);

  const toggle = (index: number, shift: boolean) => {
    const id = pages[index]!.id;
    if (shift && anchor.current !== null) {
      const [a, b] = [Math.min(anchor.current, index), Math.max(anchor.current, index)];
      onSetMany(pages.slice(a, b + 1).map((p) => p.id), true);
    } else {
      onToggle(id);
      anchor.current = index;
    }
  };

  // Keyboard: arrows move focus, Shift+arrows extend the selection, Ctrl/Cmd+A selects every page of this file.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a' && !readOnly) {
      e.preventDefault();
      onSetMany(pages.map((p) => p.id), true);
      return;
    }
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowDown' ? geo.cols : e.key === 'ArrowUp' ? -geo.cols : 0;
    if (!step) return;
    const li = (e.target as HTMLElement).closest('[data-testid^="page-tile-"]');
    const cur = pages.findIndex((p) => `page-tile-${p.id}` === li?.getAttribute('data-testid'));
    if (cur < 0) return;
    const next = Math.max(0, Math.min(pages.length - 1, cur + step));
    e.preventDefault();
    if (e.shiftKey && !readOnly) {
      const a = Math.min(cur, next);
      const b = Math.max(cur, next);
      onSetMany(pages.slice(a, b + 1).map((p) => p.id), true);
    }
    virt.scrollToIndex(Math.floor(next / geo.cols));
    // Wait a frame so a row that was virtualised away has been drawn again.
    requestAnimationFrame(() => root.current?.querySelector<HTMLInputElement>(`[data-testid="page-tile-${pages[next]!.id}"] input`)?.focus());
  };

  return (
    <div
      ref={root}
      role="list"
      aria-label={`Pages of ${fileName}`}
      data-testid="page-grid"
      onKeyDown={onKeyDown}
      className="relative w-full"
      style={{ height: virt.getTotalSize() }}
    >
      {virt.getVirtualItems().map((vRow) => {
        const start = vRow.index * geo.cols;
        return (
          <div
            key={vRow.key}
            role="presentation"
            className="absolute left-0 grid w-full"
            style={{
              top: 0,
              transform: `translateY(${vRow.start - margin}px)`,
              gridTemplateColumns: `repeat(${geo.cols}, minmax(0, 1fr))`,
              columnGap: geo.gap,
            }}
          >
            {pages.slice(start, start + geo.cols).map((page, i) => (
              <PageThumb
                key={page.id}
                page={page}
                label={`${labelPrefix}Page ${page.srcIndex + 1}`}
                checkLabel={`Page ${page.srcIndex + 1} of ${fileName}`}
                width={Math.round(geo.w)}
                selected={selected.has(page.id)}
                onToggle={(shift) => toggle(start + i, shift)}
                onZoom={() => onZoom(start + i)}
                usedBy={usedBy?.get(page.id)}
                readOnly={readOnly}
              />
            ))}
          </div>
        );
      })}
      <span hidden>{fileNo}</span>
    </div>
  );
}

const PHONE_WINDOW = 4;

/** Phones: four pages at a time with arrows and a jump box, instead of a long scroll. */
function PagedGrid({ pages, fileName, selected, usedBy, onToggle, onZoom, readOnly, labelPrefix = '' }: Props) {
  const [start, setStart] = useState(0);
  const [jump, setJump] = useState('');
  const first = Math.min(start, Math.max(0, Math.floor((pages.length - 1) / PHONE_WINDOW) * PHONE_WINDOW));
  const end = Math.min(pages.length, first + PHONE_WINDOW);
  const paged = pages.length > PHONE_WINDOW;
  return (
    <div className="space-y-2.5" data-testid="page-grid" role="list" aria-label={`Pages of ${fileName}`}>
      {paged && (
        <div className="flex items-center gap-2" role="presentation">
          <IconButton icon="prev" label={`Previous pages of ${fileName}`} size="sm" disabled={first === 0} onClick={() => setStart(first - PHONE_WINDOW)} />
          <span className="flex-1 text-center text-xs tabular-nums text-text-muted" data-testid="pager-range">
            {first + 1}–{end} of {pages.length}
          </span>
          <IconButton icon="next" label={`Next pages of ${fileName}`} size="sm" disabled={end >= pages.length} onClick={() => setStart(first + PHONE_WINDOW)} />
          <form
            className="flex items-center gap-1"
            onSubmit={(e) => {
              e.preventDefault();
              const n = parseInt(jump, 10);
              if (Number.isFinite(n)) setStart(Math.floor((Math.max(1, Math.min(pages.length, n)) - 1) / PHONE_WINDOW) * PHONE_WINDOW);
              setJump('');
            }}
          >
            <input
              type="number"
              min={1}
              max={pages.length}
              value={jump}
              placeholder="Go to"
              aria-label={`Go to page of ${fileName}`}
              onChange={(e) => setJump(e.target.value)}
              className="min-h-8 w-16 rounded-md border border-border-strong bg-surface px-2 text-xs tabular-nums"
            />
            <button type="submit" className="min-h-8 px-1.5 text-xs font-semibold text-accent">
              Go
            </button>
          </form>
        </div>
      )}
      <div className="grid grid-cols-4 gap-2">
        {pages.slice(first, end).map((page, k) => (
          <PageThumb
            key={page.id}
            page={page}
            label={`${labelPrefix}Page ${page.srcIndex + 1}`}
            checkLabel={`Page ${page.srcIndex + 1} of ${fileName}`}
            width={90}
            selected={selected.has(page.id)}
            onToggle={() => onToggle(page.id)}
            onZoom={() => onZoom(first + k)}
            usedBy={usedBy?.get(page.id)}
            readOnly={readOnly}
          />
        ))}
      </div>
    </div>
  );
}

/** The pages of one file: a window-virtualised grid on wide screens, a four-at-a-time pager on phones. */
export function PageGrid(props: Props) {
  const phone = useMedia('(max-width: 639px)');
  return phone ? <PagedGrid {...props} /> : <WindowGrid {...props} />;
}
