import { generate } from '../pdf/generate.ts';
import { applyEdits, burst, encryptFile, inspectAny, merge, mergeFiles, split, unlockFile } from '../pdf/ops.ts';
import { compress } from '../pdf/compress.ts';
import { convert, type ConvertOpts } from '../pdf/convert.ts';
import { encrypt, unlock, type CryptAlgorithm } from '../pdf/crypt.ts';
import { fillForm, formFields, reshape, type FieldValues, type PageSpec } from '../pdf/pages.ts';
import { browserCodec } from './imageCodec.ts';
import { replaceText, type TextReplacement } from '../pdf/textEdit.ts';
import type { Edit, GenSpec, InputFile, PageRef, PdfApi, Progress, Rot } from '../pdf/types.ts';

type Req = { id: number; method: keyof PdfApi; args: unknown[] };
type Res =
  | { id: number; ok: true; result: unknown; ms: number; heapMb: number | null }
  | { id: number; ok: false; error: { name: string; message: string; chars?: string[] } };
type Prog = { id: number; progress: [number, number, string?]; heapMb: number | null };

const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<Req>) => void) | null;
  postMessage(message: Res | Prog, transfer?: Transferable[]): void;
};

function sampleHeapMb(): number | null {
  const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
  return mem ? Math.round((mem.usedJSHeapSize / (1024 * 1024)) * 10) / 10 : null;
}

function collectTransfer(result: unknown): Transferable[] {
  const set = new Set<ArrayBuffer>();
  if (result instanceof Uint8Array && result.buffer instanceof ArrayBuffer) {
    set.add(result.buffer);
  } else if (result && typeof result === 'object' && (result as { bytes?: unknown }).bytes instanceof Uint8Array) {
    // unlock / compress results: move the buffer instead of copying it.
    const b = (result as { bytes: Uint8Array }).bytes;
    if (b.buffer instanceof ArrayBuffer) set.add(b.buffer);
  } else if (result && typeof result === 'object' && Array.isArray((result as { files?: unknown }).files)) {
    for (const f of (result as { files: Array<{ bytes: Uint8Array }> }).files) {
      if (f.bytes.buffer instanceof ArrayBuffer) set.add(f.bytes.buffer);
    }
  } else if (Array.isArray(result)) {
    for (const item of result) {
      if (item instanceof Uint8Array && item.buffer instanceof ArrayBuffer) {
        set.add(item.buffer);
      }
    }
  }
  return [...set];
}

ctx.onmessage = async (e: MessageEvent<Req>) => {
  const { id, method, args } = e.data;
  const start = performance.now();
  let peakHeap = sampleHeapMb();
  const trackHeap = (): number | null => {
    const h = sampleHeapMb();
    if (h !== null) {
      peakHeap = peakHeap === null ? h : Math.max(peakHeap, h);
    }
    return h;
  };
  const onProgress: Progress = (done, total, stage) => {
    ctx.postMessage({ id, progress: [done, total, stage], heapMb: trackHeap() });
  };

  try {
    let result: unknown;
    switch (method) {
      case 'inspect':
        result = await inspectAny(args[0] as Uint8Array | Blob);
        break;
      case 'merge':
        result = await merge(args[0] as InputFile[], args[1] as PageRef[], onProgress);
        break;
      case 'unlockFile':
        result = await unlockFile(args[0] as Blob, args[1] as string | undefined);
        break;
      case 'encryptFile':
        result = await encryptFile(args[0] as Blob, args[1] as string, args[2] as CryptAlgorithm | undefined);
        break;
      case 'mergeFiles':
        result = await mergeFiles(args[0] as Array<{ id: string; file: Blob }>, args[1] as PageRef[], onProgress);
        break;
      case 'split':
        result = await split(args[0] as Uint8Array, args[1] as number[][], onProgress);
        break;
      case 'burst':
        result = await burst(args[0] as Uint8Array, onProgress);
        break;
      case 'applyEdits':
        result = await applyEdits(args[0] as Uint8Array, args[1] as Edit[], args[2] as Rot | undefined);
        break;
      case 'replaceText':
        result = await replaceText(args[0] as Uint8Array, args[1] as TextReplacement[]);
        break;
      case 'unlock':
        result = await unlock(args[0] as Uint8Array, args[1] as string | undefined);
        break;
      case 'encrypt':
        result = await encrypt(args[0] as Uint8Array, args[1] as string, args[2] as CryptAlgorithm | undefined);
        break;
      case 'formFields':
        result = await formFields(args[0] as Uint8Array);
        break;
      case 'fillForm':
        result = await fillForm(args[0] as Uint8Array, args[1] as FieldValues);
        break;
      case 'reshape':
        result = await reshape(args[0] as Uint8Array, args[1] as PageSpec[]);
        break;
      case 'convert':
        result = await convert(args[0] as Uint8Array, args[1] as ConvertOpts, onProgress);
        break;
      case 'compress':
        result = await compress(args[0] as Uint8Array, args[1] as number, browserCodec, args[2] as boolean, onProgress);
        break;
      case 'generate':
        result = await generate(args[0] as GenSpec);
        break;
      default:
        throw new Error(`Unknown worker method: ${String(method)}`);
    }
    const ms = Math.round((performance.now() - start) * 10) / 10;
    const heapMb = trackHeap();
    ctx.postMessage({ id, ok: true, result, ms, heapMb }, collectTransfer(result));
  } catch (err) {
    const errObj = err instanceof Error ? err : new Error(String(err));
    const chars = (err as { chars?: unknown }).chars;
    ctx.postMessage({
      id,
      ok: false,
      error: {
        name: errObj.name || 'Error',
        message: errObj.message,
        ...(Array.isArray(chars) ? { chars: chars.map(String) } : {}),
      },
    });
  }
};
