/** Ready-made page sections for web pages (website mode). Inline styles only, so they work on any page and need no stylesheet edit. */
import type { Command } from './commands.js';

export interface SectionKind { id: string; name: string; html: string }

const WRAP = 'padding: 64px 24px; max-width: 1100px; margin: 0 auto;';
const BTN = 'display: inline-block; padding: 12px 24px; border-radius: 6px; background: #1f2937; color: #fff; text-decoration: none;';

export const SECTION_KINDS: SectionKind[] = [
  {
    id: 'hero', name: 'Hero',
    html: `<section style="padding: 96px 24px; text-align: center;">\n  <h1 style="font-size: 48px; margin: 0 0 16px;">Headline that says what you do</h1>\n  <p style="font-size: 20px; margin: 0 0 32px;">One sentence that explains who it is for.</p>\n  <a href="#" style="${BTN}">Get started</a>\n</section>`,
  },
  {
    id: 'features', name: 'Three features',
    html: `<section style="${WRAP}">\n  <h2 style="text-align: center; margin: 0 0 40px;">Why choose us</h2>\n  <div style="display: flex; flex-wrap: wrap; gap: 24px;">\n    <div style="flex: 1 1 240px;"><h3>First point</h3><p>Describe the benefit in a sentence.</p></div>\n    <div style="flex: 1 1 240px;"><h3>Second point</h3><p>Describe the benefit in a sentence.</p></div>\n    <div style="flex: 1 1 240px;"><h3>Third point</h3><p>Describe the benefit in a sentence.</p></div>\n  </div>\n</section>`,
  },
  {
    id: 'text-image', name: 'Text and picture',
    html: `<section style="${WRAP}">\n  <div style="display: flex; flex-wrap: wrap; gap: 40px; align-items: center;">\n    <div style="flex: 1 1 320px;"><h2 style="margin: 0 0 16px;">A heading</h2><p>Explain the topic here.</p></div>\n    <div style="flex: 1 1 320px;"><img alt="Describe the picture" src="data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%27600%27 height=%27400%27%3E%3Crect width=%27600%27 height=%27400%27 fill=%27%23d9d9d9%27/%3E%3C/svg%3E" style="width: 100%; height: auto; border-radius: 8px;"></div>\n  </div>\n</section>`,
  },
  {
    id: 'cta', name: 'Call to action',
    html: `<section style="padding: 64px 24px; text-align: center; background: #1f2937; color: #fff;">\n  <h2 style="margin: 0 0 16px;">Ready to start?</h2>\n  <p style="margin: 0 0 24px;">Say what happens next.</p>\n  <a href="#" style="display: inline-block; padding: 12px 24px; border-radius: 6px; background: #fff; color: #1f2937; text-decoration: none;">Contact us</a>\n</section>`,
  },
  {
    id: 'footer', name: 'Footer',
    html: `<footer style="padding: 32px 24px; text-align: center; font-size: 14px;">\n  <p style="margin: 0;">&copy; Your name. All rights reserved.</p>\n</footer>`,
  },
];

/** Insert a section after the block `afterId` (null = before the first block `referenceId`). */
export function newSectionCommand(kindId: string, afterId: number | null, referenceId: number): Command {
  const kind = SECTION_KINDS.find((k) => k.id === kindId);
  return {
    label: 'New section',
    build(doc) {
      const anchor = doc.byId(afterId ?? referenceId);
      if (!kind || !anchor) return [];
      const lineStart = doc.text.lastIndexOf('\n', anchor.start - 1) + 1;
      const lead = doc.text.slice(lineStart, anchor.start);
      const indent = /^[ \t]*/.exec(lead)![0];
      const eol = doc.meta.eol === 'crlf' ? '\r\n' : '\n';
      const body = kind.html.split('\n').map((l, i) => (i === 0 ? l : indent + l)).join(eol);
      const own = lead.trim() === '';
      if (afterId === null) return [{ start: anchor.start, end: anchor.start, text: own ? `${body}${eol}${indent}` : body }];
      return [{ start: anchor.end, end: anchor.end, text: own ? `${eol}${indent}${body}` : body }];
    },
  };
}
