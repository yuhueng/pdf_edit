import { unzlibSync, zlibSync } from 'fflate';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream, type PDFRef } from 'pdf-lib';
import { bufferToBytes, isWasmMemError, openMuPdf } from './mupdfStream.ts';
import './pdfLibFast.ts';
import type { Progress } from './types.ts';

export type CompressLevel = 0 | 1 | 2 | 3;
/** 0 = already small enough, 1 = lossless clean-up, 2 = images recompressed, 3 = pages rasterized. */
export type CompressResult = {
  bytes: Uint8Array;
  level: CompressLevel;
  reached: boolean;
  before: number;
  after: number;
  imagesRecompressed: number;
  imagesSkipped: number;
};

export type ImageSource =
  | { kind: 'jpeg'; bytes: Uint8Array }
  | { kind: 'raw'; data: Uint8Array; width: number; height: number; channels: 1 | 3 };

/**
 * Re-encodes an image at `scale` of its pixel size: as JPEG, or, for a page that is effectively black and
 * white (a text scan), as a full-resolution 1-bit CCITT Group 4 image (`kind: 'g4'`). Returns null when it
 * cannot (the original is kept).
 */
export type ImageCodec = (
  src: ImageSource,
  scale: number,
  quality: number,
) => Promise<{ bytes: Uint8Array; width: number; height: number; kind?: 'jpeg' | 'g4' } | null>;

/** Stepped image settings: pixel scale and JPEG quality. Resolution is relative, as placement size is unknown. */
const IMAGE_STEPS: Array<[scale: number, quality: number]> = [
  [1, 0.8],
  [0.75, 0.65],
  [0.5, 0.5],
  [0.35, 0.4],
];
/** Rasterize steps: render DPI and JPEG quality. */
const RASTER_STEPS: Array<[dpi: number, quality: number]> = [
  [110, 70],
  [80, 55],
  [60, 40],
];

const SAVE_OPTS = 'garbage=deduplicate,compress';
const LARGE_WASM_THRESHOLD = 700 * 1024 * 1024;

/** 64-bit JS lossless pass for multi-GB PDFs that exceed MuPDF's 2 GiB WASM heap: Flate-compresses unfiltered streams. */
export async function losslessJs(bytes: Uint8Array): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const filterKey = PDFName.of('Filter');
  for (const [ref, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream) || obj.dict.has(filterKey) || obj.contents.length <= 512) continue;
    const z = zlibSync(obj.contents);
    if (z.length < obj.contents.length) {
      obj.dict.set(filterKey, PDFName.of('FlateDecode'));
      doc.context.assign(ref, PDFRawStream.of(obj.dict, z));
    }
  }
  return doc.save({ useObjectStreams: true });
}

/** Level 1: lossless. MuPDF drops unused/duplicate objects and compresses streams; >700 MB falls back to 64-bit JS Flate. */
async function lossless(bytes: Uint8Array): Promise<Uint8Array> {
  if (bytes.byteLength > LARGE_WASM_THRESHOLD) return losslessJs(bytes);
  const s = await openMuPdf(bytes);
  const doc = s.doc.asPDF();
  if (!doc) {
    s.close();
    throw new Error('Not a PDF');
  }
  try {
    try {
      return bufferToBytes(doc.saveToBuffer(SAVE_OPTS));
    } catch (err) {
      if (!isWasmMemError(err)) throw err;
    }
  } finally {
    s.close();
  }
  return losslessJs(bytes);
}

