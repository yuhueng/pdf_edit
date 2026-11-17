import { zipSync } from 'fflate';
import { compress as compressPdf } from './compress.ts';
import { convert } from './convert.ts';
import { encrypt, unlock, type CryptAlgorithm, type UnlockResult } from './crypt.ts';
import { fillForm, formFields, reshape } from './pages.ts';
import { replaceText } from './textEdit.ts';
import {
  BlendMode,
  EncryptedPDFError,
  PDFDocument,
  PDFFont,
  PDFImage,
  PDFPage,
  StandardFonts,
  degrees,
  rgb,
} from 'pdf-lib';
import { generate } from './generate.ts';
import { blobSource, openMuPdf, type SyncSource } from './mupdfStream.ts';
import './pdfLibFast.ts';
import type { Edit, InputFile, InspectResult, PageRef, PdfApi, Progress, Rot, StdFont } from './types.ts';

/** Files at least this large are checked by MuPDF reading slices, instead of parsing all of them with pdf-lib. */
const SLICED_INSPECT_BYTES = 64 * 1024 * 1024;

/**
 * Check of a large file through slices: MuPDF reads the header, cross-reference table and page tree only,
 * so a 1.9 GB file is never loaded whole just to count its pages.
 */
export async function inspectSource(src: SyncSource): Promise<InspectResult> {
  if (src.size === 0) return { ok: false, reason: 'empty', message: 'File is empty (0 bytes).' };
  const headerStr = new TextDecoder('latin1').decode(src.read(0, 1024));
  if (!headerStr.includes('%PDF-')) {
    return { ok: false, reason: 'not-pdf', message: 'Not a valid PDF file (missing %PDF- header).' };
  }
  const corrupt: InspectResult = { ok: false, reason: 'corrupt', message: 'PDF file is corrupted or unreadable.' };
  let s;
  try {
    s = await openMuPdf(src);
  } catch {
    return corrupt;
  }
  try {
    const pdf = s.doc.asPDF();
    if (!pdf) return corrupt;
    if (pdf.needsPassword() || !pdf.getTrailer().get('Encrypt').isNull()) {
      return { ok: false, reason: 'encrypted', message: 'File is password-protected.' };
    }
    const pageCount = pdf.countPages();
    if (pageCount === 0) return { ok: false, reason: 'no-pages', message: 'PDF has 0 pages.' };
    return { ok: true, pageCount };
  } catch {
    return corrupt;
  } finally {
    s.close();
  }
}

/** Bytes are parsed with pdf-lib. A large `Blob` is read in slices inside the worker (`FileReaderSync`). */
export async function inspectAny(input: Uint8Array | Blob): Promise<InspectResult> {
  if (input instanceof Uint8Array) return inspect(input);
  const sliced = input.size >= SLICED_INSPECT_BYTES && 'FileReaderSync' in globalThis;
  return sliced ? inspectSource(blobSource(input)) : inspect(await readBlob(input));
}

/**
 * `unlock` for the app: the worker reads the file itself and returns the unlocked PDF as a `Blob`.
 * A missing or wrong password is found by MuPDF reading slices, without loading the whole file first.
 */
export async function unlockFile(
  file: Blob,
  password = '',
): Promise<{ ok: true; file: Blob } | Exclude<UnlockResult, { ok: true }>> {
  if (file.size >= SLICED_INSPECT_BYTES && 'FileReaderSync' in globalThis) {
    let s;
    try {
      s = await openMuPdf(blobSource(file));
    } catch {
      return { ok: false, reason: 'corrupt', message: 'PDF file is corrupted or unreadable.' };
    }
    try {
      const pdf = s.doc.asPDF();
      if (!pdf) return { ok: false, reason: 'corrupt', message: 'PDF file is corrupted or unreadable.' };
      if (pdf.needsPassword()) {
        if (!password) return { ok: false, reason: 'needs-password', message: 'This PDF needs a password.' };
        if (pdf.authenticatePassword(password) === 0) return { ok: false, reason: 'wrong-password', message: 'That password is not correct.' };
      }
    } finally {
      s.close();
    }
  }
  const r = await unlock(await readBlob(file), password);
  return r.ok ? { ok: true, file: new Blob([r.bytes as Uint8Array<ArrayBuffer>], { type: 'application/pdf' }) } : r;
}

