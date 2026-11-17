import {
  GlobalWorkerOptions,
  PDFDataRangeTransport,
  RenderingCancelledException,
  getDocument,
  type PDFDocumentProxy,
  type PageViewport,
} from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';

GlobalWorkerOptions.workerSrc = workerUrl;

const docs = new Map<string, Promise<PDFDocumentProxy>>();
const thumbCache = new Map<string, ImageBitmap>();
const MAX_THUMBS = 48;

let activeRenders = 0;
const waitQueue: Array<() => void> = [];

function acquireRenderSlot(): Promise<void> {
  if (activeRenders < 2) {
    activeRenders++;
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    waitQueue.push(() => {
      activeRenders++;
      resolve();
    });
  });
}

function releaseRenderSlot(): void {
  activeRenders--;
  const next = waitQueue.shift();
  if (next) next();
}

export async function openPdf(file: File | Uint8Array, key: string): Promise<PDFDocumentProxy> {
  const existing = docs.get(key);
  if (existing) return existing;

  const p = (async () => {
    if (!(file instanceof Blob)) return getDocument({ data: file.slice() }).promise;
    // Files are read in 1 MB slices on demand: previews of a 2 GB PDF only pull in the parts a page needs,
    // instead of holding a second full copy of the file next to the one being processed.
    // A slice can fail to read (private windows keep large Blobs in memory, with a cap). Then loading stops
    // with an error instead of pdf.js waiting forever for that range.
    let fail: (err: Error) => void = () => {};
    const failed = new Promise<never>((_, reject) => (fail = reject));
    const range = new PDFDataRangeTransport(file.size, null);
    const task = getDocument({ range, rangeChunkSize: 1 << 20, disableAutoFetch: true, disableStream: true });
    range.requestDataRange = (begin: number, end: number) => {
      void file
        .slice(begin, end)
        .arrayBuffer()
        .then((buf) => range.onDataRange(begin, new Uint8Array(buf)))
        .catch((err: unknown) => {
          void task.destroy();
          fail(new Error(`The file could not be read (${err instanceof Error ? err.name : 'read error'}).`));
        });
    };
    return Promise.race([task.promise, failed]);
  })();

  docs.set(key, p);
  try {
    return await p;
  } catch (err) {
    docs.delete(key);
    throw err;
  }
}

export function closePdf(key: string): void {
  const p = docs.get(key);
  if (p) {
    docs.delete(key);
    void p.then((doc) => doc.loadingTask.destroy()).catch(() => {});
  }
  for (const [k, bmp] of thumbCache.entries()) {
    if (k.startsWith(`${key}:`)) {
      bmp.close();
      thumbCache.delete(k);
    }
  }
}

export async function renderThumb(
  key: string,
  pageIndex: number,
  cssWidth: number,
  signal: AbortSignal,
): Promise<ImageBitmap | null> {
  if (signal.aborted) return null;
  const cacheKey = `${key}:${pageIndex}:${Math.round(cssWidth)}`;
  const cached = thumbCache.get(cacheKey);
  if (cached) {
    thumbCache.delete(cacheKey);
    thumbCache.set(cacheKey, cached);
    return cached;
  }

  const docPromise = docs.get(key);
  if (!docPromise) return null;

  await acquireRenderSlot();
  try {
    if (signal.aborted) return null;
    const doc = await docPromise;
    if (signal.aborted) return null;

    const page = await doc.getPage(pageIndex + 1);
    if (signal.aborted) return null;

    const dpr = Math.min(2, typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1);
    const baseVp = page.getViewport({ scale: 1 });
    const vp = page.getViewport({ scale: (cssWidth * dpr) / baseVp.width });

    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.ceil(vp.width));
    canvas.height = Math.max(1, Math.ceil(vp.height));
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    const task = page.render({ canvas, canvasContext: ctx, viewport: vp });
    const onAbort = () => task.cancel();
    signal.addEventListener('abort', onAbort, { once: true });
    try {
      await task.promise;
    } catch (err) {
      if (err instanceof RenderingCancelledException || signal.aborted) {
        return null;
      }
      throw err;
    } finally {
      signal.removeEventListener('abort', onAbort);
    }

    if (signal.aborted) return null;
    const bitmap = await createImageBitmap(canvas);
    if (signal.aborted) {
      bitmap.close();
      return null;
    }

    const old = thumbCache.get(cacheKey);
    if (old) {
      old.close();
      thumbCache.delete(cacheKey);
    } else if (thumbCache.size >= MAX_THUMBS) {
      const oldestKey = thumbCache.keys().next().value;
      if (oldestKey !== undefined) {
        thumbCache.get(oldestKey)?.close();
        thumbCache.delete(oldestKey);
      }
    }
    thumbCache.set(cacheKey, bitmap);
    return bitmap;
  } finally {
    releaseRenderSlot();
  }
}

export async function renderPage(
  key: string,
  pageIndex: number,
  canvas: HTMLCanvasElement,
  scale: number,
): Promise<PageViewport> {
  const docPromise = docs.get(key);
  if (!docPromise) throw new Error(`PDF "${key}" is not open`);
  const doc = await docPromise;
  const page = await doc.getPage(pageIndex + 1);
  const dpr = Math.min(2, typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1);
  const cssVp = page.getViewport({ scale });
  const renderVp = page.getViewport({ scale: scale * dpr });

  canvas.width = Math.max(1, Math.ceil(renderVp.width));
  canvas.height = Math.max(1, Math.ceil(renderVp.height));
  canvas.style.width = `${cssVp.width}px`;
  canvas.style.height = `${cssVp.height}px`;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable');
  await page.render({ canvas, canvasContext: ctx, viewport: renderVp }).promise;
  return page.getViewport({ scale: 1 });
}
