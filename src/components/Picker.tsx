import React, { useState, useEffect, useRef } from 'react';
import { Box, Text } from 'ink';
import { useTheme, G } from '../ui/theme.js';
import { useTerminalSize, useTerminalInput } from '../ui/terminal-size.js';

export interface PickerItem { key: string; label: string; hint?: string }
export interface PickerOptions {
  initialKey?: string;
  onHighlight?: (key: string) => void;
  preview?: boolean;
}
interface PickerProps extends PickerOptions {
  title: string;
  items: PickerItem[];
  onSelect(key: string): void;
  onCancel(): void;
}
const WINDOW = 8;

export function Picker({ title, items, onSelect, onCancel, initialKey, onHighlight, preview }: PickerProps) {
  const T = useTheme();
  const { rows, columns } = useTerminalSize();
  const showPreview = preview && rows >= 24;
  const windowSize = Math.min(WINDOW, Math.max(1, rows - (showPreview ? 17 : 12)));
  const [active, setActive] = useState(() => Math.max(0, items.findIndex((item) => item.key === initialKey)));
  const selected = Math.min(active, Math.max(0, items.length - 1));
  const current = useRef(selected);
  current.current = selected;
  const highlightedKey = items[selected]?.key;
  useEffect(() => { if (highlightedKey) onHighlight?.(highlightedKey); }, [highlightedKey, onHighlight]);

  useTerminalInput((input, key) => {
    const move = (index: number) => {
      current.current = Math.max(0, Math.min(items.length - 1, index));
      setActive(current.current);
    };
    if (key.upArrow) move(current.current - 1);
    else if (key.downArrow) move(current.current + 1);
    else if (key.pageUp) move(current.current - windowSize);
    else if (key.pageDown) move(current.current + windowSize);
    else if (key.home) move(0);
    else if (key.end) move(items.length - 1);
    else if (key.return) { const chosen = items[current.current]; if (chosen) onSelect(chosen.key); }
    else if (key.escape) onCancel();
    else if (!key.ctrl && !key.meta && input.length === 1 && /[a-z0-9]/i.test(input)) {
      const next = items.findIndex((item, i) => i > current.current && item.label.toLowerCase().startsWith(input.toLowerCase()));
      const first = items.findIndex((item) => item.label.toLowerCase().startsWith(input.toLowerCase()));
      if (next >= 0 || first >= 0) move(next >= 0 ? next : first);
    }
  });
  const start = Math.max(0, Math.min(selected - windowSize + 2, items.length - windowSize));
  const visible = items.slice(start, start + windowSize);

  return (
    <Box flexDirection="column" width="100%" borderStyle="single" borderColor={T.border}
      paddingX={1} marginBottom={1}>
      <Box justifyContent="space-between" columnGap={1}>
        <Text color={T.text} bold wrap="truncate-end">{title}</Text>
        <Text color={T.dim}>{items.length} вариантов</Text>
      </Box>
      <Box flexDirection="column" marginTop={1}>
        {visible.map((item, i) => <Text key={item.key} color={start + i === selected ? T.accent : T.dim}
          bold={start + i === selected} wrap="truncate-end">
          {start + i === selected ? `${G.caret} ` : '  '}{item.label}
          {item.hint && columns >= 55 ? <Text color={T.dim}> {G.sep} {item.hint}</Text> : ''}
        </Text>)}
        {items.length === 0 && <Text color={T.dim}>Нет вариантов. Esc — назад.</Text>}
      </Box>
      {showPreview && <Box flexDirection="column" marginY={1}>
        <Text color={T.dim}>ПРЕДПРОСМОТР · изменения ещё не сохранены</Text>
        <Text><Text color={T.dim}>Krash</Text><Text bold>Code</Text>{'  '}
          <Text color={T.ok}>✓ готово</Text>{'  '}<Text color={T.error}>× ошибка</Text></Text>
        <Text color={T.text}> › Так будет выглядеть ваш интерфейс </Text>
      </Box>}
      <Text color={T.dim}>{columns < 55 ? '↑↓ выбор · Enter выбрать · Esc назад' : '↑↓ / PgUp PgDn выбор · Enter сохранить · Esc отмена'}
        {items.length > windowSize ? ` · ${selected + 1}/${items.length}` : ''}</Text>
    </Box>
  );
}
