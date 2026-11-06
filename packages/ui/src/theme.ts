/** Deckhand's look: warm paper neutrals, one marine accent, tight corners, hairline separation. */
import { createDarkTheme, createLightTheme, type BrandVariants, type Theme } from '@fluentui/react-components';

const hsl = (h: number, s: number, l: number): string => {
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
  const f = (n: number): string => {
    const k = (n + h / 30) % 12;
    const c = l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(255 * c).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
};
const L = [6, 10, 14, 18, 22, 26, 30, 33, 38, 43, 50, 58, 68, 80, 90, 96];
const brand = Object.fromEntries(L.map((l, i) => [(i + 1) * 10, hsl(190, 78, l)])) as unknown as BrandVariants;

const shape = { borderRadiusSmall: '3px', borderRadiusMedium: '4px', borderRadiusLarge: '6px', borderRadiusXLarge: '8px' };

export const lightTheme: Theme = {
  ...createLightTheme(brand), ...shape,
  colorNeutralBackground1: '#fbfaf8', colorNeutralBackground2: '#f4f2ee', colorNeutralBackground3: '#f0eee9',
  colorNeutralForeground1: '#1d2124', colorNeutralForeground2: '#3b4147', colorNeutralForeground3: '#5a6068',
  colorNeutralStroke1: '#cfcac1', colorNeutralStroke2: '#dcd8d0', colorNeutralStroke3: '#e6e2db',
  colorSubtleBackgroundHover: '#ebe8e1', colorSubtleBackgroundPressed: '#e1ded6',
};

export const darkTheme: Theme = {
  ...createDarkTheme(brand), ...shape,
  colorNeutralBackground1: '#181b1e', colorNeutralBackground2: '#121416', colorNeutralBackground3: '#0e1011',
  colorNeutralForeground1: '#e4e6e3', colorNeutralForeground2: '#c3c8c9', colorNeutralForeground3: '#a2a9ae',
  colorNeutralStroke1: '#3a4146', colorNeutralStroke2: '#2c3236', colorNeutralStroke3: '#242a2e',
  colorSubtleBackgroundHover: '#242a2e', colorSubtleBackgroundPressed: '#2c3338',
};
