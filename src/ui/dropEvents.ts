import { useEffect, useRef } from 'react';
import { toast } from './Toasts.tsx';

/** Events the shell sends to the tool that is showing. */
export const DROP_EVENT = 'yh:dropfiles';
export type DropDetail = { tab: string; files: File[] };

/** Splits a drop or file-picker result into PDFs and everything else, and says so for what was left out. */
export function pdfsOnly(files: File[] | FileList): File[] {
  const ok: File[] = [];
  for (const f of Array.from(files)) {
    if (f.type === 'application/pdf' || /\.pdf$/i.test(f.name)) ok.push(f);
    else toast(`${f.name} isn't a PDF and wasn't added.`, 'info');
  }
  return ok;
}

/** Lets a tool receive files dropped anywhere on the window while it is the visible tool. */
export function useDropFiles(tab: string, onFiles: (files: File[]) => void): void {
  const ref = useRef(onFiles);
  useEffect(() => {
    ref.current = onFiles;
  });
  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<DropDetail>).detail;
      if (d.tab === tab) ref.current(d.files);
    };
    window.addEventListener(DROP_EVENT, on);
    return () => window.removeEventListener(DROP_EVENT, on);
  }, [tab]);
}
