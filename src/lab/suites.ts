import { unzipSync } from 'fflate';
import { PDFArray, PDFDocument, PDFPage, PDFRawStream, PDFStream, degrees } from 'pdf-lib';
import { makeEncryptedPdf, makeZeroPagePdf, readTags } from '../lib/pdf/generate.ts';
import type { Edit, InputFile, PageRef, PdfApi, Rot } from '../lib/pdf/types.ts';
import { toEdits } from '../ui/editor/toEdits.ts';
import { SLA, type Profile } from './sla.ts';

const PNG_1X1 = new Uint8Array([
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0,
  0, 0, 144, 119, 83, 222, 0, 0, 0, 12, 73, 68, 65, 84, 8, 215, 99, 96, 96, 96, 0, 0, 0, 4, 0, 1,
  39, 52, 23, 234, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130,
]);

export type Result = {
  id: string;
  title: string;
  status: 'pass' | 'fail' | 'skip';
  ms: number;
  mbPerSec: number | null;
  pagesPerSec: number | null;
  peakHeapMb: number | null;
  slaMs: number | null;
  details: string;
};

export type Ctx = {
  api: PdfApi;
  profile: Profile;
  scale: number;
  hasCanvas: boolean;
  heap: () => number | null;
};

export type Suite = {
  id: string;
  title: string;
  group: 'perf' | 'invariant' | 'edge' | 'custom';
  run(ctx: Ctx): Promise<Result>;
};

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function makePrng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 0x100000000;
  };
}

function perfResult(
  id: string,
  title: string,
  ctx: Ctx,
  ms: number,
  totalBytes: number,
  pageCount: number,
  ok: boolean,
  detail: string,
): Result {
  const slaMs = ctx.scale === 1 ? (SLA[id]?.[ctx.profile] ?? null) : null;
  const secs = Math.max(ms, 0.1) / 1000;
  const mbPerSec = totalBytes > 0 ? round1(totalBytes / (1024 * 1024) / secs) : null;
  const pagesPerSec = pageCount > 0 ? round1(pageCount / secs) : null;
  const slaOk = slaMs === null || ms <= slaMs;
  const status: 'pass' | 'fail' = ok && slaOk ? 'pass' : 'fail';
  const suffix = ctx.scale < 1 ? ' (scaled, SLA n/a)' : slaOk ? '' : ` (missed SLA ${slaMs} ms)`;
  return {
    id,
    title,
    status,
    ms: round1(ms),
    mbPerSec,
    pagesPerSec,
    peakHeapMb: ctx.heap(),
    slaMs,
    details: `${detail}${suffix}`,
  };
}

function tagsEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function contentsByteLength(page: PDFPage): number {
  const contents = page.node.Contents();
  if (!contents) return 0;
  const streamLen = (s: PDFStream): number =>
    s instanceof PDFRawStream ? s.contents.length : s.getContents().length;
  if (contents instanceof PDFStream) return streamLen(contents);
  if (contents instanceof PDFArray) {
    let total = 0;
    for (let i = 0; i < contents.size(); i++) {
      const obj = contents.lookup(i);
      if (obj instanceof PDFStream) total += streamLen(obj);
    }
    return total;
  }
  return 0;
}

async function runMergeWorkload(
  id: string,
  title: string,
  ctx: Ctx,
  specs: Array<{ tag: string; pages: number; targetBytes?: number }>,
): Promise<Result> {
  const inputs: InputFile[] = [];
  const plan: PageRef[] = [];
  const expectedTags: string[] = [];
  let totalBytes = 0;

  for (let i = 0; i < specs.length; i++) {
    const s = specs[i]!;
    const bytes = await ctx.api.generate(s);
    totalBytes += bytes.length;
    const fileId = `f${i}`;
    inputs.push({ id: fileId, bytes });
    for (let p = 0; p < s.pages; p++) {
      plan.push({ id: `${fileId}:${p}`, fileId, srcIndex: p, rotation: 0 });
      expectedTags.push(`${s.tag}P${p + 1}`);
    }
  }

  const t0 = performance.now();
  const merged = await ctx.api.merge(inputs, plan);
  const ms = performance.now() - t0;

  const actualTags = await readTags(merged);
  const ok = tagsEqual(actualTags, expectedTags);
  const detail = ok
    ? `${specs.length} files, ${plan.length} pages, ${(merged.length / (1024 * 1024)).toFixed(2)} MB out`
    : `Tag mismatch: expected ${expectedTags.length} pages, got ${actualTags.length}`;
  return perfResult(id, title, ctx, ms, totalBytes, plan.length, ok, detail);
}

