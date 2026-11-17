import type { PageRef, Rot } from '../lib/pdf/types.ts';

export type FileEntry = { id: string; name: string; size: number; file: File; pageCount: number; /** Size of the file as uploaded (before any unlock), for spotting duplicates. */ origSize?: number };
export type OrgState = { files: FileEntry[]; pages: PageRef[]; selected: Set<string> };
export type Action =
  | { t: 'addFiles'; files: FileEntry[] }
  | { t: 'removeFile'; fileId: string }
  | { t: 'reorderFiles'; ids: string[] }
  | { t: 'movePage'; activeId: string; overId: string }
  | { t: 'moveTo'; id: string; index: number }
  | { t: 'rotate'; ids: string[]; delta: 90 | -90 | 180 }
  | { t: 'delete'; ids: string[] }
  | { t: 'restorePages'; pages: PageRef[]; selected: Set<string> }
  | { t: 'applyRange'; fileId: string; indices: number[] }
  | { t: 'select'; id: string; on: boolean }
  | { t: 'setMany'; ids: string[]; on: boolean }
  | { t: 'selectAll' }
  | { t: 'clearSelection' }
  | { t: 'reset' };

export const initialOrgState: OrgState = {
  files: [],
  pages: [],
  selected: new Set(),
};

function moveItem<T>(arr: T[], from: number, to: number): T[] {
  const copy = [...arr];
  const [item] = copy.splice(from, 1);
  if (item === undefined) return arr;
  copy.splice(to, 0, item);
  return copy;
}

export function reducer(s: OrgState, a: Action): OrgState {
  switch (a.t) {
    case 'addFiles': {
      if (a.files.length === 0) return s;
      const newPages: PageRef[] = [];
      for (const f of a.files) {
        for (let i = 0; i < f.pageCount; i++) {
          newPages.push({ id: `${f.id}:${i}`, fileId: f.id, srcIndex: i, rotation: 0 });
        }
      }
      return {
        files: [...s.files, ...a.files],
        pages: [...s.pages, ...newPages],
        selected: s.selected,
      };
    }

    case 'removeFile': {
      const files = s.files.filter((f) => f.id !== a.fileId);
      const removedIds = new Set(s.pages.filter((p) => p.fileId === a.fileId).map((p) => p.id));
      const pages = s.pages.filter((p) => p.fileId !== a.fileId);
      const selected = new Set([...s.selected].filter((id) => !removedIds.has(id)));
      return { files, pages, selected };
    }

    case 'reorderFiles': {
      const byId = new Map(s.files.map((f) => [f.id, f]));
      const files: FileEntry[] = [];
      for (const id of a.ids) {
        const f = byId.get(id);
        if (f) {
          files.push(f);
          byId.delete(id);
        }
      }
      for (const f of byId.values()) files.push(f);

      const grouped = new Map<string, PageRef[]>();
      for (const f of files) grouped.set(f.id, []);
      for (const p of s.pages) grouped.get(p.fileId)?.push(p);

      const pages: PageRef[] = [];
      for (const f of files) {
        pages.push(...(grouped.get(f.id) ?? []));
      }
      return { files, pages, selected: s.selected };
    }

    case 'movePage': {
      const from = s.pages.findIndex((p) => p.id === a.activeId);
      const to = s.pages.findIndex((p) => p.id === a.overId);
      if (from === -1 || to === -1 || from === to) return s;
      return { ...s, pages: moveItem(s.pages, from, to) };
    }

    case 'moveTo': {
      const from = s.pages.findIndex((p) => p.id === a.id);
      if (from === -1) return s;
      const to = Math.max(0, Math.min(s.pages.length - 1, a.index));
      if (from === to) return s;
      return { ...s, pages: moveItem(s.pages, from, to) };
    }

    case 'rotate': {
      if (a.ids.length === 0) return s;
      const target = new Set(a.ids);
      const pages = s.pages.map((p) =>
        target.has(p.id)
          ? { ...p, rotation: ((((p.rotation + a.delta) % 360) + 360) % 360) as Rot }
          : p,
      );
      return { ...s, pages };
    }

    case 'delete': {
      if (a.ids.length === 0) return s;
      const target = new Set(a.ids);
      const pages = s.pages.filter((p) => !target.has(p.id));
      const selected = new Set([...s.selected].filter((id) => !target.has(id)));
      return { ...s, pages, selected };
    }

    case 'reset':
      return initialOrgState;

    case 'restorePages': {
      // Undo of a delete: drop pages whose file was removed in the meantime.
      const live = new Set(s.files.map((f) => f.id));
      const pages = a.pages.filter((p) => live.has(p.fileId));
      const ids = new Set(pages.map((p) => p.id));
      return { ...s, pages, selected: new Set([...a.selected].filter((id) => ids.has(id))) };
    }

    case 'applyRange': {
      const firstPos = s.pages.findIndex((p) => p.fileId === a.fileId);
      const removedIds = new Set(s.pages.filter((p) => p.fileId === a.fileId).map((p) => p.id));
      const remaining = s.pages.filter((p) => p.fileId !== a.fileId);
      const rebuilt: PageRef[] = a.indices.map((srcIndex) => ({
        id: `${a.fileId}:${srcIndex}`,
        fileId: a.fileId,
        srcIndex,
        rotation: 0,
      }));

      let insertPos = firstPos;
      if (insertPos === -1) {
        const fileIdx = s.files.findIndex((f) => f.id === a.fileId);
        const laterIds = new Set(s.files.slice(fileIdx + 1).map((f) => f.id));
        const nextPos = remaining.findIndex((p) => laterIds.has(p.fileId));
        insertPos = nextPos === -1 ? remaining.length : nextPos;
      }

      const pages = [...remaining];
      pages.splice(insertPos, 0, ...rebuilt);
      const selected = new Set([...s.selected].filter((id) => !removedIds.has(id)));
      return { ...s, pages, selected };
    }

    case 'select': {
      const selected = new Set(s.selected);
      if (a.on) selected.add(a.id);
      else selected.delete(a.id);
      return { ...s, selected };
    }

    case 'setMany': {
      const selected = new Set(s.selected);
      for (const id of a.ids) {
        if (a.on) selected.add(id);
        else selected.delete(id);
      }
      return { ...s, selected };
    }

    case 'selectAll':
      return { ...s, selected: new Set(s.pages.map((p) => p.id)) };

    case 'clearSelection':
      return { ...s, selected: new Set() };
  }
}
