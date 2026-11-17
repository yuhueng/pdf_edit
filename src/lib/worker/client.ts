import type { CompressResult } from "../pdf/compress.ts";
import type { ConvertOpts, ConvertResult } from "../pdf/convert.ts";
import type { CryptAlgorithm, UnlockResult } from "../pdf/crypt.ts";
import type { FieldValues, FormField, PageSpec } from "../pdf/pages.ts";
import type { TextReplacement } from "../pdf/textEdit.ts";
import type {
  Edit,
  GenSpec,
  InputFile,
  InspectResult,
  PageRef,
  PdfApi,
  Progress,
  Rot,
} from "../pdf/types.ts";

type Res =
  | { id: number; ok: true; result: unknown; ms: number; heapMb: number | null }
  | {
      id: number;
      ok: false;
      error: { name: string; message: string; chars?: string[] };
    };
type Prog = { id: number; progress: [number, number, string?]; heapMb: number | null };

function collectBuffers(val: unknown, out: Set<ArrayBuffer>): void {
  if (val instanceof Uint8Array) {
    if (val.buffer instanceof ArrayBuffer) {
      out.add(val.buffer);
    }
    return;
  }
  if (Array.isArray(val)) {
    for (const item of val) collectBuffers(item, out);
    return;
  }
  if (val && typeof val === "object") {
    for (const v of Object.values(val)) collectBuffers(v, out);
  }
}

export type WorkerApi = PdfApi & {
  lastHeapMb(): number | null;
  concurrency: number;
};

/** Jobs that are independent per file may fan out over extra workers; everything else stays on the first one. */
const POOLED: ReadonlySet<keyof PdfApi> = new Set(["compress"]);
type Slot = { w: Worker; busy: number };

