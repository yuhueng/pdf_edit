import { get, set } from 'idb-keyval';

const KEY = 'yh.signatures';

export type VaultItem = {
  id: string;
  name: string;
  kind: 'signature' | 'initials';
  png: Blob;
  created: number;
};

type StoredVaultItem = Omit<VaultItem, 'png'> & {
  pngBytes?: Uint8Array;
  png?: Blob;
};

async function readRaw(): Promise<StoredVaultItem[]> {
  const items = await get<StoredVaultItem[]>(KEY);
  return Array.isArray(items) ? items : [];
}

function toPublicItem(raw: StoredVaultItem): VaultItem {
  const png = raw.pngBytes
    ? new Blob([raw.pngBytes as Uint8Array<ArrayBuffer>], { type: 'image/png' })
    : raw.png ?? new Blob([], { type: 'image/png' });
  return { id: raw.id, name: raw.name, kind: raw.kind, png, created: raw.created };
}

export const listVault = async (): Promise<VaultItem[]> => {
  try {
    const items = await readRaw();
    return items.map(toPublicItem);
  } catch {
    throw new Error('Signature vault unavailable');
  }
};

export const saveVault = async (item: VaultItem): Promise<void> => {
  try {
    const items = await readRaw();
    const pngBytes = new Uint8Array(await item.png.arrayBuffer());
    const stored: StoredVaultItem = {
      id: item.id,
      name: item.name,
      kind: item.kind,
      pngBytes,
      created: item.created,
    };
    const idx = items.findIndex((x) => x.id === item.id);
    const next = idx >= 0 ? items.map((x, i) => (i === idx ? stored : x)) : [stored, ...items];
    await set(KEY, next);
  } catch {
    throw new Error('Signature vault unavailable');
  }
};

export const removeVault = async (id: string): Promise<void> => {
  try {
    const items = await readRaw();
    await set(
      KEY,
      items.filter((x) => x.id !== id),
    );
  } catch {
    throw new Error('Signature vault unavailable');
  }
};
