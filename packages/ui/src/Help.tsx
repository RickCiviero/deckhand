import type { JSX } from 'react';
import { useState } from 'react';
import { Button } from '@fluentui/react-components';

const MOD = navigator.platform.includes('Mac') ? '⌘' : 'Ctrl';
const KEYS: [string, string][] = [
  ['Click · Double-click', 'Select an object · edit its text'],
  ['Drag · Shift+drag', 'Move · move along one axis'],
  [`${MOD}+Z · ${MOD}+Y`, 'Undo · Redo (every change, exactly)'],
  [`${MOD}+S`, 'Save (only what you changed is written)'],
  [`${MOD}+F`, 'Find and replace across slides'],
  [`${MOD}+D`, 'Duplicate the slide'],
  [`${MOD}+G · ${MOD}+Shift+G`, 'Group · Ungroup'],
  ['Arrows · Shift+arrows', 'Nudge by 1 px · by 10 px'],
  ['PageUp · PageDown', 'Previous · next slide'],
  ['F5 · Shift+F5', 'Slide show from the start · from this slide'],
  ['Alt+F10', 'Selection tab'],
  ['F1', 'This help'],
];

/** Help (File > Help, F1): the ideas Deckhand is built on and the keys that matter. */
export function Help(): JSX.Element {
  return (
    <>
      <h2>Help</h2>
      <h3>How Deckhand works</h3>
      <ul className="helplist" data-testid="help">
        <li><b>Your file stays your file.</b> Deckhand edits the HTML text itself. Saving without changes leaves every byte as it was, and a change rewrites only what it touches.</li>
        <li><b>Slides and steps.</b> A slide is one screen of the deck. Objects that appear one after another (build steps) are previewed in the Steps bar of the Selection tab; change the number next to an object to change when it appears.</li>
        <li><b>Animations built by scripts.</b> The Frames tab runs the deck's own timers one step at a time. Text it shows can be edited where the script writes it.</li>
        <li><b>Protected View.</b> Files that came from the internet open with scripts off and no editing until you choose Enable Editing.</li>
        <li><b>Version History.</b> Each save keeps the file as it was; File &gt; Version History restores any of the last 30.</li>
        <li><b>Source.</b> View &gt; Code or Split shows the real HTML; edits there and on the slide stay in sync.</li>
      </ul>
      <h3>Keys</h3>
      <dl className="info keys">
        {KEYS.map(([k, v]) => (<><dt key={k}>{k}</dt><dd key={v}>{v}</dd></>))}
      </dl>
      <p className="hint">Questions and bug reports: github.com/RickCiviero/deckhand/issues</p>
    </>
  );
}

const STEPS = [
  { title: 'Open a presentation', text: 'Drop an .html file here or choose Open. Deckhand finds the slides and shows them as thumbnails on the left.' },
  { title: 'Click, drag, type', text: 'Click an object to select it, drag to move it, double-click text to edit it. Format it from the ribbon or the Format tab; every change can be undone.' },
  { title: 'Animations and steps', text: 'The Selection tab previews build steps; the Frames tab steps through animations that scripts build over time. Press F1 any time for help.' },
];

/** First start only: three short cards on the welcome screen. */
export function Onboarding({ onDone }: { onDone: () => void }): JSX.Element {
  const [i, setI] = useState(0);
  const st = STEPS[i]!;
  return (
    <section className="tour" data-testid="onboarding" aria-label="Getting started">
      <small className="hint">Getting started · {i + 1} of {STEPS.length}</small>
      <h3>{st.title}</h3>
      <p>{st.text}</p>
      <div className="row">
        {i < STEPS.length - 1 ? <Button size="small" appearance="primary" onClick={() => setI(i + 1)} data-testid="tour-next">Next</Button> : <Button size="small" appearance="primary" onClick={onDone} data-testid="tour-done">Done</Button>}
        <Button size="small" appearance="subtle" onClick={onDone} data-testid="tour-skip">Skip</Button>
      </div>
    </section>
  );
}
