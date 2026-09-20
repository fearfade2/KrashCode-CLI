import React, { useState } from 'react';
import { PassThrough } from 'node:stream';
import { stripVTControlCharacters as strip } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, Text } from 'ink';
import stringWidth from 'string-width';
import App from '../src/components/App.js';
import { PromptInput } from '../src/components/PromptInput.js';
import { defaultConfig, type KrashConfig, type SessionData } from '../src/core/types.js';
import { useMotionFrame } from '../src/ui/terminal-size.js';
import { AppearanceProvider } from '../src/ui/theme.js';
import type { AgentCallbacks, RunAgentOptions } from '../src/core/agent.js';

const mock = vi.hoisted(() => ({
  config: {} as KrashConfig,
  saveConfig: vi.fn(), saveSession: vi.fn(), createModel: vi.fn(), runAgent: vi.fn(),
}));
vi.mock('../src/core/config.js', () => ({
  loadConfig: async () => structuredClone(mock.config),
  saveConfig: (config: KrashConfig) => mock.saveConfig(config),
  loadAuth: async () => ({}), resolveApiKey: () => '', setApiKey: vi.fn(),
}));
vi.mock('../src/core/session.js', async (original) => ({
  ...await original<typeof import('../src/core/session.js')>(),
  saveSession: (session: SessionData) => mock.saveSession(structuredClone(session)),
  listSessions: async () => [], loadSession: async () => null,
}));
vi.mock('../src/core/memory.js', () => ({ readMemory: async () => '', saveMemory: vi.fn(), clearMemory: vi.fn() }));
vi.mock('../src/core/agent.js', async (original) => ({
  ...await original<typeof import('../src/core/agent.js')>(),
  createModel: () => mock.createModel(),
  runAgent: (options: RunAgentOptions, callbacks: AgentCallbacks) => mock.runAgent(options, callbacks),
}));

const delay = (ms = 50) => new Promise((resolve) => setTimeout(resolve, ms));
const mounted: ReturnType<typeof render>[] = [];
function terminal(node: React.ReactNode = React.createElement(App), columns = 120, rows = 36) {
  const stdin = Object.assign(new PassThrough(), { isTTY: true, setRawMode() {}, ref() {}, unref() {} });
  const stdout = Object.assign(new PassThrough(), { isTTY: true, columns, rows });
  const frames: string[] = [];
  stdout.on('data', (chunk) => { const text = strip(chunk.toString()); if (text.trim()) frames.push(text); });
  const app = render(node, { stdin: stdin as unknown as NodeJS.ReadStream, stdout: stdout as unknown as NodeJS.WriteStream,
    stderr: stdout as unknown as NodeJS.WriteStream, debug: true, patchConsole: false, exitOnCtrlC: false });
  mounted.push(app);
  return {
    app, stdin, stdout, frames,
    last: () => frames.at(-1) ?? '',
    text: () => frames.join('\n'),
    async send(input: string) { stdin.write(input); await delay(); },
    async command(input: string) { stdin.write(input); await delay(); stdin.write('\r'); await delay(100); },
    async resize(width: number, height: number) { stdout.columns = width; stdout.rows = height; stdout.emit('resize'); await delay(120); },
  };
}

beforeEach(() => {
  mock.config = { ...defaultConfig(), theme: 'ember', motion: 'off' };
  mock.saveConfig.mockReset().mockImplementation(async (config) => { mock.config = structuredClone(config); });
  mock.saveSession.mockReset().mockResolvedValue(undefined);
  mock.createModel.mockReset().mockReturnValue({});
  mock.runAgent.mockReset().mockImplementation(async (_options, callbacks) => { callbacks.onTextDelta('Готово'); callbacks.onFinish('Готово'); });
});
afterEach(() => { for (const app of mounted.splice(0)) { app.unmount(); app.cleanup(); } vi.unstubAllEnvs(); });

