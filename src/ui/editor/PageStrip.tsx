import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, arrayMove, horizontalListSortingStrategy, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useState } from 'react';
import type { PageSpec } from '../../lib/pdf/pages.ts';
import { Thumb } from '../Thumb.tsx';
import { IconButton } from '../kit.tsx';

type Props = {
  docKey: string;
  pageCount: number;
  /** Changes whenever the file is replaced, so thumbnails redraw. */
  rev: number;
  current: number;
  busy: boolean;
  /** A column in the sidebar, a row in the phone sheet. */
  layout: 'column' | 'row';
  onSelect: (i: number) => void;
  /** New page list (source index + extra rotation) and the page to show afterwards. */
  onReshape: (specs: PageSpec[], keepPage: number) => void;
};

function Item({ i, docKey, rev, current, busy, only, end, row, onSelect, onRotate, onDelete, onMove }: {
  i: number;
  docKey: string;
  rev: number;
  current: boolean;
  busy: boolean;
  only: boolean;
  end: boolean;
  row: boolean;
  onSelect: () => void;
  onRotate: (d: 90 | -90) => void;
  onDelete: () => void;
  onMove: (d: -1 | 1) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: `p${i}`, disabled: busy });
  const n = i + 1;
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      data-testid={`strip-page-${n}`}
      className={`group relative shrink-0 rounded-lg ${row ? 'w-28' : 'w-full'} ${isDragging ? 'z-10 opacity-60' : ''}`}
    >
      <button
        type="button"
        onClick={onSelect}
        aria-label={`Go to page ${n}`}
        aria-current={current ? 'page' : undefined}
        {...attributes}
        {...listeners}
        className={`flex aspect-[3/4] w-full cursor-grab touch-manipulation items-center justify-center overflow-hidden rounded-md bg-surface-muted p-1 transition-[border-color] duration-150 ${
          current ? 'border-2 border-accent' : 'border border-border hover:border-border-hover'
        }`}
      >
        <Thumb key={`${rev}-${i}`} page={{ id: `${docKey}:${i}`, fileId: docKey, srcIndex: i, rotation: 0 }} width={96} />
      </button>
      <p className="mt-1 text-center text-xs text-text-muted tabular-nums">{n}</p>
      {/* Page actions sit under the page, always visible, so nothing covers the thumbnail or the other buttons. */}
      <div className="mt-0.5 flex justify-center gap-0.5">
        <IconButton icon="rotateLeft" label={`Rotate page ${n} left`} tip="Rotate left" size="sm" disabled={busy} onClick={() => onRotate(-90)} />
        <IconButton icon="rotateRight" label={`Rotate page ${n} right`} tip="Rotate right" size="sm" disabled={busy} onClick={() => onRotate(90)} />
        <IconButton icon="prev" label={`Move page ${n} ${row ? 'left' : 'up'}`} tip="Move earlier" size="sm" disabled={busy || i === 0} onClick={() => onMove(-1)} className={row ? '' : 'rotate-90'} />
        <IconButton icon="next" label={`Move page ${n} ${row ? 'right' : 'down'}`} tip="Move later" size="sm" disabled={busy || end} onClick={() => onMove(1)} className={row ? '' : 'rotate-90'} />
        <IconButton icon="trash" label={`Delete page ${n}`} tip="Delete page" size="sm" danger disabled={busy || only} onClick={onDelete} />
      </div>
    </li>
  );
}

const CHUNK = { column: 4, row: 8 } as const;

/** Page list for the Edit tool, one pager window at a time: rotate, delete, drag to reorder (or use the move buttons). */
export function PageStrip({ docKey, pageCount, rev, current, busy, layout, onSelect, onReshape }: Props) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const row = layout === 'row';
  const size = CHUNK[layout];
  const chunkOf = (p: number) => Math.floor(Math.max(0, p) / size) * size;
  // The window follows the current page; the pager arrows and the jump box move it on their own.
  const [win, setWin] = useState({ cur: current, start: chunkOf(current) });
  if (win.cur !== current) setWin({ cur: current, start: chunkOf(current) });
  const start = Math.min(win.start, chunkOf(pageCount - 1));
  const end = Math.min(pageCount, start + size);
  const paged = pageCount > size;
  const [jump, setJump] = useState('');
  const go = (p: number) => {
    const t = Math.max(0, Math.min(pageCount - 1, p));
    onSelect(t);
    setWin({ cur: t, start: chunkOf(t) });
  };

  const identity = (): PageSpec[] => Array.from({ length: pageCount }, (_, i) => ({ srcIndex: i, rotation: 0 }));
  const move = (from: number, to: number) => {
    if (to < 0 || to >= pageCount || from === to) return;
    onReshape(arrayMove(identity(), from, to), to);
  };
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    move(Number(String(e.active.id).slice(1)), Number(String(e.over.id).slice(1)));
  };
  const shown = Array.from({ length: end - start }, (_, k) => start + k);

  return (
    <div className="space-y-3">
      {paged && (
        <div className="flex items-center justify-between gap-1" role="group" aria-label="Page window">
          <IconButton icon="prev" label="Previous pages" size="sm" disabled={start === 0} onClick={() => setWin({ cur: current, start: start - size })} />
          <span className="text-xs tabular-nums text-text-muted" data-testid="strip-range">
            {start + 1}–{end} of {pageCount}
          </span>
          <IconButton icon="next" label="Next pages" size="sm" disabled={end >= pageCount} onClick={() => setWin({ cur: current, start: start + size })} />
        </div>
      )}
      {paged && (
        <form
          className="flex items-center gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            const n = parseInt(jump, 10);
            if (Number.isFinite(n)) go(n - 1);
            setJump('');
          }}
        >
          <label className="sr-only" htmlFor="strip-jump">
            Go to page
          </label>
          <input
            id="strip-jump"
            type="number"
            min={1}
            max={pageCount}
            value={jump}
            placeholder="Go to"
            onChange={(e) => setJump(e.target.value)}
            className="min-h-8 w-full min-w-0 rounded-md border border-border-strong bg-surface px-2 text-xs tabular-nums"
          />
          <button type="submit" className="min-h-8 shrink-0 rounded-md px-2 text-xs font-semibold text-accent hover:bg-surface-sunken">
            Go
          </button>
        </form>
      )}
      <DndContext sensors={row ? [] : sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={shown.map((i) => `p${i}`)} strategy={row ? horizontalListSortingStrategy : verticalListSortingStrategy}>
          <ul data-testid="page-strip" aria-label="Pages" className={row ? 'flex gap-2 overflow-x-auto pb-1' : 'flex flex-col gap-3'}>
            {shown.map((i) => (
              <Item
                key={`${rev}-${i}`}
                i={i}
                docKey={docKey}
                rev={rev}
                current={i === current}
                busy={busy}
                only={pageCount === 1}
                end={i === pageCount - 1}
                row={row}
                onSelect={() => onSelect(i)}
                onRotate={(d) => onReshape(identity().map((sp, k) => (k === i ? { ...sp, rotation: d } : sp)), i)}
                onDelete={() => onReshape(identity().filter((_, k) => k !== i), Math.min(i, pageCount - 2))}
                onMove={(d) => move(i, i + d)}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
    </div>
  );
}
