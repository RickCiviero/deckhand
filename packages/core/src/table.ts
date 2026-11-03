/** Table editing: add and delete rows and columns as exact insertions and deletions of tags; the cells keep their own markup (attributes, inline styles). */
import { patchCommand, type Command } from './commands.js';
import type { Patch } from './patch.js';
import type { ElementInfo, SourceDoc } from './source.js';

export interface TableCtx { table: ElementInfo; rows: ElementInfo[]; cells: ElementInfo[][]; row: number; col: number }

const isCell = (e: ElementInfo): boolean => e.tag === 'td' || e.tag === 'th';

/** The table, its rows and cells, and the position of the cell that holds (or is) the element. */
export function tableContext(doc: SourceDoc, id: number): TableCtx | null {
  let cell: ElementInfo | undefined = doc.byId(id);
  while (cell && !isCell(cell)) cell = cell.parent === null ? undefined : doc.byId(cell.parent);
  if (!cell) return null;
  const tr = cell.parent === null ? undefined : doc.byId(cell.parent);
  if (!tr || tr.tag !== 'tr') return null;
  let table: ElementInfo | undefined = tr;
  while (table && table.tag !== 'table') table = table.parent === null ? undefined : doc.byId(table.parent);
  if (!table) return null;
  const rows: ElementInfo[] = [];
  const walk = (e: ElementInfo): void => {
    for (const c of e.children) {
      const k = doc.byId(c)!;
      if (k.tag === 'tr') rows.push(k);
      else if (k.tag === 'thead' || k.tag === 'tbody' || k.tag === 'tfoot') walk(k);
    }
  };
  walk(table);
  const cells = rows.map((r) => r.children.map((c) => doc.byId(c)!).filter(isCell));
  const row = rows.indexOf(tr);
  const col = cells[row]?.indexOf(cell) ?? -1;
  return row < 0 || col < 0 ? null : { table, rows, cells, row, col };
}

const startTag = (doc: SourceDoc, e: ElementInfo): string => doc.text.slice(e.start, e.startTagEnd);
const blank = (doc: SourceDoc, e: ElementInfo): string => `${startTag(doc, e)}${e.tag === 'th' ? 'Header' : 'Text'}</${e.tag}>`;

export function addRowCommand(id: number, after: boolean): Command {
  return patchCommand(after ? 'Insert row below' : 'Insert row above', (doc): Patch[] => {
    const t = tableContext(doc, id);
    if (!t) return [];
    const tr = t.rows[t.row]!;
    const cells = t.cells[t.row]!.map((c) => {
      // a header row is not copied as headers: the new row holds data
      const open = startTag(doc, c);
      return c.tag === 'th' ? `${open.replace(/^<th/i, '<td')}Text</td>` : `${open}Text</td>`;
    });
    const at = after ? tr.end : tr.start;
    return [{ start: at, end: at, text: `${startTag(doc, tr)}${cells.join('')}</tr>` }];
  });
}

export function deleteRowCommand(id: number): Command {
  return patchCommand('Delete row', (doc): Patch[] => {
    const t = tableContext(doc, id);
    if (!t || t.rows.length < 2) return [];
    const tr = t.rows[t.row]!;
    return [{ start: tr.start, end: tr.end, text: '' }];
  });
}

export function addColumnCommand(id: number, after: boolean): Command {
  return patchCommand(after ? 'Insert column right' : 'Insert column left', (doc): Patch[] => {
    const t = tableContext(doc, id);
    if (!t) return [];
    const out: Patch[] = [];
    t.cells.forEach((row) => {
      const ref = row[Math.min(t.col, row.length - 1)];
      if (!ref) return;
      const at = after ? ref.end : ref.start;
      out.push({ start: at, end: at, text: blank(doc, ref) });
    });
    return out;
  });
}

export function deleteColumnCommand(id: number): Command {
  return patchCommand('Delete column', (doc): Patch[] => {
    const t = tableContext(doc, id);
    if (!t || (t.cells[t.row]?.length ?? 0) < 2) return [];
    return t.cells.flatMap((row) => { const c = row[t.col]; return c ? [{ start: c.start, end: c.end, text: '' } as Patch] : []; });
  });
}
