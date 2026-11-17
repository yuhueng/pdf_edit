import type { PageRef } from './pdf/types.ts';

export type PageDiff = { page: PageRef; removed: boolean; moved: boolean; rotated: boolean };
export type Diff = {
  /** Source order, with removed pages flagged (red). */
  before: PageDiff[];
  /** Result order, with moved/rotated flagged. */
  after: PageDiff[];
  counts: { removed: number; moved: number; rotated: number; kept: number };
};

// Longest increasing subsequence (indices into `seq`); pages outside it are the ones that moved.
function lisIndices(seq: number[]): Set<number> {
  const tails: number[] = [];
  const prev: number[] = new Array(seq.length).fill(-1);
  for (let i = 0; i < seq.length; i++) {
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (seq[tails[mid]!]! < seq[i]!) lo = mid + 1;
      else hi = mid;
    }
    prev[i] = lo > 0 ? tails[lo - 1]! : -1;
    tails[lo] = i;
  }
  const keep = new Set<number>();
  for (let k = tails[tails.length - 1] ?? -1; k !== -1; k = prev[k]!) keep.add(k);
  return keep;
}

/** Git-style diff of a page list: what the merge plan removes, moves or rotates versus the sources. */
export function diffPages(before: PageRef[], after: PageRef[]): Diff {
  const beforeIdx = new Map(before.map((p, i) => [p.id, i]));
  const afterIds = new Set(after.map((p) => p.id));
  const kept = after.filter((p) => beforeIdx.has(p.id));
  const lis = lisIndices(kept.map((p) => beforeIdx.get(p.id)!));
  const movedIds = new Set(kept.filter((_, i) => !lis.has(i)).map((p) => p.id));

  const afterD = after.map((page) => ({
    page,
    removed: false,
    moved: movedIds.has(page.id),
    rotated: page.rotation !== 0,
  }));
  const beforeD = before.map((page) => ({
    page,
    removed: !afterIds.has(page.id),
    moved: movedIds.has(page.id),
    rotated: false,
  }));
  return {
    before: beforeD,
    after: afterD,
    counts: {
      removed: beforeD.filter((d) => d.removed).length,
      moved: movedIds.size,
      rotated: afterD.filter((d) => d.rotated).length,
      kept: kept.length,
    },
  };
}
