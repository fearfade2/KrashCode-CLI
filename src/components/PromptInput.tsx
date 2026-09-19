import React, { useState, useEffect, memo } from 'react';
import { Box, Text, useInput } from 'ink';
import { matchCommands } from './commands.js';
import type { SlashCommand } from './commands.js';

const WINDOW = 6;

interface PromptInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

export const PromptInput = memo(function PromptInput({
  value,
  onChange,
  onSubmit,
  disabled = false,
  placeholder = 'Message KrashCode...',
}: PromptInputProps) {
  const [cursor, setCursor] = useState(0);
  const [selCursor, setSelCursor] = useState(0);

  const suggestions = matchCommands(value);
  const open = suggestions.length > 0;
  const active = Math.min(selCursor, Math.max(0, suggestions.length - 1));

  // Сброс подсказки при смене текста
  useEffect(() => { setSelCursor(0); }, [value]);
  useEffect(() => { setCursor(chars(value).length); }, [value]);

  useInput((input, key) => {
    if (disabled) return;

    // Навигация по подсказкам
    if (open && key.upArrow) {
      setSelCursor(Math.max(0, active - 1));
      return;
    }
    if (open && key.downArrow) {
      setSelCursor(Math.min(suggestions.length - 1, active + 1));
      return;
    }
    // Tab → автозаполнение
    if (open && key.tab && !key.shift) {
      const chosen = suggestions[active];
      if (chosen) {
        const next = `/${chosen.name} `;
        onChange(next);
      }
      return;
    }
    // Enter с открытыми подсказками → выбрать и выполнить
    if (open && key.return) {
      const chosen = suggestions[active];
      if (chosen) {
        onSubmit(`/${chosen.name}`);
        onChange('');
      }
      return;
    }
    // Обычный Enter
    if (key.return) {
      onSubmit(value);
      onChange('');
      return;
    }

    // Навигация курсора
    const vc = chars(value);
    const at = clamp(cursor, 0, vc.length);

    if (key.leftArrow) { setCursor(Math.max(0, at - 1)); return; }
    if (key.rightArrow) { setCursor(Math.min(vc.length, at + 1)); return; }
    if (key.backspace) {
      if (at > 0) {
        vc.splice(at - 1, 1);
        const next = vc.join('');
        onChange(next);
        setCursor(at - 1);
      }
      return;
    }
    if (key.delete) {
      if (at < vc.length) {
        vc.splice(at, 1);
        onChange(vc.join(''));
      }
      return;
    }

    // Игнорим управляющие
    if (key.tab || key.upArrow || key.downArrow || key.escape) return;
    if (input === '' || key.ctrl || key.meta) return;

    // Ввод символа
    const inserted = chars(input);
    vc.splice(at, 0, ...inserted);
    onChange(vc.join(''));
    setCursor(at + inserted.length);
  });

  // Видимое окно подсказок
  const start = Math.max(0, Math.min(active - WINDOW + 2, suggestions.length - WINDOW));
  const visible = suggestions.slice(start, start + WINDOW);

  const vc = chars(value);
  const at = clamp(cursor, 0, vc.length);

  return (
    <Box flexDirection="column" flexShrink={0}>
      {/* Поле ввода */}
      <Box
        borderStyle="round"
        borderColor={disabled ? 'gray' : 'cyan'}
        borderDimColor={disabled}
        paddingX={1}
      >
        <Text color={disabled ? 'gray' : 'cyan'}>› </Text>
        <Box flexGrow={1} flexShrink={1} minWidth={0}>
          {vc.length === 0 ? (
            <Text>
              <Text inverse>{chars(placeholder)[0] ?? ' '}</Text>
              <Text color="gray">{chars(placeholder).slice(1).join('')}</Text>
            </Text>
          ) : (
            <Text>
              {vc.slice(0, at).join('')}
              <Text inverse>{vc[at] ?? ' '}</Text>
              {vc.slice(at + 1).join('')}
            </Text>
          )}
        </Box>
      </Box>

      {/* Подсказки команд */}
      {open && (
        <Box flexDirection="column" marginLeft={2}>
          {visible.map((cmd, i) => {
            const selected = start + i === active;
            return (
              <Text
                key={cmd.name}
                color={selected ? 'cyan' : undefined}
                dimColor={!selected}
              >
                {selected ? '❯ ' : '  '}/{cmd.name}
                {cmd.args ? ` ${cmd.args}` : ''}
                <Text dimColor> — {cmd.description}</Text>
              </Text>
            );
          })}
          {suggestions.length > visible.length && (
            <Text dimColor>  ещё {suggestions.length - visible.length}...</Text>
          )}
          <Text dimColor>  Tab — вставить · Enter — выполнить</Text>
        </Box>
      )}
    </Box>
  );
});

function chars(s: string): string[] { return [...s]; }
function clamp(v: number, min: number, max: number): number { return Math.max(min, Math.min(v, max)); }