/** `encrypt` for the app: the worker reads the file and returns the encrypted PDF as a `Blob`. */
export async function encryptFile(file: Blob, password: string, algorithm?: CryptAlgorithm): Promise<Blob> {
  const out = await encrypt(await readBlob(file), password, algorithm);
  return new Blob([out as Uint8Array<ArrayBuffer>], { type: 'application/pdf' });
}

/** Whole-file read. In the worker `FileReaderSync` fills one buffer directly; `arrayBuffer()` elsewhere. */
export async function readBlob(blob: Blob): Promise<Uint8Array> {
  const Reader = (globalThis as { FileReaderSync?: new () => { readAsArrayBuffer(b: Blob): ArrayBuffer } }).FileReaderSync;
  return new Uint8Array(Reader ? new Reader().readAsArrayBuffer(blob) : await blob.arrayBuffer());
}

/** Reads the files, merges, and hands back a `Blob`: in the worker the bytes never travel to the page. */
export async function mergeFiles(
  inputs: Array<{ id: string; file: Blob }>,
  pages: PageRef[],
  onProgress?: Progress,
): Promise<Blob> {
  const read: InputFile[] = [];
  for (const i of inputs) read.push({ id: i.id, bytes: await readBlob(i.file) });
  const out = await merge(read, pages, onProgress);
  read.length = 0;
  return new Blob([out as Uint8Array<ArrayBuffer>], { type: 'application/pdf' });
}

export async function inspect(bytes: Uint8Array): Promise<InspectResult> {
  if (bytes.length === 0) {
    return { ok: false, reason: 'empty', message: 'File is empty (0 bytes).' };
  }
  const head = bytes.subarray(0, Math.min(1024, bytes.length));
  const headerStr = new TextDecoder('latin1').decode(head);
  if (!headerStr.includes('%PDF-')) {
    return { ok: false, reason: 'not-pdf', message: 'Not a valid PDF file (missing %PDF- header).' };
  }
  try {
    const doc = await PDFDocument.load(bytes, { updateMetadata: false });
    const pageCount = doc.getPageCount();
    if (pageCount === 0) {
      return { ok: false, reason: 'no-pages', message: 'PDF has 0 pages.' };
    }
    return { ok: true, pageCount };
  } catch (err) {
    if (err instanceof EncryptedPDFError || (err instanceof Error && err.message.includes('is encrypted'))) {
      return {
        ok: false,
        reason: 'encrypted',
        message: 'File is password-protected.',
      };
    }
    return { ok: false, reason: 'corrupt', message: 'PDF file is corrupted or unreadable.' };
  }
}

