import React, { useState, useEffect, useRef, memo } from 'react';
import { Box, Text } from 'ink';
import stringWidth from 'string-width';
import { stripVTControlCharacters } from 'node:util';
import { matchCommands } from './commands.js';
import { useTheme, G } from '../ui/theme.js';
import { useTerminalSize, useTerminalInput } from '../ui/terminal-size.js';

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
export const inputChars = (text: string): string[] => [...segmenter.segment(text)].map((part) => part.segment);
export function cleanInput(text: string): string {
  return stripVTControlCharacters(text).replace(/\r\n?/g, '\n').replace(/\t/g, '  ')
    .replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '');
}

// Keep the cursor visible without letting long prompts grow beyond the screen.
export function inputViewport(value: string, cursor: number, width: number) {
  const chars = inputChars(value).map((char) => char === '\n' ? '↵' : char);
  const at = Math.max(0, Math.min(cursor, chars.length));
  const current = chars[at] ?? ' ';
  const budget = Math.max(1, width - 2);
  let used = stringWidth(current);
  let start = at;
  while (start > 0 && used + stringWidth(chars[start - 1]!) <= budget) {
    used += stringWidth(chars[--start]!);
  }
  let end = Math.min(chars.length, at + 1);
  while (end < chars.length && used + stringWidth(chars[end]!) <= budget) used += stringWidth(chars[end++]!);
  return { before: (start > 0 ? '…' : '') + chars.slice(start, at).join(''), current,
    after: chars.slice(at + 1, end).join('') + (end < chars.length ? '…' : '') };
}

interface PromptInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  history?: string[];
  width?: number;
}
export const PromptInput = memo(function PromptInput({ value, onChange, onSubmit, disabled = false,
  placeholder = 'Что нужно сделать?', history = [], width }: PromptInputProps) {
  const T = useTheme();
  const { columns, rows } = useTerminalSize();
  const contentWidth = width ?? columns - 2;
  const windowSize = Math.min(6, Math.max(1, rows - 13));
  const [cursor, setCursor] = useState(() => inputChars(value).length);
  const [selection, setSelection] = useState(0);
  const live = useRef({ value, cursor, selection });
  // Refs are written synchronously in handlers: rapid keystrokes cannot read stale state.
  live.current = { value, cursor, selection };
  const historyIndex = useRef(-1);
  const draft = useRef('');
  const suggestions = matchCommands(value);
  const open = !disabled && suggestions.length > 0;
  const active = Math.min(selection, Math.max(0, suggestions.length - 1));
  const change = (text: string, at: number) => {
    live.current = { value: text, cursor: at, selection: 0 };
    onChange(text); setCursor(at); setSelection(0);
  };
  const move = (at: number) => { live.current.cursor = at; setCursor(at); };
  const select = (index: number) => { live.current.selection = index; setSelection(index); };
  useEffect(() => {
    if (!value) { live.current.cursor = 0; setCursor(0); historyIndex.current = -1; }
  }, [value]);

  useTerminalInput((input, key) => {
    if (disabled) return;
    const state = live.current;
    const chars = inputChars(state.value);
    const at = Math.max(0, Math.min(state.cursor, chars.length));
    const options = matchCommands(state.value);
    const index = Math.min(state.selection, Math.max(0, options.length - 1));
    if (options.length && (key.upArrow || key.downArrow)) {
      select(Math.max(0, Math.min(options.length - 1, index + (key.upArrow ? -1 : 1)))); return;
    }
    if (options.length && key.tab && !key.shift) {
      const next = `/${options[index]!.name} `; change(next, inputChars(next).length); return;
    }
    if (key.return) {
      const text = options.length ? `/${options[index]!.name}` : state.value;
      if (text.trim()) { change('', 0); historyIndex.current = -1; onSubmit(text); }
      return;
    }
    if ((key.upArrow || key.downArrow) && history.length && (state.value === '' || historyIndex.current >= 0)) {
      if (historyIndex.current < 0) draft.current = state.value;
      historyIndex.current = Math.max(-1, Math.min(history.length - 1, historyIndex.current + (key.upArrow ? 1 : -1)));
      const text = historyIndex.current < 0 ? draft.current : history[historyIndex.current]!;
      change(text, inputChars(text).length); return;
    }
    if (key.home || (key.ctrl && input === 'a')) { move(0); return; }
    if (key.end || (key.ctrl && input === 'e')) { move(chars.length); return; }
    if (key.leftArrow) { move(Math.max(0, at - 1)); return; }
    if (key.rightArrow) { move(Math.min(chars.length, at + 1)); return; }
    if (key.ctrl && input === 'u') { change(chars.slice(at).join(''), 0); return; }
    if (key.ctrl && input === 'k') { change(chars.slice(0, at).join(''), at); return; }
    if (key.backspace && at > 0) { chars.splice(at - 1, 1); change(chars.join(''), at - 1); return; }
    if (key.delete) { chars.splice(at, 1); change(chars.join(''), at); return; }
    if (key.ctrl || key.meta || key.tab || key.escape || key.upArrow || key.downArrow || !input) return;
    const inserted = inputChars(cleanInput(input));
    if (!inserted.length) return;
    historyIndex.current = -1;
    chars.splice(at, 0, ...inserted); change(chars.join(''), at + inserted.length);
  });
  const start = Math.max(0, Math.min(active - windowSize + 2, suggestions.length - windowSize));
  const visible = suggestions.slice(start, start + windowSize);
  const view = inputViewport(value, cursor, Math.max(3, contentWidth - 6));
  return (
    <Box flexDirection="column" flexShrink={0} width="100%">
      <Box borderStyle="single" borderTop={false} borderRight={false} borderBottom={false}
        borderColor={disabled ? T.border : T.accent} paddingX={1} paddingY={1}>
        <Text color={disabled ? T.dim : T.accent}>{G.prompt} </Text>
        <Box flexGrow={1} flexShrink={1} minWidth={0}>
          {value ? <Text color={T.text} wrap="truncate-end">{view.before}<Text underline={!disabled}>{view.current === ' ' && !disabled ? '▏' : view.current}</Text>{view.after}</Text>
            : <Text color={T.dim} wrap="truncate-end"><Text>{!disabled ? '▏' : ''}</Text>{placeholder}</Text>}
        </Box>
      </Box>
      {open && <Box flexDirection="column" paddingX={1} borderStyle="single" borderColor={T.border}
        borderTop={false} borderRight={false} borderBottom={false}>
        <Text color={T.dim}>КОМАНДЫ / {suggestions.length}</Text>
        {visible.map((cmd, i) => <Text key={cmd.name} color={start + i === active ? T.accent : T.dim}
          bold={start + i === active} wrap="truncate-end">
          {start + i === active ? `${G.caret} ` : '  '}/{cmd.name}{cmd.args ? ` ${cmd.args}` : ''}
          {contentWidth >= 64 && <Text color={T.dim}> — {cmd.description}</Text>}
        </Text>)}
        <Text color={T.dim}>Tab вставить · Enter выполнить{suggestions.length > windowSize ? ` · ${active + 1}/${suggestions.length}` : ''}</Text>
      </Box>}
      {!open && <Box paddingX={1}><Text color={T.dim} wrap="truncate-end">
        {disabled ? 'Esc прервать · Ctrl+C выход' : contentWidth < 58 ? 'Enter отправить · / команды'
          : 'Enter отправить · ↑ история · / команды · Shift+Tab режим'}
      </Text></Box>}
    </Box>
  );
});
