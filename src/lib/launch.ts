/**
 * Opening a PDF from outside the app, once it is installed:
 * - "Open with" (File Handling API: desktop Chrome and Edge) starts the app at /?open=edit and hands the file to launchQueue.
 * - "Share" (Web Share Target: Android Chrome) posts the file to /share-target; the service worker
 *   (public/share-target-sw.js) keeps it in Cache Storage and redirects to /?shared=1.
 * Either way the app opens on the Edit tab with that file.
 */
export const SHARE_CACHE = 'yh-share';
export const SHARE_KEY = '/shared-file';

const params = new URLSearchParams(window.location.search);
/** True when the app was started to open a file: the landing page is skipped and Edit opens. */
export const LAUNCHED_WITH_FILE = params.get('open') === 'edit' || params.has('shared');
const SHARED = params.has('shared');

// Clean the address (no ?open / ?shared on reload) and land on the Edit tab.
if (LAUNCHED_WITH_FILE) window.history.replaceState(null, '', `${window.location.pathname}#/edit`);

type LaunchParams = { files: ReadonlyArray<{ kind: string; getFile?: () => Promise<File> }> };
type LaunchQueue = { setConsumer: (cb: (p: LaunchParams) => void) => void };

const isPdf = (f: File) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name);

/** Calls `open` with the first PDF the app was launched or shared with, if any. */
export function onLaunchFile(open: (f: File) => void): void {
  const queue = (window as Window & { launchQueue?: LaunchQueue }).launchQueue;
  queue?.setConsumer(async (p) => {
    for (const h of p.files) {
      if (h.kind !== 'file' || !h.getFile) continue;
      const f = await h.getFile();
      if (isPdf(f)) return open(f);
    }
  });
  if (SHARED && 'caches' in window) void takeShared().then((f) => f && open(f));
}

async function takeShared(): Promise<File | null> {
  try {
    const cache = await caches.open(SHARE_CACHE);
    const res = await cache.match(SHARE_KEY);
    if (!res) return null;
    const blob = await res.blob();
    const name = decodeURIComponent(res.headers.get('x-file-name') ?? 'shared.pdf');
    await caches.delete(SHARE_CACHE);
    const f = new File([blob], name, { type: 'application/pdf' });
    return isPdf(f) ? f : null;
  } catch {
    return null;
  }
}
