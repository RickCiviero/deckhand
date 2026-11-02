/** Position-preserving editing of inline `style` attribute text (RT-03, ARCH-06). */

interface Decl {
  start: number; // offset of property name in the style text
  end: number; // offset after value (before `;`)
  prop: string;
  valueStart: number;
}

const PROP_RE = /^(--[\w-]+|-?[a-z][a-z0-9-]*)$/i;

/** Values are written into HTML attributes/CSS; reject anything that could break out of a declaration. */
export function isSafeCssValue(v: string): boolean {
  if (v.length === 0 || v.length > 4096) return false;
  if (/[<>{}\\]|\/\*|\*\/|@import|expression\s*\(|javascript:/i.test(v)) return false;
  let depth = 0;
  let quote: string | null = null;
  for (const ch of v) {
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (ch === ';' && depth === 0) return false;
    if (depth < 0) return false;
  }
  return depth === 0 && quote === null;
}

export function isSafeCssProp(p: string): boolean {
  return PROP_RE.test(p);
}

function scan(style: string): Decl[] {
  const out: Decl[] = [];
  let i = 0;
  while (i < style.length) {
    while (i < style.length && /[\s;]/.test(style[i]!)) i++;
    if (i >= style.length) break;
    const start = i;
    let depth = 0;
    let quote: string | null = null;
    let colon = -1;
    while (i < style.length) {
      const ch = style[i]!;
      if (quote) {
        if (ch === quote) quote = null;
      } else if (ch === '"' || ch === "'") quote = ch;
      else if (ch === '(') depth++;
      else if (ch === ')') depth--;
      else if (ch === ':' && colon < 0 && depth === 0) colon = i;
      else if (ch === ';' && depth === 0) break;
      i++;
    }
    if (colon < 0) continue;
    let end = i;
    while (end > colon && /\s/.test(style[end - 1]!)) end--;
    out.push({ start, end, prop: style.slice(start, colon).trim().toLowerCase(), valueStart: colon + 1 });
  }
  return out;
}

export function getStyleProp(style: string, prop: string): string | undefined {
  const d = scan(style).find((x) => x.prop === prop.toLowerCase());
  return d ? style.slice(d.valueStart, d.end).trim() : undefined;
}

/** Set (or add) one declaration. Everything else in `style` is left byte-identical. */
export function setStyleProp(style: string, prop: string, value: string): string {
  if (!isSafeCssProp(prop) || !isSafeCssValue(value)) throw new Error(`Unsafe CSS declaration: ${prop}`);
  const p = prop.toLowerCase();
  const d = scan(style).find((x) => x.prop === p);
  if (d) {
    const lead = /^\s*/.exec(style.slice(d.valueStart, d.end))![0];
    return style.slice(0, d.valueStart) + lead + value + style.slice(d.end);
  }
  if (style.trim() === '') return `${p}: ${value};`;
  const trimmedEnd = style.replace(/\s+$/, '');
  const trailing = style.slice(trimmedEnd.length);
  const sep = trimmedEnd.endsWith(';') ? ' ' : '; ';
  const closing = trimmedEnd.endsWith(';') ? ';' : ';';
  return `${trimmedEnd}${sep}${p}: ${value}${closing}${trailing}`;
}

export function removeStyleProp(style: string, prop: string): string {
  const d = scan(style).find((x) => x.prop === prop.toLowerCase());
  if (!d) return style;
  let end = d.end;
  while (end < style.length && /\s/.test(style[end]!)) end++;
  if (style[end] === ';') end++;
  while (end < style.length && style[end] === ' ') end++;
  // the last declaration leaves no dangling separator space behind
  const head = end >= style.length ? style.slice(0, d.start).replace(/ +$/, '') : style.slice(0, d.start);
  return head + style.slice(end);
}

/** The declarations of an inline style as [property, value] pairs, in order. */
export function styleDeclarations(style: string): [string, string][] {
  return scan(style).map((d) => [d.prop, style.slice(d.valueStart, d.end).trim()]);
}

/** Visual properties Format Painter copies (STY-04): never size or position. */
export const PAINTABLE = /^(color|background(-[a-z]+)?|border(-[a-z-]+)?|box-shadow|text-shadow|opacity|font(-[a-z]+)?|text-(align|decoration[a-z-]*|transform)|letter-spacing|line-height|filter|outline(-[a-z]+)?)$/;
