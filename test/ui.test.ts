import React from 'react';
import { readFileSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import { stripVTControlCharacters } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Box, renderToString, Text } from 'ink';
import stringWidth from 'string-width';
import { Logo, WelcomePanel } from '../src/components/Logo.js';
import StatusBar from '../src/components/StatusBar.js';
import { PromptInput, cleanInput, inputChars, inputViewport } from '../src/components/PromptInput.js';
import { Picker } from '../src/components/Picker.js';
import { ApprovalPrompt } from '../src/components/ApprovalPrompt.js';
import { TextPrompt } from '../src/components/TextPrompt.js';
import ToolCall from '../src/components/ToolCall.js';
import { motionAllowed, useMotionFrame } from '../src/ui/terminal-size.js';
import { AppearanceProvider, EMBLEM, EMBLEM_DISPLAY, THEMES, WORDMARK } from '../src/ui/theme.js';
import { matchCommands } from '../src/components/commands.js';

const terminal = vi.hoisted(() => ({ stdout: null as unknown as NodeJS.WriteStream }));
vi.mock('ink', async (original) => ({
  ...await original<typeof import('ink')>(),
  useStdout: () => ({ stdout: terminal.stdout, write: () => {} }),
}));

const h = React.createElement;
const noop = () => {};
function screen(node: React.ReactNode, columns = 80, rows = 24, isTTY = false) {
  terminal.stdout = Object.assign(new EventEmitter(), { columns, rows, isTTY }) as NodeJS.WriteStream;
  return stripVTControlCharacters(renderToString(node, { columns }));
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe('KrashCode visual layout', () => {
  it('uses a four-row, equal-width wordmark', () => {
    const lines = WORDMARK.split('\n');
    expect(lines).toHaveLength(4);
    expect(new Set(lines.map(stringWidth)).size).toBe(1);
    expect(stringWidth(lines[0])).toBe(45);
  });

  it('keeps the exact brand readable at wide and compact sizes', () => {
    expect(screen(h(Logo), 100, 32)).toContain('KrashCode');
    const narrow = screen(h(Logo), 40);
    expect(narrow).toContain('KrashCode');
    expect(narrow).not.toContain('███');
  });

  it.each([[120, 40], [80, 24], [70, 24], [40, 24], [32, 20]])(
    'fits the welcome and composer in a %ix%i terminal', (columns, rows) => {
      const output = screen(h(Box, { flexDirection: 'column' },
        h(WelcomePanel),
        h(StatusBar, { model: 'openai/gpt-4o', mode: 'normal', usage: '', bypass: false, busy: false, turnTime: null }),
        h(Box, { paddingX: 1 }, h(PromptInput, { value: '', onChange: noop, onSubmit: noop, placeholder: 'Что нужно сделать?' })),
      ), columns, rows);
      expect(output).toContain('KrashCode');
      expect(output).toContain('Enter');
      for (const line of output.split('\n')) expect(stringWidth(line)).toBeLessThanOrEqual(columns);
      // Leave four rows for the static workspace header.
      expect(output.split('\n').length).toBeLessThanOrEqual(rows - 4);
    },
  );

  it('retains the bypass warning even with a very long model name', () => {
    const output = screen(h(StatusBar, {
      model: 'provider/a-very-long-model-identifier-2026-09', mode: 'plan',
      usage: '1.2k tokens', bypass: true, busy: true, turnTime: Date.now(),
    }), 40);
    expect(output).toContain('BYPASS');
    expect(output).toContain('plan');
    expect(output).toContain('работаю');
    for (const line of output.split('\n')) expect(stringWidth(line)).toBeLessThanOrEqual(40);
  });

  it('shows command suggestions and keyboard hints', () => {
    const output = screen(h(PromptInput, { value: '/mo', onChange: noop, onSubmit: noop }), 40);
    expect(output).toContain('/model');
    expect(output).toContain('/mode');
    expect(output).toContain('Tab');
  });

  it('prioritizes exact commands over prefix matches', () => {
    expect(matchCommands('/mode')[0]?.name).toBe('mode');
    expect(matchCommands('/model')[0]?.name).toBe('model');
    expect(matchCommands('/mo').map((command) => command.name)).toEqual(['motion', 'model', 'mode']);
  });

  it('hides suggestions while the composer is disabled', () => {
    const output = screen(h(PromptInput, { value: '/mo', onChange: noop, onSubmit: noop, disabled: true }));
    expect(output).not.toContain('КОМАНДЫ');
  });

  it('limits picker rows in short terminals', () => {
    const items = Array.from({ length: 20 }, (_, i) => ({ key: `${i}`, label: `model-${i}` }));
    const output = screen(h(Picker, { title: 'Модель', items, onSelect: noop, onCancel: noop }), 40, 16);
    expect(output).toContain('model-0');
    expect(output).not.toContain('model-4');
    expect(output).toContain('1/20');
  });

  it('keeps approval choices explicit', () => {
    const output = screen(h(ApprovalPrompt, { request: { name: 'bash', input: { command: 'npm test' } }, onDecide: noop }), 40);
    expect(output).toContain('ТРЕБУЕТСЯ РАЗРЕШЕНИЕ');
    expect(output).toContain('Разрешить один раз');
    expect(output).toContain('Отклонить');
  });

  it('never renders a secret as plaintext', () => {
    const output = screen(h(TextPrompt, { title: 'API-ключ', initial: 'secret-token', secret: true, onSubmit: noop, onCancel: noop }));
    expect(output).not.toContain('secret-token');
    expect(output).toContain('••••••••••••');
    expect(output).toContain('скрытый ввод');
  });

  it('distinguishes successful and failed tools without color', () => {
    expect(screen(h(ToolCall, { name: 'bash', args: {}, result: 'done' }))).toContain('✓');
    expect(screen(h(ToolCall, { name: 'bash', args: {}, result: 'failed', isError: true }))).toContain('×');
  });
});

describe('terminal motion safeguards', () => {
  it('only enables motion in an interactive terminal', () => {
    expect(motionAllowed(true, {})).toBe(true);
    expect(motionAllowed(false, {})).toBe(false);
  });

  it.each([
    { TERM: 'dumb' }, { NO_COLOR: '' }, { CI: '1' },
    { INK_SCREEN_READER: 'true' }, { INK_SCREEN_READER: '1' },
    { KRASHCODE_REDUCED_MOTION: '1' }, { KRASHCODE_REDUCED_MOTION: 'true' },
  ])('disables motion for %o', (env) => {
    expect(motionAllowed(true, env)).toBe(false);
  });

  it('does not start animation timers in redirected output', () => {
    const timer = vi.spyOn(globalThis, 'setInterval');
    screen(h(Logo, { animated: true }));
    expect(timer).not.toHaveBeenCalled();
  });

  it('cleans up animation timers on unmount', () => {
    for (const key of ['NO_COLOR', 'CI', 'INK_SCREEN_READER', 'KRASHCODE_REDUCED_MOTION']) vi.stubEnv(key, undefined);
    vi.stubEnv('TERM', 'xterm-256color');
    const start = vi.spyOn(globalThis, 'setInterval');
    const stop = vi.spyOn(globalThis, 'clearInterval');
    function Motion() { return h(Text, null, String(useMotionFrame(true, 90, 14))); }
    screen(h(Motion), 80, 24, true);
    expect(start).toHaveBeenCalledWith(expect.any(Function), 90);
    expect(stop).toHaveBeenCalled();
  });
});


describe('original branding, themes and editor', () => {
  it('preserves the original emblem byte-for-byte', () => {
    expect(EMBLEM).toBe(readFileSync(new URL('../logo', import.meta.url), 'utf8').trimEnd());
    const output = screen(h(Logo), 120, 36);
    for (const line of EMBLEM_DISPLAY) expect(output).toContain(line);
    expect(EMBLEM_DISPLAY.map((line) => line.replace(/[⠀ ]/g, ''))).toEqual(
      EMBLEM.split('\n').map((line) => line.replace(/[⠀ ]/g, '')),
    );
  });

  it.each(Object.keys(THEMES))('renders the %s palette without losing the brand', (theme) => {
    const output = screen(h(AppearanceProvider, { initialTheme: theme as keyof typeof THEMES }, h(WelcomePanel)), 120, 36);
    expect(output).toContain('KrashCode');
    expect(output).toContain(THEMES[theme as keyof typeof THEMES].name);
  });

  it('removes terminal control sequences from pasted input', () => {
    expect(cleanInput('a\x1b[31mb\x1b[0m\r\nc\x00')).toBe('ab\nc');
  });

  it('treats combining accents as one editable character', () => {
    expect(inputChars('e\u0301界')).toEqual(['e\u0301', '界']);
  });

  it.each([0, 1, 20, 40, 80])('keeps the cursor visible at position %i', (at) => {
    const value = '界'.repeat(80);
    const view = inputViewport(value, at, 25);
    expect(stringWidth(view.before + view.current + view.after)).toBeLessThanOrEqual(25);
    expect(view.current).toBe(at === 80 ? ' ' : '界');
  });

  it('keeps a thousand-character prompt on one input row', () => {
    const output = screen(h(PromptInput, { value: 'x'.repeat(1000), onChange: noop, onSubmit: noop }), 40);
    expect(output.split('\n')).toHaveLength(4);
    expect(output).toContain('…');
  });

  it('does not autocomplete command arguments', () => {
    expect(matchCommands('/theme ocean')).toEqual([]);
    expect(matchCommands('/mode ')).toEqual([]);
  });

  it.each(['off', 'reduced'] as const)('suppresses decorative timers with %s motion', (motion) => {
    for (const key of ['NO_COLOR', 'CI', 'INK_SCREEN_READER', 'KRASHCODE_REDUCED_MOTION']) vi.stubEnv(key, undefined);
    vi.stubEnv('TERM', 'xterm-256color');
    const timer = vi.spyOn(globalThis, 'setInterval');
    screen(h(AppearanceProvider, { initialMotion: motion }, h(Logo, { animated: true })), 120, 36, true);
    expect(timer).not.toHaveBeenCalled();
  });
});