export async function merge(
  inputs: InputFile[],
  pages: PageRef[],
  onProgress?: Progress,
): Promise<Uint8Array> {
  const bytesByFile = new Map<string, Uint8Array>();
  for (const inp of inputs) {
    bytesByFile.set(inp.id, inp.bytes);
  }

  const uniqueIndicesByFile = new Map<string, Set<number>>();
  for (const ref of pages) {
    let set = uniqueIndicesByFile.get(ref.fileId);
    if (!set) {
      set = new Set<number>();
      uniqueIndicesByFile.set(ref.fileId, set);
    }
    set.add(ref.srcIndex);
  }

  const srcMap = new Map<string, PDFDocument>();
  for (const fileId of uniqueIndicesByFile.keys()) {
    const raw = bytesByFile.get(fileId);
    if (!raw) throw new Error(`Missing input bytes for file "${fileId}"`);
    const src = await PDFDocument.load(raw, { updateMetadata: false });
    const form = src.getForm();
    if (form.getFields().length > 0) {
      try {
        form.flatten();
      } catch (err) {
        console.warn(`Form flatten failed for ${fileId}:`, err);
      }
    }
    srcMap.set(fileId, src);
  }

  const out = await PDFDocument.create();
  const copiedMap = new Map<string, PDFPage>();
  const sourceIds = [...uniqueIndicesByFile.keys()];

  for (let sIdx = 0; sIdx < sourceIds.length; sIdx++) {
    const fileId = sourceIds[sIdx]!;
    const src = srcMap.get(fileId)!;
    const indices = [...uniqueIndicesByFile.get(fileId)!].sort((a, b) => a - b);
    const copied = await out.copyPages(src, indices);
    for (let j = 0; j < indices.length; j++) {
      copiedMap.set(`${fileId}:${indices[j]!}`, copied[j]!);
    }
    onProgress?.(Math.round(((sIdx + 1) / Math.max(1, sourceIds.length)) * 40), 100);
  }

  const usedKeys = new Set<string>();
  for (let i = 0; i < pages.length; i++) {
    const ref = pages[i]!;
    const key = `${ref.fileId}:${ref.srcIndex}`;
    let page: PDFPage;
    if (!usedKeys.has(key)) {
      usedKeys.add(key);
      page = copiedMap.get(key)!;
    } else {
      const [dup] = await out.copyPages(srcMap.get(ref.fileId)!, [ref.srcIndex]);
      page = dup!;
    }
    if (ref.rotation !== 0) {
      const orig = page.getRotation().angle;
      page.setRotation(degrees((((orig + ref.rotation) % 360) + 360) % 360));
    }
    out.addPage(page);
    if ((i + 1) % 10 === 0 || i === pages.length - 1) {
      onProgress?.(40 + Math.round(((i + 1) / pages.length) * 60), 100);
    }
  }
  if (pages.length === 0) {
    onProgress?.(100, 100);
  }

  srcMap.clear();
  return out.save();
}

async function splitDoc(
  src: PDFDocument,
  groups: number[][],
  onProgress?: Progress,
): Promise<Uint8Array[]> {
  const outputs: Uint8Array[] = [];
  for (let i = 0; i < groups.length; i++) {
    const group = groups[i]!;
    const out = await PDFDocument.create();
    const copied = await out.copyPages(src, group);
    for (const p of copied) {
      out.addPage(p);
    }
    outputs.push(await out.save());
    onProgress?.(i + 1, groups.length);
  }
  return outputs;
}

export async function split(
  bytes: Uint8Array,
  groups: number[][],
  onProgress?: Progress,
): Promise<Uint8Array[]> {
  const src = await PDFDocument.load(bytes, { updateMetadata: false });
  return splitDoc(src, groups, onProgress);
}

export async function burst(bytes: Uint8Array, onProgress?: Progress): Promise<Uint8Array> {
  const src = await PDFDocument.load(bytes, { updateMetadata: false });
  const n = src.getPageCount();
  const groups = Array.from({ length: n }, (_, i) => [i]);
  const parts = await splitDoc(src, groups, onProgress);
  const padLen = Math.max(3, String(n).length);
  const entries: Record<string, Uint8Array> = {};
  for (let i = 0; i < parts.length; i++) {
    entries[`p${String(i + 1).padStart(padLen, '0')}.pdf`] = parts[i]!;
  }
  return zipSync(entries, { level: 0 });
}

