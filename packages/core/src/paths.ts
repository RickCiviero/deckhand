/** Pure path-containment logic for the document protocol (SEC-03). Callers still realpath() on disk. */

/** Decode a URL pathname into a safe relative POSIX path, or null if it must be refused. */
export function sanitizeRequestPath(pathname: string): string | null {
  if (pathname.length > 2048) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
    // double-encoding (%252e) is never legitimate
    if (/%[0-9a-f]{2}/i.test(decoded)) return null;
  } catch {
    return null;
  }
  if (decoded.includes('\0') || decoded.includes('\\')) return null;
  if (/^\/*[a-zA-Z]:/.test(decoded) || decoded.startsWith('//')) return null; // drive letters, UNC
  const parts = decoded.split('/').filter((p) => p !== '' && p !== '.');
  for (const p of parts) {
    if (p === '..') return null;
    if (/^[a-zA-Z]:$/.test(p)) return null;
    if (/[<>:"|?*\x00-\x1f]/.test(p)) return null; // Windows-illegal, also blocks ADS "file::$DATA"
    if (/[. ]$/.test(p)) return null; // Windows trims trailing dots/spaces
    if (/^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i.test(p)) return null; // reserved device names
  }
  return parts.join('/');
}

/** True when `candidate` (already realpath'ed) is `root` or inside it. */
export function isInside(root: string, candidate: string, sep: string, caseInsensitive: boolean): boolean {
  const norm = (s: string) => (caseInsensitive ? s.toLowerCase() : s);
  const r = norm(root).replace(new RegExp(`${sep.replace(/\\/g, '\\\\')}+$`), '');
  const c = norm(candidate);
  return c === r || c.startsWith(r + sep);
}

/** References in the source that point outside the deck's folder (`../x`, absolute paths, file: URLs) — shown as a notice (SEC-03). */
export function findOutsideRefs(html: string): string[] {
  const found = new Set<string>();
  const re = /\b(?:src|href|poster|data-src|data-background-image)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))|url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]+))\s*\)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const v = (m[1] ?? m[2] ?? m[3] ?? m[4] ?? m[5] ?? '').trim();
    if (!v || v.startsWith('data:') || v.startsWith('#')) continue;
    if (/^(https?:|\/\/|mailto:|blob:|javascript:)/i.test(v)) continue;
    const traversal = /(^|[\\/])\.\.([\\/]|$)/.test(v); // `../x` anywhere in the path, either slash style
    const absolute = /^(file:|\/|[a-zA-Z]:[\\/]|\\\\)/.test(v); // file: URLs, /abs, C:\abs, \\server
    if (traversal || absolute) found.add(v.slice(0, 80));
  }
  return [...found];
}
