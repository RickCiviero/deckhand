/** Deckhand's look: quiet neutrals, one soft indigo accent, rounded corners, low contrast between surfaces. */
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
const L = [8, 12, 17, 22, 28, 34, 40, 47, 53, 58, 64, 70, 78, 86, 93, 97];
const brand = Object.fromEntries(L.map((l, i) => [(i + 1) * 10, hsl(233, 52, l)])) as unknown as BrandVariants;

const shape = { borderRadiusSmall: '6px', borderRadiusMedium: '8px', borderRadiusLarge: '12px', borderRadiusXLarge: '16px' };

export const lightTheme: Theme = {
  ...createLightTheme(brand), ...shape,
  colorNeutralBackground1: '#ffffff', colorNeutralBackground2: '#f6f7fa', colorNeutralBackground3: '#eff1f6',
  colorNeutralForeground1: '#2b3240', colorNeutralForeground2: '#4a5365', colorNeutralForeground3: '#5d6678',
  colorNeutralStroke1: '#dde1e9', colorNeutralStroke2: '#e7eaf0', colorNeutralStroke3: '#eef0f5',
  colorSubtleBackgroundHover: '#eef0fa', colorSubtleBackgroundPressed: '#e3e6f6',
};

export const darkTheme: Theme = {
  ...createDarkTheme(brand), ...shape,
  colorNeutralBackground1: '#1f232b', colorNeutralBackground2: '#1a1d24', colorNeutralBackground3: '#15181e',
  colorNeutralForeground1: '#dde1ea', colorNeutralForeground2: '#b7bdca', colorNeutralForeground3: '#a0a8ba',
  colorNeutralStroke1: '#323846', colorNeutralStroke2: '#2a303c', colorNeutralStroke3: '#252a35',
  colorSubtleBackgroundHover: '#2a2f3d', colorSubtleBackgroundPressed: '#323849',
};
