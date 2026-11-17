export function parseRanges(
  text: string,
  pageCount: number,
): { ok: true; indices: number[] } | { ok: false; message: string } {
  const trimmed = text.trim();
  if (!trimmed) {
    return { ok: false, message: 'Range is empty' };
  }
  const tokens = trimmed.split(',');
  const indices: number[] = [];
  const seen = new Set<number>();

  for (const raw of tokens) {
    const token = raw.replace(/\s+/g, '');
    if (!token) {
      return { ok: false, message: `Invalid empty token in "${text}"` };
    }
    const dash = token.indexOf('-');
    if (dash === -1) {
      if (!/^\d+$/.test(token)) {
        return { ok: false, message: `Invalid page "${token}"` };
      }
      const n = Number(token);
      if (n < 1 || n > pageCount) {
        return { ok: false, message: `Page "${token}" out of range (1-${pageCount})` };
      }
      const idx = n - 1;
      if (seen.has(idx)) {
        return { ok: false, message: `Duplicate page "${token}"` };
      }
      seen.add(idx);
      indices.push(idx);
    } else {
      const aStr = token.slice(0, dash);
      const bStr = token.slice(dash + 1);
      if (!/^\d+$/.test(aStr) || !/^\d+$/.test(bStr)) {
        return { ok: false, message: `Invalid range "${token}"` };
      }
      const a = Number(aStr);
      const b = Number(bStr);
      if (a < 1 || b > pageCount || a > b) {
        return { ok: false, message: `Invalid range "${token}" (valid: 1-${pageCount})` };
      }
      for (let n = a; n <= b; n++) {
        const idx = n - 1;
        if (seen.has(idx)) {
          return { ok: false, message: `Duplicate page "${n}" in "${token}"` };
        }
        seen.add(idx);
        indices.push(idx);
      }
    }
  }
  return { ok: true, indices };
}

export function parseGroups(
  text: string,
  pageCount: number,
): { ok: true; groups: number[][] } | { ok: false; message: string } {
  const segments = text
    .split(/[;\r\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (segments.length === 0) {
    return { ok: false, message: 'No page groups provided' };
  }
  const groups: number[][] = [];
  for (const seg of segments) {
    const res = parseRanges(seg, pageCount);
    if (!res.ok) return res;
    groups.push(res.indices);
  }
  return { ok: true, groups };
}