export async function applyEdits(
  bytes: Uint8Array,
  edits: Edit[],
  rotateAll?: Rot,
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const fontCache = new Map<StdFont, PDFFont>();
  const getFont = async (name: StdFont): Promise<PDFFont> => {
    let font = fontCache.get(name);
    if (!font) {
      font = await doc.embedFont(name as StandardFonts);
      fontCache.set(name, font);
    }
    return font;
  };

  // First pass: check all text characters before touching any page
  const badCharsSet = new Set<string>();
  const checkedByFont = new Map<StdFont, Map<string, boolean>>();
  for (const edit of edits) {
    if (edit.kind !== 'text') continue;
    const font = await getFont(edit.font);
    let cache = checkedByFont.get(edit.font);
    if (!cache) {
      cache = new Map<string, boolean>();
      checkedByFont.set(edit.font, cache);
    }
    for (const line of edit.lines) {
      for (const ch of line) {
        let ok = cache.get(ch);
        if (ok === undefined) {
          try {
            font.encodeText(ch);
            ok = true;
          } catch {
            ok = false;
          }
          cache.set(ch, ok);
        }
        if (!ok) {
          badCharsSet.add(ch);
        }
      }
    }
  }

  if (badCharsSet.size > 0) {
    const chars = [...badCharsSet];
    throw Object.assign(new Error(`Unsupported characters: ${chars.join(' ')}`), {
      name: 'UnsupportedTextError',
      chars,
    });
  }

  const pages = doc.getPages();
  const imgCache = new Map<Uint8Array, PDFImage>();

  for (const edit of edits) {
    const page = pages[edit.page];
    if (!page) throw new Error(`Edit targets missing page index ${edit.page}`);

    if (edit.kind === 'text') {
      const font = await getFont(edit.font);
      const color = rgb(edit.color[0], edit.color[1], edit.color[2]);
      const rad = (edit.angle * Math.PI) / 180;
      const cosA = Math.cos(rad);
      const sinA = Math.sin(rad);

      for (let i = 0; i < edit.lines.length; i++) {
        const line = edit.lines[i]!;
        const lx = edit.x + i * edit.lineStep * sinA;
        const ly = edit.y - i * edit.lineStep * cosA;
        if (line.length > 0) {
          page.drawText(line, {
            x: lx,
            y: ly,
            size: edit.size,
            font,
            color,
            opacity: edit.opacity,
            rotate: degrees(edit.angle),
          });
          if (edit.underline) {
            const w = font.widthOfTextAtSize(line, edit.size);
            const off = 0.12 * edit.size;
            const sx = lx + off * sinA;
            const sy = ly - off * cosA;
            page.drawLine({
              start: { x: sx, y: sy },
              end: { x: sx + w * cosA, y: sy + w * sinA },
              thickness: Math.max(0.5, edit.size * 0.05),
              color,
              opacity: edit.opacity,
            });
          }
          if (edit.strike) {
            const w = font.widthOfTextAtSize(line, edit.size);
            const off = 0.3 * edit.size; // about the x-height middle
            const sx = lx - off * sinA;
            const sy = ly + off * cosA;
            page.drawLine({
              start: { x: sx, y: sy },
              end: { x: sx + w * cosA, y: sy + w * sinA },
              thickness: Math.max(0.5, edit.size * 0.05),
              color,
              opacity: edit.opacity,
            });
          }
        }
      }
    } else if (edit.kind === 'image') {
      let img = imgCache.get(edit.bytes);
      if (!img) {
        img = edit.mime === 'image/png' ? await doc.embedPng(edit.bytes) : await doc.embedJpg(edit.bytes);
        imgCache.set(edit.bytes, img);
      }
      page.drawImage(img, {
        x: edit.x,
        y: edit.y,
        width: edit.width,
        height: edit.height,
        rotate: degrees(edit.angle),
        opacity: edit.opacity,
      });
    } else if (edit.kind === 'path') {
      page.drawSvgPath(edit.d, {
        x: 0,
        y: 0,
        color: edit.fill ? rgb(edit.fill[0], edit.fill[1], edit.fill[2]) : undefined,
        borderColor: edit.stroke ? rgb(edit.stroke[0], edit.stroke[1], edit.stroke[2]) : undefined,
        borderWidth: edit.stroke ? edit.strokeWidth : 0,
        opacity: edit.opacity,
        borderOpacity: edit.opacity,
        blendMode: edit.multiply ? BlendMode.Multiply : undefined,
      });
    }
  }

  if (rotateAll !== undefined && rotateAll !== 0) {
    for (const page of pages) {
      const cur = page.getRotation().angle;
      page.setRotation(degrees((((cur + rotateAll) % 360) + 360) % 360));
    }
  }

  return doc.save();
}

// Function declarations are hoisted, so the textEdit <-> ops import cycle is safe.
export const direct: PdfApi = {
  inspect: inspectAny,
  merge,
  mergeFiles,
  unlockFile,
  encryptFile,
  split,
  burst,
  applyEdits,
  generate,
  replaceText,
  unlock,
  encrypt,
  formFields,
  fillForm,
  reshape,
  convert,
  // No browser codec outside the worker, so direct (test) calls skip the image level.
  compress: (bytes, maxBytes, allowRaster, onProgress) => compressPdf(bytes, maxBytes, null, allowRaster, onProgress),
};
