export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  // While a modal <dialog> is open the rest of the page is inert and ignores clicks, so the link goes inside it.
  let host: Element = document.body;
  for (const d of document.querySelectorAll('dialog[open]')) {
    try {
      if (d.matches(':modal')) host = d;
    } catch {
      // :modal unsupported: keep body
    }
  }
  host.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function canShareFile(blob: Blob, filename: string): boolean {
  if (typeof navigator === 'undefined' || !navigator.canShare || !navigator.share) {
    return false;
  }
  try {
    const file = new File([blob], filename, { type: blob.type || 'application/octet-stream' });
    return navigator.canShare({ files: [file] });
  } catch {
    return false;
  }
}

export async function shareFile(blob: Blob, filename: string): Promise<void> {
  const file = new File([blob], filename, { type: blob.type || 'application/octet-stream' });
  await navigator.share({ files: [file], title: filename });
}

/**
 * Saves several files as one ZIP (stored, not recompressed), or one by one when together they are too
 * large for the single buffer a ZIP is built in. Returns how they were saved.
 */
export async function saveZipOrFiles(
  files: Array<{ name: string; data: Blob }>,
  zipName: string,
  maxZipBytes: number,
): Promise<'zip' | 'files'> {
  const total = files.reduce((n, f) => n + f.data.size, 0);
  if (total <= maxZipBytes) {
    const { zipSync } = await import('fflate');
    const entries: Record<string, Uint8Array> = {};
    for (const f of files) entries[f.name] = new Uint8Array(await f.data.arrayBuffer());
    saveBlob(new Blob([zipSync(entries, { level: 0 }) as Uint8Array<ArrayBuffer>], { type: 'application/zip' }), zipName);
    return 'zip';
  }
  for (const f of files) {
    saveBlob(f.data, f.name);
    await new Promise((r) => setTimeout(r, 400)); // browsers drop downloads started in the same instant
  }
  return 'files';
}
