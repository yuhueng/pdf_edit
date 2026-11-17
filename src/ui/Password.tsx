import { useEffect, useRef, useState } from 'react';
import { fmtSize, MAX_FILE_BYTES } from '../lib/format.ts';
import type { PdfApi } from '../lib/pdf/types.ts';
import { Button, TextField } from './kit.tsx';
import { toast } from './Toasts.tsx';

type Ask = { name: string; retry: boolean; resolve: (pw: string | null) => void };
const EVENT = 'yh:askpw';

/** Asks for a PDF password. Resolves with the typed password, or null if the user skips. Never stored. */
export function askPassword(name: string, retry = false): Promise<string | null> {
  return new Promise((resolve) => {
    window.dispatchEvent(new CustomEvent<Ask>(EVENT, { detail: { name, retry, resolve } }));
  });
}

/** Mounted once in App. Requests queue so several protected files ask one after another. */
export function PasswordDialog() {
  const dlg = useRef<HTMLDialogElement | null>(null);
  const queue = useRef<Ask[]>([]);
  const [cur, setCur] = useState<Ask | null>(null);
  const [pw, setPw] = useState('');
  const [empty, setEmpty] = useState(false);

  useEffect(() => {
    const onAsk = (e: Event) => {
      queue.current.push((e as CustomEvent<Ask>).detail);
      setCur((c) => c ?? queue.current.shift() ?? null);
    };
    window.addEventListener(EVENT, onAsk);
    return () => window.removeEventListener(EVENT, onAsk);
  }, []);

  useEffect(() => {
    const d = dlg.current;
    if (!d) return;
    if (cur && !d.open) d.showModal();
    if (!cur && d.open) d.close();
  }, [cur]);

  const finish = (value: string | null) => {
    cur?.resolve(value);
    setPw(''); // the password is dropped from state as soon as it is used
    setCur(queue.current.shift() ?? null);
  };

  return (
    <dialog
      ref={dlg}
      aria-label="Password required"
      onCancel={(e) => {
        e.preventDefault();
        finish(null);
      }}
      className="yh-dialog"
    >
      {cur && (
        <form
          className="p-6 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (pw) finish(pw);
            else setEmpty(true);
          }}
        >
          <h2 className="text-xl leading-7 font-semibold">Password required</h2>
          <p className="text-sm text-text-muted break-words">
            <span className="font-medium text-text">{cur.name}</span> is password-protected. The password is used once
            to unlock a copy in memory and is not saved.
          </p>
          <TextField
            type="password"
            label="PDF password"
            autoComplete="off"
            autoFocus
            value={pw}
            onChange={(e) => {
              setPw(e.target.value);
              setEmpty(false);
            }}
            error={cur.retry ? "That password didn't work." : empty ? 'Enter the password to continue.' : null}
          />
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="ghost" onClick={() => finish(null)}>
              Skip
            </Button>
            <Button type="submit" variant="primary" className="px-5">
              Unlock
            </Button>
          </div>
        </form>
      )}
    </dialog>
  );
}

/**
 * Inspects a file and, if it is encrypted, unlocks an in-memory copy (empty password first, then asks).
 * Returns the file to use from now on, or null when it exceeds `maxBytes`, was skipped, or is unusable (already toasted).
 */
export async function prepareFile(
  api: PdfApi,
  file: File,
  maxBytes = MAX_FILE_BYTES,
): Promise<{ file: File; pageCount: number; wasEncrypted: boolean } | null> {
  if (file.size > maxBytes) {
    toast(`${file.name} is ${fmtSize(file.size)}. The largest PDF the browser can work on is ${fmtSize(maxBytes)}.`, 'error');
    return null;
  }
  // The File itself goes to the worker (no copy); large files are checked there by reading slices.
  let res: Awaited<ReturnType<PdfApi['inspect']>>;
  try {
    res = await api.inspect(file);
  } catch {
    toast(`${file.name}: this device does not have enough free memory to open a ${fmtSize(file.size)} file.`, 'error');
    return null;
  }
  if (res.ok) return { file, pageCount: res.pageCount, wasEncrypted: false };
  if (res.reason !== 'encrypted') {
    toast(`${file.name}: ${res.message}`, 'error');
    return null;
  }
  let pw = '';
  let retry = false;
  for (;;) {
    // The worker reads the file and hands back a Blob: the page never holds the file's bytes.
    let r: Awaited<ReturnType<PdfApi['unlockFile']>>;
    try {
      r = await api.unlockFile(file, pw);
    } catch {
      toast(`${file.name}: this device does not have enough free memory to unlock a ${fmtSize(file.size)} file.`, 'error');
      return null;
    }
    if (r.ok) {
      const unlocked = new File([r.file], file.name, { type: 'application/pdf' });
      const again = await api.inspect(unlocked);
      if (!again.ok) {
        toast(`${file.name}: ${again.message}`, 'error');
        return null;
      }
      return { file: unlocked, pageCount: again.pageCount, wasEncrypted: true };
    }
    if (r.reason === 'corrupt') {
      toast(`${file.name}: ${r.message}`, 'error');
      return null;
    }
    const next = await askPassword(file.name, retry);
    if (next === null) {
      toast(`${file.name}: skipped, a password is needed`, 'info');
      return null;
    }
    pw = next;
    retry = true;
  }
}
