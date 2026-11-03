/** Spelling while editing text: the operating system's checker on Windows and macOS. Linux would have to download dictionaries from the internet, so it stays off there. */
import { Menu, session, type WebContents } from 'electron';

export const spellSupported = process.platform !== 'linux';

export function applySpellCheck(on: boolean): void {
  session.defaultSession.setSpellCheckerEnabled(on && spellSupported);
}

/** Right-click on a misspelled word in editable text: suggestions and "Add to dictionary". */
export function attachSpellMenu(wc: WebContents): void {
  wc.on('context-menu', (_e, params) => {
    if (!params.isEditable || !params.misspelledWord) return;
    const items = params.dictionarySuggestions.slice(0, 5).map((label) => ({ label, click: () => wc.replaceMisspelling(label) }));
    if (!items.length) items.push({ label: 'No suggestions', click: () => undefined });
    Menu.buildFromTemplate([
      ...items,
      { type: 'separator' as const },
      { label: 'Add to dictionary', click: () => wc.session.addWordToSpellCheckerDictionary(params.misspelledWord) },
    ]).popup();
  });
}