function nameOf(v: unknown): string | null {
  return v instanceof PDFName ? v.asString().replace(/^\//, '') : null;
}

function downsampleRaw(
  src: Extract<ImageSource, { kind: 'raw' }>,
  scale: number,
): { bytes: Uint8Array; width: number; height: number; channels: 1 | 3 } | null {
  const w = Math.max(1, Math.round(src.width * scale));
  const h = Math.max(1, Math.round(src.height * scale));
  if (w >= src.width && h >= src.height) return null;
  const ch = src.channels;
  const out = new Uint8Array(w * h * ch);
  for (let y = 0; y < h; y++) {
    const sy = Math.min(src.height - 1, Math.floor((y * src.height) / h));
    for (let x = 0; x < w; x++) {
      const sx = Math.min(src.width - 1, Math.floor((x * src.width) / w));
      const si = (sy * src.width + sx) * ch;
      const di = (y * w + x) * ch;
      out[di] = src.data[si]!;
      if (ch === 3) {
        out[di + 1] = src.data[si + 1]!;
        out[di + 2] = src.data[si + 2]!;
      }
    }
  }
  return { bytes: zlibSync(out), width: w, height: h, channels: ch };
}

/** An image Level 2 can work on: where it lives, its stream length, and how to read its pixels. */
type Candidate = { ref: PDFRef; dict: PDFDict; length: number; pixels: number; src: () => ImageSource | null };

/** Images to recompress: DCT, and plain 8-bit RGB/Gray Flate or unfiltered images. Masks, palettes and others keep their bits. */
function imageCandidates(doc: PDFDocument): { list: Candidate[]; skipped: number } {
  const list: Candidate[] = [];
  let skipped = 0;
  for (const [ref, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    const d = obj.dict;
    if (nameOf(d.get(PDFName.of('Subtype'))) !== 'Image') continue;
    const width = (d.lookup(PDFName.of('Width')) as PDFNumber | undefined)?.asNumber();
    const height = (d.lookup(PDFName.of('Height')) as PDFNumber | undefined)?.asNumber();
    if (!width || !height || width < 64 || height < 64) continue; // tiny images are not worth it
    if (d.has(PDFName.of('ImageMask')) || d.has(PDFName.of('Mask'))) {
      skipped++;
      continue;
    }
    const filterRaw = d.lookup(PDFName.of('Filter'));
    const filter = filterRaw instanceof PDFArray ? (filterRaw.size() === 1 ? nameOf(filterRaw.lookup(0)) : 'multi') : nameOf(filterRaw);
    const cs = nameOf(d.lookup(PDFName.of('ColorSpace')));
    const bpc = (d.lookup(PDFName.of('BitsPerComponent')) as PDFNumber | undefined)?.asNumber();
    let src: (() => ImageSource | null) | null = null;
    if (filter === 'DCTDecode') {
      src = () => ({ kind: 'jpeg', bytes: obj.contents });
    } else if ((filter === 'FlateDecode' || filter === null) && !d.has(PDFName.of('DecodeParms')) && bpc === 8 && (cs === 'DeviceRGB' || cs === 'DeviceGray')) {
      src = () => {
        try {
          const data = filter === null ? obj.contents : unzlibSync(obj.contents);
          const channels = cs === 'DeviceRGB' ? 3 : 1;
          return data.length === width * height * channels ? { kind: 'raw', data, width, height, channels } : null;
        } catch {
          return null;
        }
      };
    }
    if (src) list.push({ ref, dict: d, length: obj.contents.length, pixels: width * height, src });
    else skipped++;
  }
  return { list, skipped };
}

type Encoded = { bytes: Uint8Array; width: number; height: number; kind: 'jpeg' | 'g4' | 'flate'; channels?: 1 | 3 };

/** One image at one setting: the codec first, then (raw images only) the pure-JS downscale. Null keeps the original. */
async function encodeOne(c: Candidate, codec: ImageCodec | null, scale: number, quality: number): Promise<Encoded | null> {
  const src = c.src();
  if (!src) return null;
  const out = codec ? await codec(src, scale, quality) : null;
  if (out && out.bytes.length < c.length) return { ...out, kind: out.kind ?? 'jpeg' };
  if (src.kind === 'raw') {
    const flate = downsampleRaw(src, scale);
    if (flate && flate.bytes.length < c.length) return { ...flate, kind: 'flate' };
  }
  return null;
}

/** Runs `fn` over `items` with at most `limit` in flight: the browser decodes and encodes images off the main JS thread. */
async function pool<T>(items: T[], limit: number, fn: (item: T, i: number) => Promise<void>): Promise<void> {
  let next = 0;
  const lane = async () => {
    for (let i = next++; i < items.length; i = next++) await fn(items[i]!, i);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
}

/** Images encoded side by side. Four keeps the browser's image threads busy without holding many decoded pages. */
const IMAGE_CONCURRENCY = 4;
/** Images over this many pixels (a 16 MP image decodes to 64 MB) are done one at a time, so memory stays bounded. */
const BIG_IMAGE_PIXELS = 16_000_000;
const concurrencyFor = (list: Candidate[]) => (list.some((c) => c.pixels > BIG_IMAGE_PIXELS) ? 1 : IMAGE_CONCURRENCY);
/** Sampling pays off only when the sample is a small part of the work. */
const MIN_IMAGES_TO_SAMPLE = 12;

function replaceImage(doc: PDFDocument, c: Candidate, out: Encoded): void {
  const base = { Type: 'XObject', Subtype: 'Image', Width: out.width, Height: out.height };
  const dict = (
    out.kind === 'g4'
      ? doc.context.obj({ ...base, ColorSpace: 'DeviceGray', BitsPerComponent: 1, Filter: 'CCITTFaxDecode', DecodeParms: { K: -1, Columns: out.width, Rows: out.height } })
      : out.kind === 'flate'
        ? doc.context.obj({ ...base, ColorSpace: out.channels === 1 ? 'DeviceGray' : 'DeviceRGB', BitsPerComponent: 8, Filter: 'FlateDecode' })
        : doc.context.obj({ ...base, ColorSpace: 'DeviceRGB', BitsPerComponent: 8, Filter: 'DCTDecode' }) // canvas always writes RGB JPEG
  ) as PDFDict;
  // An SMask is sized independently and scales with the image, so it can stay as is.
  const sm = c.dict.get(PDFName.of('SMask'));
  if (sm) dict.set(PDFName.of('SMask'), sm);
  doc.context.assign(c.ref, PDFRawStream.of(dict, out.bytes));
}

/**
 * Picks the mildest image step expected to reach `maxBytes`, by encoding a few sample images at each step
 * and projecting their size change onto all images. Saves running whole-document passes that are too weak.
 */
async function pickImageStep(bytes: Uint8Array, codec: ImageCodec | null, maxBytes: number, steps: Array<[number, number]>): Promise<number> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const { list } = imageCandidates(doc);
  if (list.length < MIN_IMAGES_TO_SAMPLE) return 0; // a few images: trying the steps in order costs less than sampling
  const imageBytes = list.reduce((n, c) => n + c.length, 0);
  const sorted = [...list].sort((a, b) => b.length - a.length);
  const count = Math.min(6, sorted.length);
  const sample = Array.from({ length: count }, (_, i) => sorted[Math.floor((i * sorted.length) / count)]!);
  for (let s = 0; s < steps.length; s++) {
    const [scale, quality] = steps[s]!;
    let before = 0;
    let after = 0;
    await pool(sample, concurrencyFor(sample), async (c) => {
      const out = await encodeOne(c, codec, scale, quality);
      before += c.length;
      after += out ? out.bytes.length : c.length;
    });
    const projected = bytes.length - imageBytes + imageBytes * (after / Math.max(1, before));
    if (projected <= maxBytes * 0.97) return s;
  }
  return steps.length - 1;
}

/** Progress inside one pass: `frac` from 0 to 1, and what is being done. */
type Stage = (frac: number, stage: string) => void;

/** `compress` reports overall progress out of this many steps, with a stage label. */
export const PROGRESS_TOTAL = 1000;

/** Level 2: every candidate image re-encoded once at one step, several at a time. */
async function recompressImages(
  bytes: Uint8Array,
  codec: ImageCodec | null,
  scale: number,
  quality: number,
  onProgress?: Stage,
): Promise<{ bytes: Uint8Array; done: number; skipped: number }> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const { list, skipped: notCandidates } = imageCandidates(doc);
  let done = 0;
  let skipped = notCandidates;
  let finished = 0;
  await pool(list, concurrencyFor(list), async (c) => {
    const out = await encodeOne(c, codec, scale, quality);
    if (out) {
      replaceImage(doc, c, out);
      done++;
    } else skipped++;
    finished++;
    onProgress?.((finished / list.length) * 0.9, `Recompressing images ${finished}/${list.length}`);
  });
  onProgress?.(0.9, 'Saving');
  return { bytes: await doc.save({ useObjectStreams: true }), done, skipped };
}

/** Level 3: every page becomes one JPEG. Text is no longer selectable. */
async function rasterize(bytes: Uint8Array, dpi: number, quality: number, onProgress?: Stage): Promise<Uint8Array> {
  const s = await openMuPdf(bytes);
  const out = new s.mupdf.PDFDocument();
  try {
    const n = s.doc.countPages();
    const k = dpi / 72;
    for (let i = 0; i < n; i++) {
      const page = s.doc.loadPage(i);
      const [x0, y0, x1, y1] = page.getBounds();
      const w = x1 - x0;
      const h = y1 - y0;
      const pix = page.toPixmap(s.mupdf.Matrix.scale(k, k), s.mupdf.ColorSpace.DeviceRGB, false, true);
      const jpeg = pix.asJPEG(quality, false);
      pix.destroy();
      const img = out.addImage(new s.mupdf.Image(jpeg));
      const resources = { XObject: { Im0: img } };
      const contents = `q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q`;
      const pageObj = out.addPage([0, 0, w, h], 0, resources, contents);
      out.insertPage(-1, pageObj);
      page.destroy();
      s.mupdf.emptyStore();
      onProgress?.(((i + 1) / n) * 0.95, `Turning pages into images ${i + 1}/${n}`);
    }
    onProgress?.(0.95, 'Saving');
    return bufferToBytes(out.saveToBuffer(SAVE_OPTS));
  } finally {
    out.destroy();
    s.close();
  }
}

/**
 * Smallest-change-first ladder until the file is at most `maxBytes`:
 * lossless, then image recompression (stepped), then page rasterizing (stepped, `allowRaster`).
 * Always returns the smallest result seen; `reached` says whether it met the target.
 */
export async function compress(
  input: Uint8Array,
  maxBytes: number,
  codec: ImageCodec | null,
  allowRaster = true,
  onProgress?: Progress,
): Promise<CompressResult> {
  const before = input.length;
  const res = (bytes: Uint8Array, level: CompressLevel, done = 0, skipped = 0): CompressResult => ({
    bytes,
    level,
    reached: bytes.length <= maxBytes,
    before,
    after: bytes.length,
    imagesRecompressed: done,
    imagesSkipped: skipped,
  });

  // One bar for the whole ladder: clean-up 0–20%, choosing a step to 25%, the first image pass to 95%.
  // A further pass (rare: the first step was not enough) takes half of what is left, so the bar never goes back.
  let at = 0;
  const report = (v: number, stage: string) => {
    at = Math.max(at, Math.min(PROGRESS_TOTAL, Math.round(v)));
    onProgress?.(at, PROGRESS_TOTAL, stage);
  };
  const band = (lo: number, hi: number): Stage => (f, stage) => report(lo + (hi - lo) * f, stage);
  const next = (first: boolean) => band(at, first ? 950 : at + (980 - at) / 2);
  const finish = (r: CompressResult) => {
    report(PROGRESS_TOTAL, 'Done');
    return r;
  };

  if (before <= maxBytes) return finish(res(input, 0));

  let best = res(input, 0);
  const consider = (r: CompressResult): boolean => {
    if (r.after < best.after) best = r;
    return r.reached;
  };

  report(0, 'Cleaning up (lossless)');
  const l1 = await lossless(input);
  if (consider(res(l1, 1))) return finish(best);
  const base = best.bytes;
  report(200, 'Choosing image settings');

  // Without a codec only downscaling helps, so the full-size step is left out.
  const steps = IMAGE_STEPS.filter(([scale]) => codec || scale < 1);
  const first = await pickImageStep(base, codec, maxBytes, steps);
  report(250, 'Recompressing images');
  for (let s = first; s < steps.length; s++) {
    const [scale, quality] = steps[s]!;
    const r = await recompressImages(base, codec, scale, quality, next(s === first));
    if (r.done === 0 && !codec) break; // the JS downscale made nothing smaller: stronger steps will not either
    if (consider(res(r.bytes, 2, r.done, r.skipped))) return finish(best);
  }

  if (allowRaster) {
    for (const [dpi, quality] of RASTER_STEPS) {
      try {
        const r = await rasterize(input, dpi, quality, next(false));
        if (consider(res(r, 3))) return finish(best);
      } catch (err) {
        if (isWasmMemError(err)) break;
        throw err;
      }
    }
  }
  return finish(best);
}
