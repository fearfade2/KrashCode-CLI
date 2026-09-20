import React, { createContext, useContext, useMemo, useState } from 'react';
import { useStdout } from 'ink';
import { colorLevel } from './colors.js';
import type { ThemeId, MotionMode } from '../core/types.js';

export interface Palette {
  accent: string | undefined;
  accentDim: string;
  secondary: string | undefined;
  user: string | undefined;
  ok: string;
  warn: string;
  error: string;
  text: string | undefined;
  dim: string;
  border: string;
  surface: string;
  ink: string;
  background: string;
}

const ember: Palette = {
  accent: '#FFB86B', accentDim: '#A77446', secondary: '#7DD3FC', user: '#7DD3FC',
  ok: '#86EFAC', warn: '#FCD34D', error: '#FDA4AF', text: '#E2E8F0',
  dim: '#94A3B8', border: '#475569', surface: '#1E293B', ink: '#0F172A', background: '#0F172A',
};
export const THEMES: Record<ThemeId, { name: string; description: string; palette: Palette }> = {
  system: { name: 'System', description: 'Нейтральная · родные цвета терминала', palette: {
    ...ember, accent: undefined, secondary: undefined, user: undefined, text: undefined,
    dim: '#808080', border: '#666666',
  } },
  ember: { name: 'Ember', description: 'Тёплый янтарь и холодный голубой', palette: ember },
  ocean: { name: 'Ocean', description: 'Глубокий синий и бирюзовый', palette: {
    ...ember, accent: '#67E8F9', accentDim: '#0E7490', secondary: '#93C5FD', user: '#93C5FD',
    border: '#335B77', surface: '#16354A', background: '#0B1B2B', ink: '#0B1B2B',
  } },
  forest: { name: 'Forest', description: 'Хвойный зелёный и мягкое золото', palette: {
    ...ember, accent: '#A3E635', accentDim: '#4D7C0F', secondary: '#FDE68A', user: '#BBF7D0',
    text: '#ECFCCB', dim: '#A3B59A', border: '#456343', surface: '#243C29', background: '#102018', ink: '#102018',
  } },
  violet: { name: 'Violet', description: 'Лаванда, сиреневый и розовый', palette: {
    ...ember, accent: '#C4B5FD', accentDim: '#7C3AED', secondary: '#F9A8D4', user: '#DDD6FE',
    dim: '#AAA2BE', border: '#5D4D7A', surface: '#302344', background: '#191329', ink: '#191329',
  } },
  paper: { name: 'Paper', description: 'Светлая тема с тёмным текстом', palette: {
    accent: '#9A3412', accentDim: '#C2410C', secondary: '#075985', user: '#075985', ok: '#166534',
    warn: '#854D0E', error: '#9F1239', text: '#1E293B', dim: '#475569', border: '#94A3B8',
    surface: '#E2E8F0', ink: '#F8FAFC', background: '#F8FAFC',
  } },
  mono: { name: 'Mono', description: 'Без цветовых акцентов', palette: {
    accent: '#F5F5F5', accentDim: '#A3A3A3', secondary: '#D4D4D4', user: '#E5E5E5',
    ok: '#E5E5E5', warn: '#D4D4D4', error: '#FFFFFF', text: '#E5E5E5', dim: '#A3A3A3',
    border: '#525252', surface: '#303030', ink: '#171717', background: '#171717',
  } },
};

interface Appearance {
  theme: ThemeId;
  motion: MotionMode;
  setTheme: (theme: ThemeId) => void;
  setMotion: (motion: MotionMode) => void;
}
const AppearanceContext = createContext<Appearance>({ theme: 'system', motion: 'full', setTheme() {}, setMotion() {} });
export function AppearanceProvider({ children, initialTheme = 'system', initialMotion = 'full' }: {
  children?: React.ReactNode; initialTheme?: ThemeId; initialMotion?: MotionMode;
}) {
  const [theme, setTheme] = useState<ThemeId>(initialTheme);
  const [motion, setMotion] = useState<MotionMode>(initialMotion);
  const value = useMemo(() => ({ theme, motion, setTheme, setMotion }), [theme, motion]);
  return React.createElement(AppearanceContext.Provider, { value }, children);
}
export const useAppearance = () => useContext(AppearanceContext);
// Never force a page background or white body text: Ink's scrollback renderer is
// not a fullscreen compositor. Native foreground/background work on light and dark terminals.
export function terminalPalette(theme: ThemeId, level: number): Palette {
  const palette = THEMES[theme].palette;
  const accent = { system: undefined, ember: 'yellow', ocean: 'cyan', forest: 'green',
    violet: 'magenta', paper: 'blue', mono: undefined }[theme];
  if (theme === 'mono') return { ...palette, accent: undefined, secondary: undefined, user: undefined,
    text: undefined, dim: 'gray', border: 'gray', ok: 'gray', warn: 'gray', error: 'gray' };
  if (level <= 1) return { ...palette, accent, secondary: accent, user: accent,
    text: undefined, dim: 'gray', border: 'gray', ok: 'green', warn: 'yellow', error: 'red' };
  return { ...palette, text: undefined,
    dim: level === 2 ? 'ansi256(244)' : '#808080',
    border: level === 2 ? 'ansi256(242)' : '#666666',
  };
}
export function useTheme(): Palette {
  const { theme } = useAppearance();
  const { stdout } = useStdout();
  return terminalPalette(theme, colorLevel(stdout));
}
// Default export retained for non-react consumers; components use reactive useTheme().
export const T = ember;
export const MOTION_LABELS: Record<MotionMode, string> = {
  full: 'Полные — индикаторы и потоковый курсор',
  reduced: 'Спокойные — только индикатор работы',
  off: 'Выключены — статичный интерфейс',
};
export const G = { bar: '▌', caret: '›', prompt: '›', run: '·', ok: '✓', err: '×', sep: '·', dot: '●' } as const;

