import { contextBridge, ipcRenderer, webUtils } from 'electron';

export interface AppSettings { scripts: boolean; remote: 'allow' | 'block' | 'ask'; aiEnabled: boolean; aiAllowExternal: boolean; aiMaxToolCalls: number; aiAskBefore: boolean; /** settings an administrator policy file fixes */ locked?: string[] }
export interface AiConnection { id: string; name: string; kind: 'anthropic' | 'openai' | 'compatible'; baseUrl: string; model: string; hasKey: boolean }

/** Minimal typed bridge. Every call is re-validated in the main process; nothing here exposes Node or ipcRenderer. */
const api = {
  openDialog: () => ipcRenderer.invoke('app:open-dialog'),
  settings: {
    get: () => ipcRenderer.invoke('settings:get') as Promise<AppSettings>,
    set: (patch: Partial<AppSettings>) => ipcRenderer.invoke('settings:set', patch) as Promise<AppSettings>,
  },
  recent: () => ipcRenderer.invoke('app:recent') as Promise<string[]>,
  openPath: (file: string) => ipcRenderer.invoke('app:open-path', file),
  pathForFile: (f: File): string => webUtils.getPathForFile(f),
  setText: (docId: string, text: string) => ipcRenderer.invoke('doc:set-text', { docId, text }),
  save: (docId: string, bytes: Uint8Array) => ipcRenderer.invoke('doc:save', { docId, bytes }),
  saveAs: (docId: string, bytes: Uint8Array) => ipcRenderer.invoke('doc:save-as', { docId, bytes }),
  setDirty: (dirty: boolean) => ipcRenderer.invoke('doc:dirty', dirty),
  setPolicy: (docId: string, remote: 'allow' | 'block') => ipcRenderer.invoke('doc:policy', { docId, remote }),
  autoRecover: (docId: string, bytes: Uint8Array) => ipcRenderer.invoke('doc:autorecover', { docId, bytes }),
  readDisk: (docId: string) => ipcRenderer.invoke('doc:read-disk', { docId }),
  closeConfirmed: () => ipcRenderer.invoke('doc:close-confirmed'),
  recoveryList: () => ipcRenderer.invoke('recovery:list'),
  recoveryRead: (key: string) => ipcRenderer.invoke('recovery:read', key),
  recoveryDiscard: (key: string) => ipcRenderer.invoke('recovery:discard', key),
  pickImage: (docId: string) => ipcRenderer.invoke('doc:pick-image', { docId }) as Promise<{ src: string; w: number; h: number } | null>,
  thumbs: (docId: string, text: string, indices: number[]) => ipcRenderer.invoke('doc:thumbs', { docId, text, indices }) as Promise<Record<number, string>>,
  previewInBrowser: (docId: string) => ipcRenderer.invoke('show:preview', { docId }),
  startShow: (docId: string, slide: number) => ipcRenderer.invoke('show:start', { docId, slide }),
  exportPdf: (docId: string, slides: number) => ipcRenderer.invoke('doc:export-pdf', { docId, slides }) as Promise<string | null>,
  openExternal: (url: string) => ipcRenderer.invoke('app:open-external', url),
  ai: {
    list: () => ipcRenderer.invoke('ai:list') as Promise<{ list: AiConnection[]; secure: boolean }>,
    save: (c: object) => ipcRenderer.invoke('ai:save', c) as Promise<AiConnection[]>,
    remove: (id: string) => ipcRenderer.invoke('ai:remove', id) as Promise<AiConnection[]>,
    stream: (req: object) => ipcRenderer.invoke('ai:stream', req) as Promise<string>,
    cancel: (id: string) => ipcRenderer.invoke('ai:cancel', id),
    test: (id: string) => ipcRenderer.invoke('ai:test', id) as Promise<{ ok: boolean; error?: string }>,
  },
  on: (channel: 'open-request' | 'doc-event' | 'cmd' | 'ai-chunk', fn: (payload: unknown) => void) => {
    const h = (_e: unknown, p: unknown) => fn(p);
    ipcRenderer.on(channel, h);
    return () => { ipcRenderer.removeListener(channel, h); };
  },
};
contextBridge.exposeInMainWorld('deckhand', api);
export type DeckhandApi = typeof api;
