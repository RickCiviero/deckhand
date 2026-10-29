import i18next from 'i18next';
import en from './en.json';

void i18next.init({ lng: 'en', fallbackLng: 'en', resources: { en: { translation: en } }, interpolation: { escapeValue: false }, initAsync: false });

/** All UI strings go through here (I18N-01). Adding a language = adding a JSON file and a resource entry. */
export const t = (key: string, opts?: Record<string, unknown>): string => i18next.t(key, opts) as string;
