import { useDroppable } from '@dnd-kit/core';
import { SortableContext, rectSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { plural } from '../lib/format.ts';
import type { PageRef } from '../lib/pdf/types.ts';
import { Thumb } from './Thumb.tsx';
import { Button, DropdownMenu, Icon, IconButton } from './kit.tsx';

export const MAX_FILES = 10;
export type SplitFile = { id: string; name: string; pages: PageRef[] };

/** Id of a mini thumbnail inside an output card (so it never collides with a source page id). */
export const miniId = (fileId: string, pageId: string) => `m|${fileId}|${pageId}`;

type MiniProps = {
  id: string;
  page: PageRef;
  label: string;
  index: number;
  onPreview: () => void;
  onRemove: () => void;
  onMove: (delta: -1 | 1) => void;
  moveButtons: boolean;
  first: boolean;
  last: boolean;
};

function MiniThumb({ id, page, label, index, onPreview, onRemove, onMove, moveButtons, first, last }: MiniProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <div
      ref={setNodeRef}
      role="listitem"
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`group relative w-16 shrink-0 ${isDragging ? 'z-10 opacity-60' : ''}`}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        onClick={onPreview}
        onKeyDown={(e) => {
          // Alt+arrows reorder from the keyboard; the announcement comes from the parent's live region.
          if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
            e.preventDefault();
            onMove(e.key === 'ArrowLeft' ? -1 : 1);
          } else listeners?.onKeyDown?.(e);
        }}
        aria-label={`${label}, position ${index + 1}. Alt and arrow keys move it.`}
        title={label}
        className="block aspect-[3/4] w-16 overflow-hidden rounded-xs border border-border bg-surface-muted p-0.5 hover:border-border-hover cursor-grab active:cursor-grabbing"
      >
        <span className="flex h-full w-full items-center justify-center">
          <Thumb page={page} width={64} />
        </span>
      </button>
      {moveButtons && (
        <div className="mt-1 flex justify-between">
          <IconButton icon="prev" label={`Move ${label} earlier`} size="sm" disabled={first} onClick={() => onMove(-1)} />
          <IconButton icon="next" label={`Move ${label} later`} size="sm" disabled={last} onClick={() => onMove(1)} />
        </div>
      )}
      <span className="absolute -right-1.5 -top-1.5 opacity-0 transition-opacity duration-150 group-hover:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100">
        <IconButton
          icon="close"
          label={`Remove ${label}`}
          tip="Remove page"
          size="sm"
          danger
          onClick={onRemove}
          className="!h-5 !w-5 bg-surface shadow-1 border border-border"
        />
      </span>
    </div>
  );
}

type Props = {
  file: SplitFile;
  /** Source file name for a page (for labels). */
  nameOf: (fileId: string) => string;
  selectedCount: number;
  onAddSelected: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onDownload: () => void;
  onEdit: () => void;
  onRemovePage: (pageId: string) => void;
  onMovePage: (pageId: string, delta: -1 | 1) => void;
  onPreview: (index: number) => void;
  /** Disables Download / Edit while something is being built. */
  busy: boolean;
  /** Phones: earlier / later buttons under each page, since nothing can be dragged. */
  moveButtons?: boolean;
};

/** One file being built: editable name, strip of mini thumbnails (drag to reorder), "Add N selected pages". */
export function OutputCard(p: Props) {
  const { file } = p;
  const { setNodeRef, isOver } = useDroppable({ id: `split:${file.id}` });
  const ids = file.pages.map((pg) => miniId(file.id, pg.id));
  return (
    <div
      ref={setNodeRef}
      data-testid={`split-file-${file.id}`}
      className={`rounded-lg border bg-surface p-3.5 space-y-3 transition-[border-color,background-color] duration-150 ${
        isOver ? 'border-accent bg-accent-tint' : 'border-border'
      }`}
    >
      <div className="flex items-center gap-2">
        <label className="group flex min-w-0 flex-1 items-center gap-1.5 rounded-sm bg-surface-muted pl-3 pr-2 focus-within:bg-surface focus-within:shadow-focus">
          <span className="sr-only">File name</span>
          <input
            type="text"
            value={file.name}
            onChange={(e) => p.onRename(e.target.value)}
            aria-label={`Name of file ${file.id}`}
            className="min-h-9 min-w-0 flex-1 bg-transparent text-[15px] font-semibold outline-none"
          />
          <Icon name="edit" size={14} className="text-text-muted" />
        </label>
        <span className="shrink-0 text-xs text-text-muted tabular-nums">.pdf · {plural(file.pages.length, 'page')}</span>
        <DropdownMenu
          label={`More actions for ${file.name}`}
          items={[
            { label: 'Download this file', icon: 'download', onSelect: p.onDownload, disabled: file.pages.length === 0 || p.busy },
            { label: 'Open in Edit', icon: 'edit', onSelect: p.onEdit, disabled: file.pages.length === 0 || p.busy },
            { label: 'Duplicate', icon: 'file', onSelect: p.onDuplicate },
            { label: 'Delete', icon: 'trash', onSelect: p.onDelete, danger: true },
          ]}
        />
      </div>

      {file.pages.length === 0 ? (
        <p className="flex h-24 items-center justify-center rounded-lg border border-dashed border-border-dashed px-4 text-center text-sm text-text-muted">
          Drag pages here, or select pages and press Add
        </p>
      ) : (
        <SortableContext items={ids} strategy={rectSortingStrategy}>
          <div role="list" aria-label={`Pages in ${file.name}`} className="flex flex-wrap gap-2.5">
            {file.pages.map((pg, i) => (
              <MiniThumb
                key={pg.id}
                id={ids[i]!}
                page={pg}
                index={i}
                label={`Page ${pg.srcIndex + 1} of ${p.nameOf(pg.fileId)}`}
                onPreview={() => p.onPreview(i)}
                onRemove={() => p.onRemovePage(pg.id)}
                onMove={(d) => p.onMovePage(pg.id, d)}
                moveButtons={!!p.moveButtons}
                first={i === 0}
                last={i === file.pages.length - 1}
              />
            ))}
            <div className="flex aspect-[3/4] w-16 shrink-0 items-center justify-center rounded-xs border border-dashed border-border-dashed text-center text-[11px] leading-3 text-text-muted">
              Drop here
            </div>
          </div>
        </SortableContext>
      )}

      {p.selectedCount > 0 && (
        <Button variant="secondary" className="w-full" onClick={p.onAddSelected}>
          Add {plural(p.selectedCount, 'selected page')}
        </Button>
      )}
    </div>
  );
}