describe('real Ink terminal interactions', () => {
  it('finishes decorative animation and releases resize listeners on unmount', async () => {
    for (const key of ['NO_COLOR', 'CI', 'INK_SCREEN_READER', 'KRASHCODE_REDUCED_MOTION']) vi.stubEnv(key, undefined);
    vi.stubEnv('TERM', 'xterm-256color');
    function Motion() { return React.createElement(Text, null, `frame:${useMotionFrame(true, 20, 8, true)}`); }
    const ui = terminal(React.createElement(AppearanceProvider, null, React.createElement(Motion)));
    await vi.waitFor(() => expect(ui.last()).toContain('frame:8'));
    const count = ui.frames.length;
    await delay(100); expect(ui.frames).toHaveLength(count);
    ui.app.unmount(); ui.app.cleanup();
    expect(ui.stdout.listenerCount('resize')).toBe(0);
  });

  it('accepts input after disabled state changes without a remount', async () => {
    const change = vi.fn();
    const props = { value: '', disabled: true, onChange: change, onSubmit: vi.fn() };
    const ui = terminal(React.createElement(PromptInput, props));
    await delay(); await ui.send('ignored'); expect(change).not.toHaveBeenCalled();
    ui.app.rerender(React.createElement(PromptInput, { ...props, disabled: false }));
    await delay(); await ui.send('accepted'); expect(change).toHaveBeenCalledWith('accepted');
  });

  it('previews, cancels, saves and restores theme selection', async () => {
    const ui = terminal();
    await vi.waitFor(() => expect(ui.last()).toContain('Ember'));
    await ui.command('/theme');
    expect(ui.last()).toContain('ПРЕДПРОСМОТР');
    await ui.send('\x1b[B');
    expect(ui.last()).toContain('Ocean · motion');
    expect(mock.saveConfig).not.toHaveBeenCalled();
    await ui.send('\x1b');
    expect(ui.last()).toContain('Ember · motion');
    await ui.command('/theme');
    await ui.send('\x1b[B');
    await ui.send('\r');
    expect(mock.config.theme).toBe('ocean');
    expect(ui.text()).toContain('Тема Ocean сохранена');
    ui.app.unmount(); ui.app.cleanup();
    const restarted = terminal();
    await vi.waitFor(() => expect(restarted.last()).toContain('Ocean'));
  });

  it('rolls theme preview back if saving fails', async () => {
    mock.saveConfig.mockRejectedValueOnce(new Error('disk full'));
    const ui = terminal(); await delay(100);
    await ui.command('/theme'); await ui.send('\x1b[B'); await ui.send('\r');
    expect(mock.config.theme).toBe('ember');
    expect(ui.last()).toContain('Ember');
    expect(ui.text()).toContain('disk full');
  });

  it('validates direct commands and persists animation preferences', async () => {
    const ui = terminal(); await delay(100);
    await ui.command('/theme violet'); expect(mock.config.theme).toBe('violet');
    await ui.command('/motion reduced'); expect(mock.config.motion).toBe('reduced');
    await ui.command('/theme invalid'); expect(mock.config.theme).toBe('violet');
    expect(ui.text()).toContain('Неизвестная тема');
    await ui.command('/motion invalid'); expect(mock.config.motion).toBe('reduced');
  });

  it('resizes wide to narrow and back without clipped branding in the final frame', async () => {
    const ui = terminal(); await delay(100);
    expect(ui.last()).toContain('⢀⣠⣴');
    await ui.resize(40, 24);
    expect(ui.last()).not.toContain('⢀⣠⣴');
    expect(ui.last()).toContain('KrashCode');
    expect(ui.last()).toContain('Enter');
    for (const line of ui.last().split('\n')) expect(stringWidth(line)).toBeLessThanOrEqual(40);
    await ui.resize(120, 36); expect(ui.last()).toContain('⢀⣠⣴');
  });

  it('uses exact /mode, accepts keyboard selection, clears and exits', async () => {
    const ui = terminal(); await delay(100);
    await ui.command('/mode'); expect(ui.last()).toContain('Режим работы');
    await ui.send('\x1b[B'); await ui.send('\r'); expect(mock.config.mode).toBe('accept');
    await ui.command('/clear'); expect(ui.last()).toContain('Что создадим сегодня?');
    await ui.command('/exit'); await ui.app.waitUntilExit();
    expect(mock.saveSession).toHaveBeenCalled();
  });

  it('recovers from model preparation failure rather than staying busy', async () => {
    mock.createModel.mockImplementationOnce(() => { throw new Error('invalid model'); });
    const ui = terminal(); await delay(100);
    await ui.command('Проверь проект');
    expect(ui.text()).toContain('invalid model');
    expect(ui.last()).toContain('готов');
    await ui.command('/theme forest'); expect(mock.config.theme).toBe('forest');
  });

  it('saves final text before asynchronous persistence', async () => {
    const ui = terminal(); await delay(100); await ui.command('Проверь проект');
    const last = mock.saveSession.mock.calls.at(-1)?.[0] as SessionData;
    expect(last.messages.at(-1)?.content).toBe('Готово');
    expect(last.messages[0].content).toBe('Проверь проект');
  });

  it('ignores late stream callbacks after cancellation and resolves pending tools', async () => {
    let callbacks: AgentCallbacks;
    mock.runAgent.mockImplementation(async (options: RunAgentOptions, current: AgentCallbacks) => {
      callbacks = current; current.onTextDelta('Частичный ответ'); current.onToolCall('tool-1', 'read', { path: 'a.ts' });
      await new Promise<void>((resolve) => options.signal!.addEventListener('abort', () => resolve(), { once: true }));
    });
    const ui = terminal(); await delay(100); await ui.command('Проверь проект'); await ui.send('\x1b');
    callbacks!.onTextDelta('LATE-CONTENT'); callbacks!.onFinish('LATE-CONTENT'); await delay();
    expect(ui.last()).toContain('готов'); expect(ui.text()).not.toContain('LATE-CONTENT');
    const saved = mock.saveSession.mock.calls.at(-1)?.[0] as SessionData;
    expect(saved.messages.at(-1)?.toolCalls?.[0].result).toContain('Прервано');
  });

  it('edits Unicode, navigates history and submits full long prompts', async () => {
    const submit = vi.fn();
    function Editor() { const [value, setValue] = useState(''); return React.createElement(PromptInput,
      { value, onChange: setValue, onSubmit: submit, history: ['прошлая задача', 'предыдущая задача'] }); }
    const ui = terminal(React.createElement(AppearanceProvider, null, React.createElement(Editor)), 40, 24);
    await delay(); await ui.send('\x1b[A'); expect(ui.last()).toContain('прошлая задача');
    await ui.send('\x1b[A'); expect(ui.last()).toContain('предыдущая задача');
    await ui.send('\x15'); await ui.send('e\u0301界'); await ui.send('\x7f'); await ui.send('\r');
    expect(submit).toHaveBeenLastCalledWith('e\u0301');
    await ui.send('x'.repeat(1000)); expect(ui.last().split('\n').length).toBeLessThanOrEqual(5);
    await ui.send('\r'); expect(submit).toHaveBeenLastCalledWith('x'.repeat(1000));
  });
});
