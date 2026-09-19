import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { T, G } from '../ui/theme.js';

export interface PickerItem {
  key: string;
  label: string;
  hint?: string;
}

interface PickerProps {
  title: string;
  items: PickerItem[];
  onSelect(key: string): void;
  onCancel(): void;
}

const WINDOW = 8;

// Универсальный список выбора (модели, сессии, режимы) с прокруткой.
export function Picker({ title, items, onSelect, onCancel }: PickerProps) {
  const [active, setActive] = useState(0);

  useInput((_input, key) => {
    if (key.upArrow) setActive((a) => Math.max(0, a - 1));
    else if (key.downArrow) setActive((a) => Math.min(items.length - 1, a + 1));
    else if (key.return) {
      const chosen = items[active];
      if (chosen) onSelect(chosen.key);
    } else if (key.escape) onCancel();
  });

  const start = Math.max(0, Math.min(active - WINDOW + 2, items.length - WINDOW));
  const visible = items.slice(start, start + WINDOW);

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={T.accent} paddingX={1} marginBottom={1}>
      <Text color={T.accent} bold>{title}</Text>
      <Box flexDirection="column" marginTop={1}>
        {visible.map((item, i) => {
          const selected = start + i === active;
          return (
            <Text key={item.key} color={selected ? T.accent : undefined} dimColor={!selected}>
              {selected ? `${G.caret} ` : '  '}
              {item.label}
              {item.hint ? <Text dimColor> {G.sep} {item.hint}</Text> : ''}
            </Text>
          );
        })}
      </Box>
      <Text dimColor>↑↓ выбор {G.sep} Enter подтвердить {G.sep} Esc отмена{items.length > WINDOW ? ` ${G.sep} ${active + 1}/${items.length}` : ''}</Text>
    </Box>
  );
}
