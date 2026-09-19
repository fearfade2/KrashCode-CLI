import React, { useState, useEffect, useRef, memo } from 'react';
import { Box, Text, useInput } from 'ink';
import { matchCommands } from './commands.js';
import type { SlashCommand } from './commands.js';
import { T, G } from '../ui/theme.js';

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

  // Используем ref, чтобы в useInput не было stale closures (проблема с быстрой печатью).
  // Ink 7 вызывает обработчик через useEffectEvent, чей замкнутый снимок отстаёт от
  // закоммиченного рендера — поэтому производные значения рендера (suggestions/open/active)
  // внутри обработчика читаются устаревшими. Живой источник правды — только ref'ы.
  const valueRef = useRef(value);
  valueRef.current = value;
  const cursorRef = useRef(cursor);
  cursorRef.current = cursor;
  const selCursorRef = useRef(selCursor);
  selCursorRef.current = selCursor;

  const suggestions = matchCommands(value);
  const open = suggestions.length > 0;
  const active = Math.min(selCursor, Math.max(0, suggestions.length - 1));

  // Сброс выбора при смене текста
  useEffect(() => { setSelCursor(0); }, [value]);

  // Сбрасываем курсор в начало только если поле полностью очистили (например после отправки)
  useEffect(() => { 
    if (value === '') setCursor(0); 
  }, [value]);

  useInput((input, key) => {
    if (disabled) return;

    const currentVal = valueRef.current;
    const currentCursor = cursorRef.current;
    // Пересчитываем состояние меню из живых ref'ов, а не из замыкания рендера.
    const liveSuggestions = matchCommands(currentVal);
    const liveOpen = liveSuggestions.length > 0;
    const liveActive = Math.min(selCursorRef.current, Math.max(0, liveSuggestions.length - 1));

    // Навигация по подсказкам
    if (liveOpen && key.upArrow) {
      setSelCursor(Math.max(0, liveActive - 1));
      return;
    }
    if (liveOpen && key.downArrow) {
      setSelCursor(Math.min(liveSuggestions.length - 1, liveActive + 1));
      return;
    }

    // Tab → автозаполнение
    if (liveOpen && key.tab && !key.shift) {
      const chosen = liveSuggestions[liveActive];
      if (chosen) {
        const next = `/${chosen.name} `;
        onChange(next);
        setCursor(chars(next).length);
      }
      return;
    }

    // Enter с открытыми подсказками → выбрать и выполнить
    if (liveOpen && key.return) {
      const chosen = liveSuggestions[liveActive];
      if (chosen) {
        onSubmit(`/${chosen.name}`);
        onChange('');
        setCursor(0);
      }
      return;
    }
    
    // Обычный Enter
    if (key.return) {
      onSubmit(currentVal);
      onChange('');
      setCursor(0);
      return;
    }

    // Навигация курсора
    const vc = chars(currentVal);
    const at = clamp(currentCursor, 0, vc.length);

    if (key.leftArrow) { setCursor(Math.max(0, at - 1)); return; }
    if (key.rightArrow) { setCursor(Math.min(vc.length, at + 1)); return; }
    
    if (key.backspace) {
      if (at > 0) {
        vc.splice(at - 1, 1);
        onChange(vc.join(''));
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

    // Игнорим неиспользуемые управляющие
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
        borderColor={disabled ? T.dim : T.accent}
        borderDimColor={disabled}
        paddingX={1}
      >
        <Text color={disabled ? T.dim : T.accent}>{G.prompt} </Text>
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
                color={selected ? T.accent : undefined}
                dimColor={!selected}
              >
                {selected ? `${G.caret} ` : '  '}/{cmd.name}
                {cmd.args ? ` ${cmd.args}` : ''}
                <Text dimColor> — {cmd.description}</Text>
              </Text>
            );
          })}
          {suggestions.length > visible.length && (
            <Text dimColor>  ещё {suggestions.length - visible.length}...</Text>
          )}
          <Text dimColor>  Tab — вставить {G.sep} Enter — выполнить</Text>
        </Box>
      )}
    </Box>
  );
});

function chars(s: string): string[] { return [...s]; }
function clamp(v: number, min: number, max: number): number { return Math.max(min, Math.min(v, max)); }
