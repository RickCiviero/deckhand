/** Encoding / BOM / line-ending detection and lossless byte round-trip (FMT-02, RT-01). */

export type Eol = 'lf' | 'crlf' | 'mixed' | 'none';

export interface DecodedFile {
  text: string;
  encoding: 'utf-8' | 'windows-1252';
  bom: boolean;
  eol: Eol;
}

const WIN1252_HIGH: Record<number, number> = {
  0x80: 0x20ac, 0x82: 0x201a, 0x83: 0x0192, 0x84: 0x201e, 0x85: 0x2026, 0x86: 0x2020, 0x87: 0x2021,
  0x88: 0x02c6, 0x89: 0x2030, 0x8a: 0x0160, 0x8b: 0x2039, 0x8c: 0x0152, 0x8e: 0x017d, 0x91: 0x2018,
  0x92: 0x2019, 0x93: 0x201c, 0x94: 0x201d, 0x95: 0x2022, 0x96: 0x2013, 0x97: 0x2014, 0x98: 0x02dc,
  0x99: 0x2122, 0x9a: 0x0161, 0x9b: 0x203a, 0x9c: 0x0153, 0x9e: 0x017e, 0x9f: 0x0178,
};
const WIN1252_REVERSE = new Map<number, number>();
for (const [b, cp] of Object.entries(WIN1252_HIGH)) WIN1252_REVERSE.set(cp, Number(b));

export function detectEol(text: string): Eol {
  let crlf = 0;
  let lf = 0;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) {
      if (i > 0 && text.charCodeAt(i - 1) === 13) crlf++;
      else lf++;
    }
  }
  if (crlf === 0 && lf === 0) return 'none';
  if (crlf > 0 && lf > 0) return 'mixed';
  return crlf > 0 ? 'crlf' : 'lf';
}

function isValidUtf8(bytes: Uint8Array): boolean {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

function sniffMetaCharset(bytes: Uint8Array): string | null {
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, Math.min(bytes.length, 4096)));
  const m = /<meta[^>]+charset\s*=\s*["']?\s*([\w-]+)/i.exec(head);
  return m && m[1] ? m[1].toLowerCase() : null;
}

export function decodeFile(bytes: Uint8Array): DecodedFile {
  let bom = false;
  let body = bytes;
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    bom = true;
    body = bytes.subarray(3);
  }
  const declared = sniffMetaCharset(body);
  const wantsLatin = declared === 'windows-1252' || declared === 'iso-8859-1' || declared === 'latin1' || declared === 'cp1252';
  let encoding: DecodedFile['encoding'] = 'utf-8';
  if (!bom && (wantsLatin || !isValidUtf8(body))) encoding = 'windows-1252';
  let text: string;
  if (encoding === 'utf-8') {
    text = new TextDecoder('utf-8').decode(body);
  } else {
    const out: string[] = [];
    for (let i = 0; i < body.length; i++) {
      const b = body[i]!;
      out.push(String.fromCharCode(b >= 0x80 && b <= 0x9f ? (WIN1252_HIGH[b] ?? b) : b));
    }
    text = out.join('');
  }
  return { text, encoding, bom, eol: detectEol(text) };
}

export function encodeFile(text: string, meta: Pick<DecodedFile, 'encoding' | 'bom'>): Uint8Array {
  if (meta.encoding === 'utf-8') {
    const body = new TextEncoder().encode(text);
    if (!meta.bom) return body;
    const out = new Uint8Array(body.length + 3);
    out.set([0xef, 0xbb, 0xbf]);
    out.set(body, 3);
    return out;
  }
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    const cp = text.charCodeAt(i);
    if (cp < 0x80 || (cp >= 0xa0 && cp <= 0xff)) out[i] = cp;
    else out[i] = WIN1252_REVERSE.get(cp) ?? 0x3f; // '?' for unrepresentable characters
  }
  return out;
}

/** True when `text` can be written in the encoding without losing characters. */
export function isRepresentable(text: string, encoding: DecodedFile['encoding']): boolean {
  if (encoding === 'utf-8') return true;
  for (let i = 0; i < text.length; i++) {
    const cp = text.charCodeAt(i);
    if (cp < 0x80 || (cp >= 0xa0 && cp <= 0xff)) continue;
    if (!WIN1252_REVERSE.has(cp)) return false;
  }
  return true;
}
