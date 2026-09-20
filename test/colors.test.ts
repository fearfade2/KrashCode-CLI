import React from 'react';
import { EventEmitter } from 'node:events';
import chalk from 'chalk';
import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Box, renderToString } from 'ink';
import { colorLevel, configureTerminalColors } from '../src/ui/colors.js';
import { AppearanceProvider, terminalPalette } from '../src/ui/theme.js';
import { THEME_IDS } from '../src/core/types.js';
import { WelcomePanel } from '../src/components/Logo.js';
import { PromptInput } from '../src/components/PromptInput.js';
import { Picker } from '../src/components/Picker.js';
import { Markdown } from '../src/ui/markdown.js';

const context = vi.hoisted(() => ({ stdout: null as unknown as NodeJS.WriteStream }));
vi.mock('ink', async (original) => ({
  ...await original<typeof import('ink')>(),
  useStdout: () => ({ stdout: context.stdout, write() {} }),
}));
const h = React.createElement;
const originalLevel = chalk.level;
beforeEach(() => {
  for (const key of ['NO_COLOR', 'FORCE_COLOR', 'COLORTERM', 'KRASHCODE_COLOR']) vi.stubEnv(key, undefined);
  vi.stubEnv('TERM', 'xterm');
  context.stdout = Object.assign(new EventEmitter(), { isTTY: true, columns: 100, rows: 32 }) as NodeJS.WriteStream;
});
afterEach(() => { chalk.level = originalLevel; vi.unstubAllEnvs(); });

describe('terminal color capability policy', () => {
  it('shares the exact Chalk package used by Ink', () => {
    const require = createRequire(import.meta.url);
    const inkRequire = createRequire(require.resolve('ink'));
    expect(inkRequire.resolve('chalk')).toBe(require.resolve('chalk'));
  });

  it.each([
    [{}, 1], [{ TERM: 'xterm-256color' }, 2], [{ COLORTERM: 'truecolor' }, 3],
    [{ COLORTERM: '24bit' }, 3], [{ FORCE_COLOR: '0' }, 0], [{ FORCE_COLOR: '1' }, 1],
    [{ FORCE_COLOR: '2' }, 2], [{ FORCE_COLOR: '3' }, 3],
    [{ KRASHCODE_COLOR: 'ansi', COLORTERM: 'truecolor' }, 1],
    [{ KRASHCODE_COLOR: '256' }, 2], [{ KRASHCODE_COLOR: 'truecolor' }, 3],
    [{ KRASHCODE_COLOR: 'off' }, 0], [{ TERM: 'dumb', FORCE_COLOR: '3' }, 0],
    [{ NO_COLOR: '', FORCE_COLOR: '3' }, 0],
  ])('resolves %o to level %i', (env, expected) => {
    expect(colorLevel({ isTTY: true }, env as NodeJS.ProcessEnv)).toBe(expected);
  });

  it.each([[1, 0], [4, 1], [8, 2], [24, 3]])('uses reported depth %i', (depth, expected) => {
    expect(colorLevel({ isTTY: true, getColorDepth: () => depth }, {})).toBe(expected);
  });

  it('keeps redirected output plain despite forced RGB', () => {
    expect(colorLevel({ isTTY: false }, { FORCE_COLOR: '3', KRASHCODE_COLOR: 'truecolor' })).toBe(0);
  });

  it('falls back safely if terminal capability detection throws', () => {
    expect(colorLevel({ isTTY: true, getColorDepth() { throw new Error('unsupported'); } }, {})).toBe(1);
  });

  it('uses the native foreground on light and dark backgrounds', () => {
    for (const theme of THEME_IDS) for (const level of [0, 1, 2, 3]) {
      expect(terminalPalette(theme, level).text).toBeUndefined();
    }
  });

  it('keeps Mono neutral even on 16-color terminals', () => {
    expect(terminalPalette('mono', 1)).toMatchObject({ accent: undefined, ok: 'gray', error: 'gray' });
  });
});

describe('actual ANSI emitted by Ink', () => {
  for (const level of [0, 1, 2, 3] as const) {
    it.each(THEME_IDS)(`renders %s safely at color level ${level}`, (theme) => {
      vi.stubEnv('KRASHCODE_COLOR', ['off', 'ansi', '256', 'truecolor'][level]);
      expect(configureTerminalColors(context.stdout)).toBe(level);
      const output = renderToString(h(AppearanceProvider, { initialTheme: theme, initialMotion: 'off' },
        h(Box, { flexDirection: 'column' },
          h(WelcomePanel),
          h(PromptInput, { value: '/th', onChange() {}, onSubmit() {} }),
          h(Picker, { title: 'Тема', preview: true, items: [{ key: theme, label: theme }], onSelect() {}, onCancel() {} }),
          h(Markdown, { children: '**Bold** and `inline code`\n```ts\nconst x = 1;\n```' }),
        )), { columns: 100 });
      expect(output).not.toMatch(/\x1b\[(?:4\d|10[0-7])(?:;|m)/); // No painted or reset backgrounds.
      expect(output).not.toMatch(/\x1b\[(?:7|27)m/); // No inverse styles.
      if (level === 0) expect(output).not.toMatch(/\x1b\[[\d;]*m/);
      else expect(output).toMatch(/\x1b\[[\d;]*m/); // Ensures this really exercises ANSI, not stripped snapshots.
      if (level === 1) expect(output).not.toMatch(/\x1b\[(?:38|48);/);
      if (level === 2) expect(output).not.toContain('\x1b[38;2;');
    });
  }

  it('lets NO_COLOR suppress bold/underline as well as color when FORCE_COLOR is set', () => {
    vi.stubEnv('FORCE_COLOR', '3'); vi.stubEnv('NO_COLOR', '1');
    configureTerminalColors(context.stdout);
    const output = renderToString(h(WelcomePanel));
    expect(output).not.toMatch(/\x1b\[[\d;]*m/);
  });
});