export function createWorkerApi(): WorkerApi {
  // Each extra worker costs memory, so phones get fewer and a single core gets none.
  const cores =
    typeof navigator === "undefined" ? 2 : navigator.hardwareConcurrency || 2;
  const phone =
    typeof matchMedia !== "undefined" &&
    matchMedia("(pointer: coarse)").matches;
  const MAX = Math.max(1, Math.min(phone ? 2 : 3, cores - 1));
  const slots: Slot[] = [];
  let nextId = 1;
  let lastPeakHeap: number | null = null;

  const pending = new Map<
    number,
    {
      method: keyof PdfApi;
      slot: Slot;
      resolve: (val: unknown) => void;
      reject: (err: Error) => void;
      onProgress?: Progress;
      peakHeap: number | null;
    }
  >();

  const bumpHeap = (
    cur: number | null,
    sample: number | null,
  ): number | null => {
    if (sample === null) return cur;
    return cur === null ? sample : Math.max(cur, sample);
  };

  const onMessage = (e: MessageEvent<Res | Prog>) => {
    const msg = e.data;
    const job = pending.get(msg.id);
    if (!job) return;

    if ("progress" in msg) {
      job.peakHeap = bumpHeap(job.peakHeap, msg.heapMb);
      lastPeakHeap = job.peakHeap;
      job.onProgress?.(msg.progress[0], msg.progress[1], msg.progress[2]);
      return;
    }

    pending.delete(msg.id);
    job.slot.busy--;
    if (msg.ok) {
      job.peakHeap = bumpHeap(job.peakHeap, msg.heapMb);
      lastPeakHeap = job.peakHeap;
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("yh:timing", {
            detail: { label: job.method, ms: msg.ms },
          }),
        );
      }
      job.resolve(msg.result);
    } else {
      const err = Object.assign(new Error(msg.error.message), {
        name: msg.error.name,
        ...(msg.error.chars ? { chars: msg.error.chars } : {}),
      });
      job.reject(err);
    }
  };

  // A crashed worker (e.g. mobile OOM kill) is replaced so later calls do not hang. Only its own jobs fail.
  const onError = (slot: Slot, e: ErrorEvent) => {
    const err = new Error(e.message || "Worker error");
    for (const [id, job] of pending) {
      if (job.slot !== slot) continue;
      pending.delete(id);
      job.reject(err);
    }
    slot.w.terminate();
    slot.busy = 0;
    slot.w = start(slot);
  };

  function start(slot: Slot): Worker {
    const w = new Worker(new URL("./pdf.worker.ts", import.meta.url), {
      type: "module",
    });
    w.onmessage = onMessage;
    w.onerror = (e) => onError(slot, e);
    return w;
  }
  function spawn(): Slot {
    const slot = { busy: 0 } as Slot;
    slot.w = start(slot);
    slots.push(slot);
    return slot;
  }
  spawn();

  /** Pooled jobs take an idle worker, start a new one while under the cap, else queue on the least busy. */
  function pick(method: keyof PdfApi): Slot {
    if (!POOLED.has(method)) return slots[0]!;
    const idle = slots.find((s) => s.busy === 0);
    if (idle) return idle;
    if (slots.length < MAX) return spawn();
    return slots.reduce((a, b) => (b.busy < a.busy ? b : a));
  }

  function call<T>(method: keyof PdfApi, ...rawArgs: unknown[]): Promise<T> {
    const id = nextId++;
    let onProgress: Progress | undefined;
    const args = [...rawArgs];
    if (typeof args[args.length - 1] === "function") {
      onProgress = args.pop() as Progress;
    } else if (args[args.length - 1] === undefined) {
      args.pop();
    }

    const transfer = new Set<ArrayBuffer>();
    collectBuffers(args, transfer);

    const slot = pick(method);
    slot.busy++;
    return new Promise<T>((resolve, reject) => {
      pending.set(id, {
        method,
        slot,
        resolve: resolve as (val: unknown) => void,
        reject,
        onProgress,
        peakHeap: null,
      });
      slot.w.postMessage({ id, method, args }, [...transfer]);
    });
  }

  return {
    lastHeapMb: () => lastPeakHeap,
    concurrency: MAX,
    inspect: (input: Uint8Array | Blob) => call<InspectResult>("inspect", input),
    merge: (inputs: InputFile[], pages: PageRef[], onProgress?: Progress) =>
      call<Uint8Array>("merge", inputs, pages, onProgress),
    unlockFile: (file: Blob, password?: string) =>
      call<{ ok: true; file: Blob } | Exclude<UnlockResult, { ok: true }>>("unlockFile", file, password),
    encryptFile: (file: Blob, password: string, algorithm?: CryptAlgorithm) =>
      call<Blob>("encryptFile", file, password, algorithm),
    mergeFiles: (inputs: Array<{ id: string; file: Blob }>, pages: PageRef[], onProgress?: Progress) =>
      call<Blob>("mergeFiles", inputs, pages, onProgress),
    split: (bytes: Uint8Array, groups: number[][], onProgress?: Progress) =>
      call<Uint8Array[]>("split", bytes, groups, onProgress),
    burst: (bytes: Uint8Array, onProgress?: Progress) =>
      call<Uint8Array>("burst", bytes, onProgress),
    applyEdits: (bytes: Uint8Array, edits: Edit[], rotateAll?: Rot) =>
      call<Uint8Array>("applyEdits", bytes, edits, rotateAll),
    compress: (
      bytes: Uint8Array,
      maxBytes: number,
      allowRaster: boolean,
      onProgress?: Progress,
    ) =>
      call<CompressResult>(
        "compress",
        bytes,
        maxBytes,
        allowRaster,
        onProgress,
      ),
    generate: (spec: GenSpec) => call<Uint8Array>("generate", spec),
    replaceText: (bytes: Uint8Array, reps: TextReplacement[]) =>
      call<Uint8Array>("replaceText", bytes, reps),
    unlock: (bytes: Uint8Array, password?: string) =>
      call<UnlockResult>("unlock", bytes, password),
    encrypt: (
      bytes: Uint8Array,
      password: string,
      algorithm?: CryptAlgorithm,
    ) => call<Uint8Array>("encrypt", bytes, password, algorithm),
    formFields: (bytes: Uint8Array) => call<FormField[]>("formFields", bytes),
    fillForm: (bytes: Uint8Array, values: FieldValues) =>
      call<Uint8Array>("fillForm", bytes, values),
    reshape: (bytes: Uint8Array, pages: PageSpec[]) =>
      call<Uint8Array>("reshape", bytes, pages),
    convert: (bytes: Uint8Array, opts: ConvertOpts, onProgress?: Progress) =>
      call<ConvertResult>("convert", bytes, opts, onProgress),
  };
}