// Original KrashCode lettering, inspired by OpenCode's compact lowercase block
// typography. Foreground-only glyphs deliberately avoid per-cell background shadows.
const LETTERS: Record<string, string[]> = {
  k: ['█   ', '█ ▄▀', '█▀▄ ', '▀  ▀'],
  r: ['    ', '█▀▀▄', '█   ', '▀   '],
  a: ['    ', '▄▀▀█', '█  █', '▀▀▀▀'],
  s: ['    ', '█▀▀▀', '▀▀▀█', '▀▀▀▀'],
  h: ['█   ', '█▀▀▄', '█  █', '▀  ▀'],
  c: ['    ', '█▀▀▀', '█   ', '▀▀▀▀'],
  o: ['    ', '█▀▀█', '█  █', '▀▀▀▀'],
  d: ['   █', '▄▀▀█', '█  █', '▀▀▀▀'],
  e: ['    ', '█▀▀█', '█▀▀▀', '▀▀▀▀'],
};
const word = (text: string) => Array.from({ length: 4 }, (_, row) =>
  [...text].map((letter) => LETTERS[letter]![row]).join(' '));
export const BRAND_LEFT = word('krash');
export const BRAND_RIGHT = word('code');
export const WORDMARK = BRAND_LEFT.map((line, row) => `${line}  ${BRAND_RIGHT[row]}`).join('\n');
// Original user-provided emblem, unchanged from the root logo asset.
export const EMBLEM = "⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢀⣠⣴⣶⡶⠿⠿⢶⣶⣦⣄⡀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀\n⠀⠀⠀⠀⠀⠀⠀⠀⣠⣾⠟⠋⠁⠀⠀⠀⠀⠀⠀⠈⠙⠻⣷⣄⠀⠀⠀⠀⠀⠀⠀⠀\n⠀⠀⠀⠀⠀⠀⢠⣾⠟⠁⢨⣷⣄⠀⠀⠀⠀⠀⠀⠀⠀⠀⠈⠻⣷⡄⠀⠀⠀⠀⠀⠀\n⠀⠀⠀⠀⠀⢰⣿⠃⠀⠀⢸⣿⣿⣷⡆⠀⠀⠀⠀⣀⣠⡴⠂⠀⠹⣿⡄⠀⠀⠀⠀⠀\n⠀⠀⠀⠀⠀⣿⠇⠀⠀⠀⢸⣿⣿⣿⢇⣤⣶⣾⡿⠟⠁⠀⠀⠀⠀⢹⣷⠀⠀⠀⠀⠀\n⠀⠀⠀⠀⢸⣿⠀⠀⠀⠀⠸⣿⢟⣵⣿⣿⠟⠋⠀⢀⣴⣦⡄⠀⠀⠀⠀⠀⠀⠀⠀⠀\n⠀⠀⠀⠀⢸⣿⠀⠀⠀⠀⢨⣷⡘⢿⣿⣦⣄⠀⠀⠈⠻⠿⠃⠀⠀⠀⠀⠀⠀⠀⠀⠀\n⠀⠀⠀⠀⠀⣿⣇⠀⠀⠀⢸⣿⣿⣮⡻⣿⣿⣷⣄⠀⠀⠀⠀⠀⠀⣼⡟⠀⠀⠀⠀⠀\n⠀⠀⠀⠀⠀⠘⣿⣆⠀⠀⢸⣿⣿⣿⠇⠘⢿⣿⣿⣷⣦⡀⠀⠀⣼⡿⠁⠀⠀⠀⠀⠀\n⠀⠀⠀⠀⠀⠀⠈⢻⣷⣄⠨⠟⠋⠀⠀⠀⠀⠹⡿⠿⠛⠋⣠⣾⠟⠁⠀⠀⠀⠀⠀⠀\n⠀⠀⠀⠀⠀⠀⠀⠀⠉⠻⣷⣦⣄⣀⡀⠀⠀⣀⣀⣤⣴⡿⠟⠁⠀⠀⠀⠀⠀⠀⠀⠀\n⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠉⠙⠛⠻⠿⠿⠛⠛⠋⠉⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀";

// Crop blank padding only, never resample or redraw the user's emblem.
const emblemLines = EMBLEM.split('\n');
const emblemLeft = Math.min(...emblemLines.map((line) => line.length - line.replace(/^[⠀ ]+/, '').length));
const emblemRight = Math.max(...emblemLines.map((line) => line.replace(/[⠀ ]+$/, '').length));
export const EMBLEM_DISPLAY = emblemLines.map((line) => line.slice(emblemLeft, emblemRight).padEnd(emblemRight - emblemLeft, '⠀'));
