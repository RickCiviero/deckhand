/** Offset-based text patches (ARCH-02). Offsets always refer to the text *before* the patch is applied. */

export interface Patch {
  start: number;
  end: number;
  text: string;
}

export function applyPatches(source: string, patches: readonly Patch[]): string {
  const sorted = [...patches].sort((a, b) => a.start - b.start || a.end - b.end);
  let out = '';
  let cursor = 0;
  for (const p of sorted) {
    if (p.start < cursor) throw new Error('Overlapping patches');
    if (p.start < 0 || p.end < p.start || p.end > source.length) throw new RangeError('Patch out of range');
    out += source.slice(cursor, p.start) + p.text;
    cursor = p.end;
  }
  return out + source.slice(cursor);
}

/** Inverse patches (to be applied to the *result* of applyPatches). */
export function invertPatches(source: string, patches: readonly Patch[]): Patch[] {
  const sorted = [...patches].sort((a, b) => a.start - b.start || a.end - b.end);
  let shift = 0;
  const inv: Patch[] = [];
  for (const p of sorted) {
    const start = p.start + shift;
    inv.push({ start, end: start + p.text.length, text: source.slice(p.start, p.end) });
    shift += p.text.length - (p.end - p.start);
  }
  return inv;
}
