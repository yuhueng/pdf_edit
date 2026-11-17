import { Canvas, PencilBrush } from 'fabric';
import { useEffect, useRef, useState } from 'react';
import { blobToDataUrl, removeWhiteBackground, trimToBlob, typedSignatureBlob } from '../../lib/image.ts';
import { listVault, removeVault, saveVault, type VaultItem } from '../../lib/vault.ts';
import { Button, IconButton } from '../kit.tsx';
import { toast } from '../Toasts.tsx';

type SignatureDialogProps = {
  open: boolean;
  onClose: () => void;
  onInsert: (dataUrl: string) => void;
};

type SigTab = 'draw' | 'type' | 'upload';

const CURSIVE_FONTS = ['Dancing Script', 'Great Vibes', 'Caveat'] as const;

function dataUrlToBlob(dataUrl: string): Blob {
  const [header, b64] = dataUrl.split(',');
  const mime = /data:([^;]+)/.exec(header ?? '')?.[1] ?? 'image/png';
  const bin = atob(b64 ?? '');
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

export function SignatureDialog({ open, onClose, onInsert }: SignatureDialogProps) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const drawHostRef = useRef<HTMLDivElement | null>(null);
  const drawCanvasRef = useRef<Canvas | null>(null);

  const [tab, setTab] = useState<SigTab>('draw');
  const [typedText, setTypedText] = useState('Jane Doe');
  const [typedFont, setTypedFont] = useState<string>(CURSIVE_FONTS[0]);
  const [typedColor, setTypedColor] = useState('#111827');
  const [uploadedBlob, setUploadedBlob] = useState<Blob | null>(null);
  const [uploadedUrl, setUploadedUrl] = useState<string | null>(null);

  const [vaultName, setVaultName] = useState('My signature');
  const [vaultKind, setVaultKind] = useState<'signature' | 'initials'>('signature');
  const [vault, setVault] = useState<VaultItem[]>([]);
  const [vaultThumbs, setVaultThumbs] = useState<Record<string, string>>({});

  const refreshVault = async () => {
    try {
      const items = await listVault();
      setVault(items);
      const thumbs: Record<string, string> = {};
      for (const item of items) {
        thumbs[item.id] = await blobToDataUrl(item.png);
      }
      setVaultThumbs(thumbs);
    } catch {
      toast('Signature vault unavailable', 'error');
    }
  };

  useEffect(() => {
    const dlg = dialogRef.current;
    if (!dlg) return;
    let alive = true;
    if (open) {
      if (!dlg.open) dlg.showModal();
      void listVault()
        .then(async (items) => {
          const thumbs: Record<string, string> = {};
          for (const item of items) {
            thumbs[item.id] = await blobToDataUrl(item.png);
          }
          if (!alive) return;
          setVault(items);
          setVaultThumbs(thumbs);
        })
        .catch(() => {
          if (alive) toast('Signature vault unavailable', 'error');
        });
    } else if (dlg.open) {
      dlg.close();
    }
    return () => {
      alive = false;
    };
  }, [open]);

  useEffect(() => {
    if (!open || tab !== 'draw') return;
    const host = drawHostRef.current;
    if (!host) return;
    host.innerHTML = '';
    const el = document.createElement('canvas');
    el.width = 420;
    el.height = 150;
    host.appendChild(el);

    const fc = new Canvas(el, { isDrawingMode: true, backgroundColor: 'transparent' });
    const brush = new PencilBrush(fc);
    brush.width = 2.5;
    brush.color = '#111827';
    fc.freeDrawingBrush = brush;
    drawCanvasRef.current = fc;

    return () => {
      drawCanvasRef.current = null;
      void fc.dispose().catch(() => {});
      host.innerHTML = '';
    };
  }, [open, tab]);

  const currentSignatureBlob = async (): Promise<Blob | null> => {
    if (tab === 'draw') {
      const fc = drawCanvasRef.current;
      if (!fc || fc.getObjects().length === 0) return null;
      const objs = fc.getObjects();
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const o of objs) {
        const b = o.getBoundingRect();
        minX = Math.min(minX, b.left);
        minY = Math.min(minY, b.top);
        maxX = Math.max(maxX, b.left + b.width);
        maxY = Math.max(maxY, b.top + b.height);
      }
      const pad = 4;
      const left = Math.max(0, minX - pad);
      const top = Math.max(0, minY - pad);
      const width = Math.max(1, maxX - minX + pad * 2);
      const height = Math.max(1, maxY - minY + pad * 2);
      const url = fc.toDataURL({ format: 'png', left, top, width, height, multiplier: 2 });
      return dataUrlToBlob(url);
    }
    if (tab === 'type') {
      if (!typedText.trim()) return null;
      return typedSignatureBlob(typedText.trim(), typedFont, typedColor);
    }
    return uploadedBlob;
  };

  const handleUpload = async (file: File) => {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 1200 / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close();
    const imgData = ctx.getImageData(0, 0, w, h);
    removeWhiteBackground(imgData.data);
    ctx.putImageData(imgData, 0, 0);
    const blob = await trimToBlob(c);
    setUploadedBlob(blob);
    setUploadedUrl(await blobToDataUrl(blob));
  };

  const handleInsertCurrent = async () => {
    const blob = await currentSignatureBlob();
    if (!blob) {
      toast('Draw, type, or upload a signature first', 'error');
      return;
    }
    onInsert(await blobToDataUrl(blob));
    onClose();
  };

  const handleSaveVault = async () => {
    const blob = await currentSignatureBlob();
    if (!blob) {
      toast('Draw, type, or upload a signature first', 'error');
      return;
    }
    try {
      await saveVault({
        id: `sig-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        name: vaultName.trim() || 'Signature',
        kind: vaultKind,
        png: blob,
        created: Date.now(),
      });
      await refreshVault();
      toast('Saved to signature vault', 'success');
    } catch {
      toast('Signature vault unavailable', 'error');
    }
  };

  const handleRename = async (item: VaultItem) => {
    const nextName = window.prompt('Rename signature:', item.name);
    if (!nextName || !nextName.trim()) return;
    try {
      await saveVault({ ...item, name: nextName.trim() });
      await refreshVault();
    } catch {
      toast('Signature vault unavailable', 'error');
    }
  };

  const handleDeleteVault = async (id: string) => {
    try {
      await removeVault(id);
      await refreshVault();
    } catch {
      toast('Signature vault unavailable', 'error');
    }
  };

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      aria-label="Signature dialog"
      className="yh-dialog yh-dialog-form"
    >
      <div className="p-4 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">Insert Signature</h2>
          <IconButton icon="close" label="Close signature dialog" onClick={onClose} />
        </div>

        <div className="flex gap-2 border-b pb-2">
          {(['draw', 'type', 'upload'] as const).map((t) => (
            <Button key={t} variant={tab === t ? 'primary' : 'secondary'} aria-pressed={tab === t} onClick={() => setTab(t)} className="capitalize">{t}</Button>
          ))}
        </div>

        {tab === 'draw' && (
          <div className="space-y-2">
            <div ref={drawHostRef} className="border rounded bg-white overflow-hidden" />
            <Button onClick={() => drawCanvasRef.current?.clear()}>Clear</Button>
          </div>
        )}

        {tab === 'type' && (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <input
                type="text"
                aria-label="Typed signature"
                value={typedText}
                onChange={(e) => setTypedText(e.target.value)}
                className="border border-line rounded px-2 py-2 text-sm flex-1 min-w-[160px]"
              />
              <select
                aria-label="Signature font"
                value={typedFont}
                onChange={(e) => setTypedFont(e.target.value)}
                className="border border-line rounded px-2 py-2 text-sm"
              >
                {CURSIVE_FONTS.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
              <input
                type="color"
                aria-label="Signature color"
                value={typedColor}
                onChange={(e) => setTypedColor(e.target.value)}
                className="w-9 h-9 p-0 border rounded"
              />
            </div>
            <div
              className="border rounded p-4 text-center text-4xl min-h-[84px] flex items-center justify-center bg-gray-50"
              style={{ fontFamily: `"${typedFont}", cursive`, color: typedColor }}
            >
              {typedText || 'Signature'}
            </div>
          </div>
        )}

        {tab === 'upload' && (
          <div className="space-y-2">
            <input
              type="file"
              accept="image/png,image/jpeg"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleUpload(f);
              }}
              className="text-sm"
            />
            {uploadedUrl && (
              <div className="border rounded p-2 bg-gray-50 flex justify-center">
                <img src={uploadedUrl} alt="Uploaded signature" className="max-h-24 object-contain" />
              </div>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 pt-1 border-t">
          <input
            type="text"
            aria-label="Vault item name"
            value={vaultName}
            onChange={(e) => setVaultName(e.target.value)}
            className="border border-line rounded px-2 py-2 text-xs flex-1 min-w-[120px]"
          />
          <select
            aria-label="Vault item kind"
            value={vaultKind}
            onChange={(e) => setVaultKind(e.target.value as 'signature' | 'initials')}
            className="border border-line rounded px-2 py-2 text-xs"
          >
            <option value="signature">Signature</option>
            <option value="initials">Initials</option>
          </select>
          <Button onClick={() => void handleSaveVault()}>Save to vault</Button>
          <Button variant="primary" onClick={() => void handleInsertCurrent()} className="ml-auto px-4">Insert</Button>
        </div>

        {vault.length > 0 && (
          <div className="border-t pt-3 space-y-2">
            <div className="text-xs font-semibold text-gray-600 uppercase">Saved Vault</div>
            <div className="space-y-1.5 max-h-40 overflow-y-auto">
              {vault.map((item) => (
                <div key={item.id} className="border rounded p-2 flex flex-wrap items-center gap-2 text-xs">
                  {vaultThumbs[item.id] && (
                    <img
                      src={vaultThumbs[item.id]}
                      alt={item.name}
                      className="h-8 w-20 object-contain bg-gray-50 rounded"
                    />
                  )}
                  <div className="flex-1 min-w-24">
                    <div className="font-medium truncate">{item.name}</div>
                    <div className="text-gray-500">{item.kind}</div>
                  </div>
                  <div className="flex gap-1.5 max-sm:w-full max-sm:justify-end">
                  <Button
                    variant="primary"
                    onClick={() => {
                      const url = vaultThumbs[item.id];
                      if (url) {
                        onInsert(url);
                        onClose();
                      }
                    }}
                  >
                    Insert
                  </Button>
                  <Button onClick={() => void handleRename(item)}>Rename</Button>
                  <Button variant="danger" aria-label={`Delete ${item.name}`} onClick={() => void handleDeleteVault(item.id)}>Delete</Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </dialog>
  );
}
