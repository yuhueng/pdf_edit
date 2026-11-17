export type MuPdfSession = {
  mupdf: typeof import('mupdf');
  doc: import('mupdf').Document;
  close(): void;
};

/**
 * Something MuPDF can read without the whole file being in one buffer: `read` returns up to `len` bytes at
 * `pos` (fewer at a block edge or the end). mupdf.js passes file offsets as signed 32-bit numbers, so
 * sources must stay under 2 GiB (MAX_FILE_BYTES keeps every input below that).
 */
export type SyncSource = { size: number; read(pos: number, len: number): Uint8Array };

export const bytesSource = (bytes: Uint8Array): SyncSource => ({
  size: bytes.byteLength,
  read: (pos, len) => bytes.subarray(pos, Math.min(bytes.byteLength, pos + len)),
});

/** Reads a `Blob` (a picked `File`) in 4 MiB blocks with `FileReaderSync`, keeping the last few. Workers only. */
export function blobSource(blob: Blob, blockSize = 4 << 20, maxBlocks = 6): SyncSource {
  const Reader = (globalThis as { FileReaderSync?: new () => { readAsArrayBuffer(b: Blob): ArrayBuffer } }).FileReaderSync;
  if (!Reader) throw new Error('Files can only be read in slices inside the PDF worker.');
  const reader = new Reader();
  const cache = new Map<number, Uint8Array>();
  return {
    size: blob.size,
    read(pos, len) {
      if (pos >= blob.size || len <= 0) return new Uint8Array(0);
      const idx = Math.floor(pos / blockSize);
      let block = cache.get(idx);
      if (block) cache.delete(idx); // re-inserted below as the most recent
      else {
        const start = idx * blockSize;
        block = new Uint8Array(reader.readAsArrayBuffer(blob.slice(start, Math.min(blob.size, start + blockSize))));
        if (cache.size >= maxBlocks) cache.delete(cache.keys().next().value!);
      }
      cache.set(idx, block);
      const off = pos - idx * blockSize;
      return block.subarray(off, Math.min(block.length, off + len));
    },
  };
}

/**
 * Opens a PDF in MuPDF through an on-demand `Stream`, so the input is never copied into MuPDF's 2 GiB
 * WebAssembly heap. Takes bytes, or a `SyncSource` to read a file in slices.
 */
export async function openMuPdf(input: Uint8Array | SyncSource): Promise<MuPdfSession> {
  const mupdf = await import('mupdf');
  const src = input instanceof Uint8Array ? bytesSource(input) : input;
  const len = src.size;
  const stm = new mupdf.Stream({
    fileSize: () => len,
    read(mem, off, size, pos) {
      if (pos < 0 || pos >= len) return 0;
      const chunk = src.read(pos, Math.min(size, len - pos));
      mem.set(chunk, off);
      return chunk.length;
    },
    close() {},
  });
  let doc: import('mupdf').Document | null = null;
  try {
    doc = mupdf.Document.openDocument(stm, 'application/pdf');
    return {
      mupdf,
      doc,
      close() {
        doc?.destroy();
        stm.destroy();
        mupdf.emptyStore();
      },
    };
  } catch (err) {
    doc?.destroy();
    stm.destroy();
    mupdf.emptyStore();
    throw err;
  }
}

/** Copies bytes out of a MuPDF WASM `Buffer` into JS memory and frees the WASM allocation. */
export function bufferToBytes(buf: import('mupdf').Buffer): Uint8Array {
  try {
    return new Uint8Array(buf.asUint8Array());
  } finally {
    buf.destroy();
  }
}

/**
 * True for out-of-memory failures: MuPDF malloc/realloc errors, an aborted or full WASM heap,
 * and JS `RangeError`s such as "Array buffer allocation failed". Callers fall back to a 64-bit JS path.
 */
export const isWasmMemError = (err: unknown): boolean =>
  err instanceof RangeError ||
  (err instanceof Error && /malloc|realloc|memory|abort|alloc(ation)? failed|\boom\b/i.test(err.message));