export async function runCustomStress(
  ctx: Ctx,
  count: number,
  maxMb: number,
  mixed: boolean,
): Promise<Result> {
  const n = Math.max(1, Math.round(count));
  const specs = Array.from({ length: n }, (_, i) => {
    const minBytes = 50_000;
    const maxBytes = Math.max(minBytes, Math.round(maxMb * 1_000_000 * ctx.scale));
    const ratio = mixed ? (n === 1 ? 1 : i / (n - 1)) : 1;
    const targetBytes = Math.round(minBytes + ratio * (maxBytes - minBytes));
    const pages = Math.max(1, Math.ceil(targetBytes / 750_000));
    return { tag: `C${i}`, pages, targetBytes };
  });
  const res = await runMergeWorkload('CUSTOM', `Custom merge stress (${n} files, max ${maxMb} MB)`, ctx, specs);
  return { ...res, slaMs: null };
}

export const suites: Suite[] = [
  {
    id: 'PERF-01',
    title: 'High-count micro merge (50 files)',
    group: 'perf',
    async run(ctx) {
      const count = Math.max(1, Math.round(50 * ctx.scale));
      const specs = Array.from({ length: count }, (_, i) => ({
        tag: `M${i}`,
        pages: (i % 3) + 1,
        targetBytes: Math.round((50_000 + ((i % 5) / 4) * 950_000) * ctx.scale),
      }));
      return runMergeWorkload('PERF-01', this.title, ctx, specs);
    },
  },
  {
    id: 'PERF-02',
    title: 'Heavyweight binary merge (2 x 75 MB)',
    group: 'perf',
    async run(ctx) {
      const pages = Math.max(1, Math.round(100 * ctx.scale));
      const targetBytes = Math.round(75_000_000 * ctx.scale);
      return runMergeWorkload('PERF-02', this.title, ctx, [
        { tag: 'H1', pages, targetBytes },
        { tag: 'H2', pages, targetBytes },
      ]);
    },
  },
  {
    id: 'PERF-03',
    title: 'Mixed-size sequential merge (10 files)',
    group: 'perf',
    async run(ctx) {
      const mbs = [0.1, 45, 2, 80, 0.5, 12, 0.3, 25, 1, 6];
      const specs = mbs.map((mb, i) => {
        const targetBytes = Math.round(mb * 1_000_000 * ctx.scale);
        const pages = Math.max(1, Math.ceil(targetBytes / 750_000));
        return { tag: `X${i}`, pages, targetBytes };
      });
      return runMergeWorkload('PERF-03', this.title, ctx, specs);
    },
  },
  {
    id: 'PERF-04',
    title: 'Interleaved page splicing (5 PDFs x 20p)',
    group: 'perf',
    async run(ctx) {
      const perDoc = Math.max(2, Math.round(20 * ctx.scale));
      const insertAfter = Math.min(perDoc, Math.max(1, Math.round(10 * ctx.scale)));
      const deleteCount = Math.min(perDoc - 1, Math.max(1, Math.round(10 * ctx.scale)));
      const inputs: InputFile[] = [];
      let totalBytes = 0;

      for (let i = 0; i < 5; i++) {
        const bytes = await ctx.api.generate({ tag: `S${i + 1}`, pages: perDoc });
        totalBytes += bytes.length;
        inputs.push({ id: `f${i + 1}`, bytes });
      }

      const plan: PageRef[] = [];
      const expected: string[] = [];
      const pushPage = (fNum: number, idx: number) => {
        plan.push({ id: `f${fNum}:${idx}`, fileId: `f${fNum}`, srcIndex: idx, rotation: 0 });
        expected.push(`S${fNum}P${idx + 1}`);
      };

      for (let p = 0; p < insertAfter; p++) pushPage(1, p);
      for (let p = 0; p < perDoc; p++) pushPage(5, p);
      for (let p = insertAfter; p < perDoc; p++) pushPage(1, p);
      for (let p = perDoc - 1; p >= 0; p--) pushPage(2, p);
      for (let p = deleteCount; p < perDoc; p++) pushPage(3, p);
      for (let p = 0; p < perDoc; p++) pushPage(4, p);

      const t0 = performance.now();
      const out = await ctx.api.merge(inputs, plan);
      const ms = performance.now() - t0;

      const actual = await readTags(out);
      const ok = tagsEqual(actual, expected);
      return perfResult(
        'PERF-04',
        this.title,
        ctx,
        ms,
        totalBytes,
        plan.length,
        ok,
        ok ? `${plan.length} spliced pages verified` : `Expected ${expected.length} tags, got ${actual.length}`,
      );
    },
  },
  {
    id: 'PERF-05',
    title: 'Mass burst split (200p, 50 MB -> zip)',
    group: 'perf',
    async run(ctx) {
      const pages = Math.max(1, Math.round(200 * ctx.scale));
      const targetBytes = Math.round(50_000_000 * ctx.scale);
      const src = await ctx.api.generate({ tag: '', pages, targetBytes });
      const totalBytes = src.length;

      const t0 = performance.now();
      const zip = await ctx.api.burst(src);
      const ms = performance.now() - t0;

      const entries = unzipSync(zip);
      const names = Object.keys(entries).sort();
      let ok = names.length === pages;
      if (ok) {
        const checks = [0, Math.floor(names.length / 2), names.length - 1];
        for (const idx of checks) {
          const entryBytes = entries[names[idx]!]!;
          const tags = await readTags(entryBytes);
          if (tags.length !== 1 || tags[0] !== `P${idx + 1}`) {
            ok = false;
            break;
          }
        }
      }
      return perfResult(
        'PERF-05',
        this.title,
        ctx,
        ms,
        totalBytes,
        pages,
        ok,
        ok ? `${names.length} zip entries verified` : `Zip burst mismatch (${names.length}/${pages})`,
      );
    },
  },
  {
    id: 'PERF-06',
    title: 'Batch editor flattening (50p)',
    group: 'perf',
    async run(ctx) {
      const pages = Math.max(1, Math.round(50 * ctx.scale));
      const src = await ctx.api.generate({ tag: 'B6', pages });
      const srcLen = src.length;
      const srcDoc = await PDFDocument.load(src);
      const expectedRot = srcDoc.getPages().map((p) => (((p.getRotation().angle + 90) % 360) + 360) % 360 as Rot);
      const expectedTags = Array.from({ length: pages }, (_, i) => `B6P${i + 1}`);

      const edits: Edit[] = [];
      for (let i = 0; i < pages; i++) {
        edits.push({
          kind: 'image',
          page: i,
          x: 60,
          y: 80,
          width: 90,
          height: 36,
          angle: 0,
          opacity: 1,
          mime: 'image/png',
          bytes: PNG_1X1,
        });
        edits.push({
          kind: 'text',
          page: i,
          x: 60,
          y: 130,
          lines: [`Signed page ${i + 1}`],
          lineStep: 14,
          size: 12,
          font: 'Helvetica',
          color: [0, 0, 0],
          opacity: 1,
          angle: 0,
          underline: false,
        });
      }

      const t0 = performance.now();
      const out = await ctx.api.applyEdits(src, edits, 90);
      const ms = performance.now() - t0;

      const outDoc = await PDFDocument.load(out);
      const outRots = outDoc.getPages().map((p) => p.getRotation().angle);
      const outTags = await readTags(out);
      const ok =
        outDoc.getPageCount() === pages &&
        out.length > srcLen &&
        tagsEqual(outTags, expectedTags) &&
        outRots.every((r, idx) => r === expectedRot[idx]);

      return perfResult(
        'PERF-06',
        this.title,
        ctx,
        ms,
        srcLen,
        pages,
        ok,
        ok ? `${pages} pages flattened & rotated +90°` : 'Verification mismatch after applyEdits',
      );
    },
  },
  {
    id: 'INV-01',
    title: 'Page count conservation law',
    group: 'invariant',
    async run(ctx) {
      const rng = makePrng(101);
      const counts = [6, 8, 10];
      const inputs: InputFile[] = [];
      const all: PageRef[] = [];
      let totalInputPages = 0;

      for (let i = 0; i < counts.length; i++) {
        const pCount = counts[i]!;
        totalInputPages += pCount;
        const bytes = await ctx.api.generate({ tag: `I${i}`, pages: pCount });
        inputs.push({ id: `f${i}`, bytes });
        for (let p = 0; p < pCount; p++) {
          all.push({ id: `f${i}:${p}`, fileId: `f${i}`, srcIndex: p, rotation: 0 });
        }
      }

      const kept = all.filter(() => rng() > 0.25);
      const deleted = all.length - kept.length;
      const insertedList = all.slice(0, 3).map((p, idx) => ({ ...p, id: `ins:${idx}` }));
      const plan = [...kept, ...insertedList];
      const expectedCount = totalInputPages - deleted + insertedList.length;

      const t0 = performance.now();
      const out = await ctx.api.merge(inputs, plan);
      const ms = round1(performance.now() - t0);
      const outTags = await readTags(out);
      const ok = outTags.length === expectedCount;

      return {
        id: 'INV-01',
        title: this.title,
        status: ok ? 'pass' : 'fail',
        ms,
        mbPerSec: null,
        pagesPerSec: null,
        peakHeapMb: ctx.heap(),
        slaMs: null,
        details: `${totalInputPages} - ${deleted} + ${insertedList.length} = ${outTags.length} (expected ${expectedCount})`,
      };
    },
  },
  {
    id: 'INV-02',
    title: 'Sequential order tag fidelity',
    group: 'invariant',
    async run(ctx) {
      const rng = makePrng(202);
      const inputs: InputFile[] = [];
      const plan: Array<{ ref: PageRef; tag: string }> = [];

      for (let f = 0; f < 3; f++) {
        const bytes = await ctx.api.generate({ tag: `O${f}`, pages: 5 });
        inputs.push({ id: `o${f}`, bytes });
        for (let p = 0; p < 5; p++) {
          plan.push({
            ref: { id: `o${f}:${p}`, fileId: `o${f}`, srcIndex: p, rotation: 0 },
            tag: `O${f}P${p + 1}`,
          });
        }
      }

      for (let i = plan.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [plan[i], plan[j]] = [plan[j]!, plan[i]!];
      }

      const t0 = performance.now();
      const out = await ctx.api.merge(
        inputs,
        plan.map((x) => x.ref),
      );
      const ms = round1(performance.now() - t0);
      const actual = await readTags(out);
      const expected = plan.map((x) => x.tag);
      const ok = tagsEqual(actual, expected);

      return {
        id: 'INV-02',
        title: this.title,
        status: ok ? 'pass' : 'fail',
        ms,
        mbPerSec: null,
        pagesPerSec: null,
        peakHeapMb: ctx.heap(),
        slaMs: null,
        details: ok ? `${expected.length} shuffled pages matched exactly` : 'Tag sequence mismatch',
      };
    },
  },
  {
    id: 'INV-03',
    title: 'Mixed MediaBox, CropBox & /Rotate preservation',
    group: 'invariant',
    async run(ctx) {
      const specs: Array<[number, number, 0 | 90 | 180 | 270]> = [
        [595, 842, 0],
        [792, 612, 0],
        [226, 800, 0],
        [595, 842, 90],
        [500, 700, 0],
      ];
      const src = await ctx.api.generate({ tag: 'D', pages: 5, sizes: specs, cropBox: true });
      const srcDoc = await PDFDocument.load(src);
      const expected = srcDoc.getPages().map((p, idx) => ({
        media: p.getMediaBox(),
        crop: p.getCropBox(),
        rot: (p.getRotation().angle + (idx === 3 ? 90 : 0)) % 360,
      }));

      const plan: PageRef[] = specs.map((_, idx) => ({
        id: `d:${idx}`,
        fileId: 'd',
        srcIndex: idx,
        rotation: idx === 3 ? 90 : 0,
      }));

      const t0 = performance.now();
      const out = await ctx.api.merge([{ id: 'd', bytes: src }], plan);
      const ms = round1(performance.now() - t0);

      const outDoc = await PDFDocument.load(out);
      const outPages = outDoc.getPages();
      let ok = outPages.length === expected.length;
      if (ok) {
        for (let i = 0; i < expected.length; i++) {
          const e = expected[i]!;
          const p = outPages[i]!;
          const m = p.getMediaBox();
          const c = p.getCropBox();
          const r = p.getRotation().angle;
          if (
            m.x !== e.media.x ||
            m.y !== e.media.y ||
            m.width !== e.media.width ||
            m.height !== e.media.height ||
            c.x !== e.crop.x ||
            c.y !== e.crop.y ||
            c.width !== e.crop.width ||
            c.height !== e.crop.height ||
            r !== e.rot
          ) {
            ok = false;
            break;
          }
        }
      }

      return {
        id: 'INV-03',
        title: this.title,
        status: ok ? 'pass' : 'fail',
        ms,
        mbPerSec: null,
        pagesPerSec: null,
        peakHeapMb: ctx.heap(),
        slaMs: null,
        details: ok ? 'MediaBox, CropBox, and /Rotate preserved across all 5 geometries' : 'Box/rotation mismatch',
      };
    },
  },
  {
    id: 'INV-04',
    title: 'Editor coordinate precision (<= 0.5 pt)',
    group: 'invariant',
    async run(ctx) {
      if (!ctx.hasCanvas) {
        return {
          id: 'INV-04',
          title: this.title,
          status: 'skip',
          ms: 0,
          mbPerSec: null,
          pagesPerSec: null,
          peakHeapMb: null,
          slaMs: null,
          details: 'canvas required (browser only)',
        };
      }

      const { FabricImage, Path, StaticCanvas } = await import('fabric');
      const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
      const t0 = performance.now();

      const measureCase = async (rot: Rot, kind: 'rect' | 'image'): Promise<number> => {
        const doc = await PDFDocument.create();
        const p = doc.addPage([595, 842]);
        if (rot !== 0) p.setRotation(degrees(rot));
        const srcBytes = await doc.save();

        const srcProxy = await getDocument({ data: srcBytes.slice() }).promise;
        const pdfPage = await srcProxy.getPage(1);
        const vp1 = pdfPage.getViewport({ scale: 1 });
        await srcProxy.loadingTask.destroy();

        const box = { left: 110, top: 150, width: 120, height: 60 };
        const fc = new StaticCanvas(undefined, {
          width: Math.ceil(vp1.width * 2.25),
          height: Math.ceil(vp1.height * 2.25),
        });
        fc.setZoom(2.25);

        if (kind === 'rect') {
          const rect = new Path(
            `M ${box.left} ${box.top} L ${box.left + box.width} ${box.top} L ${box.left + box.width} ${box.top + box.height} L ${box.left} ${box.top + box.height} Z`,
            { fill: '#000000', stroke: null, strokeWidth: 0 },
          );
          fc.add(rect);
        } else {
          const c = document.createElement('canvas');
          c.width = 20;
          c.height = 10;
          const cctx = c.getContext('2d')!;
          cctx.fillStyle = '#000000';
          cctx.fillRect(0, 0, 20, 10);
          const url = c.toDataURL('image/png');
          const img = await FabricImage.fromURL(url);
          img.set({
            left: box.left,
            top: box.top,
            scaleX: box.width / 20,
            scaleY: box.height / 10,
          });
          fc.add(img);
        }

        const edits = toEdits(fc.getObjects(), 0, vp1, rot);
        await fc.dispose();

        const outBytes = await ctx.api.applyEdits(srcBytes, edits);
        const outProxy = await getDocument({ data: outBytes }).promise;
        const outPage = await outProxy.getPage(1);
        const renderScale = 4;
        const vp4 = outPage.getViewport({ scale: renderScale });
        const canvas = document.createElement('canvas');
        canvas.width = Math.ceil(vp4.width);
        canvas.height = Math.ceil(vp4.height);
        const rctx = canvas.getContext('2d')!;
        await outPage.render({ canvas, canvasContext: rctx, viewport: vp4 }).promise;
        await outProxy.loadingTask.destroy();

        const data = rctx.getImageData(0, 0, canvas.width, canvas.height).data;
        let minX = canvas.width;
        let minY = canvas.height;
        let maxX = -1;
        let maxY = -1;
        for (let y = 0; y < canvas.height; y++) {
          for (let x = 0; x < canvas.width; x++) {
            const idx = (y * canvas.width + x) * 4;
            if (data[idx]! < 128 && data[idx + 1]! < 128 && data[idx + 2]! < 128 && data[idx + 3]! > 128) {
              if (x < minX) minX = x;
              if (y < minY) minY = y;
              if (x > maxX) maxX = x;
              if (y > maxY) maxY = y;
            }
          }
        }
        if (maxX < minX) throw new Error(`No dark pixels rendered for rot=${rot} kind=${kind}`);

        const actualLeft = minX / renderScale;
        const actualTop = minY / renderScale;
        const actualRight = (maxX + 1) / renderScale;
        const actualBottom = (maxY + 1) / renderScale;
        return Math.max(
          Math.abs(actualLeft - box.left),
          Math.abs(actualTop - box.top),
          Math.abs(actualRight - (box.left + box.width)),
          Math.abs(actualBottom - (box.top + box.height)),
        );
      };

      const errors = [
        await measureCase(90, 'rect'),
        await measureCase(0, 'rect'),
        await measureCase(270, 'rect'),
        await measureCase(90, 'image'),
      ];
      const maxErr = Math.max(...errors);
      const ms = round1(performance.now() - t0);
      const ok = maxErr <= 0.5;

      return {
        id: 'INV-04',
        title: this.title,
        status: ok ? 'pass' : 'fail',
        ms,
        mbPerSec: null,
        pagesPerSec: null,
        peakHeapMb: ctx.heap(),
        slaMs: null,
        details: `max edge error ${maxErr.toFixed(2)} pt (errors: ${errors.map((e) => e.toFixed(2)).join(', ')})`,
      };
    },
  },
  {
    id: 'EDGE-01',
    title: 'Encrypted PDF detection & batch isolation',
    group: 'edge',
    async run(ctx) {
      const valid1 = await ctx.api.generate({ tag: 'E1', pages: 1 });
      const valid2 = await ctx.api.generate({ tag: 'E2', pages: 1 });
      const enc = makeEncryptedPdf();

      const t0 = performance.now();
      const batch = [
        { id: 'v1', bytes: valid1 },
        { id: 'enc', bytes: enc },
        { id: 'v2', bytes: valid2 },
      ];
      const accepted: InputFile[] = [];
      let encReason = '';
      for (const item of batch) {
        const res = await ctx.api.inspect(item.bytes.slice());
        if (res.ok) accepted.push(item);
        else if (item.id === 'enc') encReason = res.reason;
      }
      const merged = await ctx.api.merge(
        accepted,
        accepted.map((a) => ({ id: `${a.id}:0`, fileId: a.id, srcIndex: 0, rotation: 0 })),
      );
      const ms = round1(performance.now() - t0);
      const tags = await readTags(merged);
      const ok = encReason === 'encrypted' && tagsEqual(tags, ['E1P1', 'E2P1']);

      return {
        id: 'EDGE-01',
        title: this.title,
        status: ok ? 'pass' : 'fail',
        ms,
        mbPerSec: null,
        pagesPerSec: null,
        peakHeapMb: ctx.heap(),
        slaMs: null,
        details: ok ? 'Encrypted rejected; remaining 2 files merged' : `encReason=${encReason}`,
      };
    },
  },
  {
    id: 'EDGE-02',
    title: 'Non-PDF bytes rejection',
    group: 'edge',
    async run(ctx) {
      const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
      const randBytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
      const t0 = performance.now();
      const r1 = await ctx.api.inspect(pngBytes);
      const r2 = await ctx.api.inspect(randBytes);
      const ms = round1(performance.now() - t0);
      const ok = !r1.ok && r1.reason === 'not-pdf' && !r2.ok && r2.reason === 'not-pdf';
      return {
        id: 'EDGE-02',
        title: this.title,
        status: ok ? 'pass' : 'fail',
        ms,
        mbPerSec: null,
        pagesPerSec: null,
        peakHeapMb: ctx.heap(),
        slaMs: null,
        details: ok ? 'Random and PNG bytes rejected as not-pdf' : 'Failed to reject non-PDF',
      };
    },
  },
  {
    id: 'EDGE-03',
    title: 'Duplicate AcroForm field names flattened',
    group: 'edge',
    async run(ctx) {
      const f1 = await ctx.api.generate({ tag: 'FA', pages: 1, formField: 'Text1' });
      const f2 = await ctx.api.generate({ tag: 'FB', pages: 1, formField: 'Text1' });
      const srcDoc1 = await PDFDocument.load(f1);
      const srcLen1 = contentsByteLength(srcDoc1.getPages()[0]!);

      const t0 = performance.now();
      const merged = await ctx.api.merge(
        [
          { id: 'fa', bytes: f1 },
          { id: 'fb', bytes: f2 },
        ],
        [
          { id: 'fa:0', fileId: 'fa', srcIndex: 0, rotation: 0 },
          { id: 'fb:0', fileId: 'fb', srcIndex: 0, rotation: 0 },
        ],
      );
      const ms = round1(performance.now() - t0);

      const outDoc = await PDFDocument.load(merged);
      const outLen1 = contentsByteLength(outDoc.getPages()[0]!);
      const ok =
        outDoc.getPageCount() === 2 &&
        outDoc.getForm().getFields().length === 0 &&
        outLen1 > srcLen1;

      return {
        id: 'EDGE-03',
        title: this.title,
        status: ok ? 'pass' : 'fail',
        ms,
        mbPerSec: null,
        pagesPerSec: null,
        peakHeapMb: ctx.heap(),
        slaMs: null,
        details: ok
          ? `Flattened cleanly (Contents ${srcLen1} -> ${outLen1} bytes)`
          : `Failed: pages=${outDoc.getPageCount()}, outLen=${outLen1} <= ${srcLen1}`,
      };
    },
  },
  {
    id: 'EDGE-04',
    title: 'Empty, 0-page, and truncated PDFs',
    group: 'edge',
    async run(ctx) {
      const valid = await ctx.api.generate({ tag: 'TR', pages: 2 });
      const truncated = valid.slice(0, Math.floor(valid.length * 0.4));
      const t0 = performance.now();
      const rEmpty = await ctx.api.inspect(new Uint8Array(0));
      const rZero = await ctx.api.inspect(makeZeroPagePdf());
      const rTrunc = await ctx.api.inspect(truncated);
      const ms = round1(performance.now() - t0);
      const ok =
        !rEmpty.ok &&
        rEmpty.reason === 'empty' &&
        !rZero.ok &&
        rZero.reason === 'no-pages' &&
        !rTrunc.ok &&
        rTrunc.reason === 'corrupt';
      return {
        id: 'EDGE-04',
        title: this.title,
        status: ok ? 'pass' : 'fail',
        ms,
        mbPerSec: null,
        pagesPerSec: null,
        peakHeapMb: ctx.heap(),
        slaMs: null,
        details: ok ? 'empty / no-pages / corrupt detected accurately' : 'Unexpected inspect reasons',
      };
    },
  },
  {
    id: 'CUSTOM',
    title: 'Custom merge stress (default 5 files x 2 MB)',
    group: 'custom',
    async run(ctx) {
      return runCustomStress(ctx, 5, 2, true);
    },
  },
  {
    id: 'CUSTOM-RAMP',
    title: 'Escalating merge stress (count and max MB grow each step)',
    group: 'custom',
    async run(ctx) {
      // [files, max MB per file]; stops at the first step the device cannot handle.
      const steps: Array<[number, number]> = [[5, 2], [10, 5], [20, 10], [40, 20], [60, 40], [100, 75]];
      const t0 = performance.now();
      let last: [number, number] | null = null;
      for (const [n, mb] of steps) {
        try {
          const r = await runCustomStress(ctx, n, mb, true);
          if (r.status === 'fail') throw new Error(r.details);
          last = [n, mb];
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return {
            id: 'CUSTOM-RAMP',
            title: this.title,
            // Failing the first step is a real failure; later steps just mark this device's ceiling.
            status: last ? 'pass' : 'fail',
            ms: round1(performance.now() - t0),
            mbPerSec: null,
            pagesPerSec: null,
            peakHeapMb: ctx.heap(),
            slaMs: null,
            details: `ceiling: ${last ? `${last[0]} files x ${last[1]} MB` : 'none'}; failed at ${n} x ${mb} MB: ${msg}`,
          };
        }
      }
      return {
        id: 'CUSTOM-RAMP',
        title: this.title,
        status: 'pass',
        ms: round1(performance.now() - t0),
        mbPerSec: null,
        pagesPerSec: null,
        peakHeapMb: ctx.heap(),
        slaMs: null,
        details: `all ${steps.length} steps passed, up to ${last![0]} files x ${last![1]} MB`,
      };
    },
  },
];
