/** Update check (PLT-06, "Notify only"): asks GitHub which release is newest and tells the user. Nothing is downloaded or run by the app; the user opens the release page and installs by hand. */
import { app } from 'electron';
import { isNewer, parseVersion } from '@deckhand/core';
import { z } from 'zod';

const API = 'https://api.github.com/repos/RickCiviero/deckhand/releases?per_page=5';
const release = z.object({ tag_name: z.string().max(64), html_url: z.string().url().max(500), draft: z.boolean(), prerelease: z.boolean() });

export async function checkForUpdate(): Promise<{ version: string; url: string } | null> {
  const override = process.env['DECKHAND_UPDATE_URL']; // tests only: a local server standing in for GitHub
  const url = override ?? API;
  if (!override && !url.startsWith('https://')) return null;
  try {
    const res = await fetch(url, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': `Deckhand/${app.getVersion()}` }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const text = await res.text();
    if (text.length > 500_000) return null;
    const list = z.array(release.passthrough()).parse(JSON.parse(text));
    const newest = list.filter((r) => !r.draft && parseVersion(r.tag_name)).sort((x, y) => (isNewer(x.tag_name, y.tag_name) ? -1 : 1))[0];
    if (!newest || !isNewer(newest.tag_name, app.getVersion())) return null;
    // the page the user lands on must be on github.com, whatever the response says
    const page = new URL(newest.html_url);
    if (!override && (page.protocol !== 'https:' || page.hostname !== 'github.com')) return null;
    return { version: newest.tag_name.replace(/^v/, ''), url: page.toString() };
  } catch { return null; }
}
