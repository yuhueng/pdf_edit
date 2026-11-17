/**
 * Largest PDF any tool accepts: 1.9 GiB (shown as "1.9 GB"), the same for every tool.
 * Browsers cannot hold one buffer of 2 GiB or more (Chromium refuses the allocation), and MuPDF (mupdf.js)
 * cannot address file offsets past 2 GiB, so this leaves room for a result a little larger than its input.
 */
export const MAX_FILE_BYTES = Math.floor(1.9 * 1024 * 1024 * 1024);

/**
 * The size every tool shows on its drop zone (1.5 GB). Files up to MAX_FILE_BYTES are still accepted: the
 * shown size is the one that works on ordinary machines (at 1.9 GB the tools need about 10–14 GB of browser
 * memory in the stress tests, and Compress takes over 120 s from about 1 GB of scanned pages).
 */
export const SHOWN_MAX_BYTES = Math.floor(1.5 * 1024 * 1024 * 1024);

/**
 * Split & Merge: one new file may take pages from at most this much PDF in total (all its source files are
 * loaded together while it is built). The new file itself must still come out under MAX_FILE_BYTES.
 */
export const MAX_MERGE_SOURCE_BYTES = 2 * MAX_FILE_BYTES;

/** A ZIP is built as one buffer too: above this, results download as separate files instead. */
export const MAX_ZIP_BYTES = MAX_FILE_BYTES;

/** "1 page" / "2 pages": counts use numbers and correct plurals. */
export const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

/** One decimal in GB or MB, whole numbers in KB. */
export function fmtSize(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** Long names keep their ending, so the extension stays visible: "Annual_Report_2025…final_v3.pdf". */
export function midTruncate(name: string, max = 28): string {
  if (name.length <= max) return name;
  const tail = Math.min(12, Math.floor(max / 2));
  return `${name.slice(0, max - tail - 1)}…${name.slice(-tail)}`;
}

/** A duration for people: "8 s", "1 min 25 s". */
export function fmtDuration(ms: number): string {
  const s = Math.max(1, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return r ? `${m} min ${r} s` : `${m} min`;
}

export const stripPdf = (name: string): string => name.replace(/\.pdf$/i, '');
