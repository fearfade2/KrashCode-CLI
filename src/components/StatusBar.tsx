import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import { T, G } from '../ui/theme.js';

interface StatusBarProps {
  model: string;
  mode: 'normal' | 'accept' | 'plan';
  usage: string;
  bypass: boolean;
  busy: boolean;
  turnTime: number | null;
}

const MODE_COLORS: Record<string, string> = {
  normal: T.ok,
  accept: T.warn,
  plan: T.accent,
};

export default function StatusBar({ model, mode, usage, bypass, busy, turnTime }: StatusBarProps) {
  const modeColor = MODE_COLORS[mode] ?? 'white';

  // Тикаем раз в секунду, пока идёт ход, иначе счётчик времени застывает между
  // событиями стрима (например во время долгого вызова инструмента).
  const [, tick] = useState(0);
  useEffect(() => {
    if (turnTime === null) return;
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [turnTime]);

  const elapsed = turnTime !== null ? `${((Date.now() - turnTime) / 1000).toFixed(0)}s` : '';

  return (
    <Box borderStyle="single" borderColor={T.accentDim} paddingX={1} justifyContent="space-between">
      <Box gap={2}>
        <Text color={T.accent} bold>{model}</Text>
        <Text dimColor>│</Text>
        <Text color={modeColor} bold>{mode}</Text>
        {bypass && <Text color={T.error} bold>bypass</Text>}
      </Box>
      <Box gap={2}>
        {busy && (
          <>
            <Text color={T.warn}>{G.dot} думаю</Text>
            {elapsed && <Text dimColor>{elapsed}</Text>}
          </>
        )}
        {usage && (
          <>
            <Text dimColor>│</Text>
            <Text dimColor>{usage}</Text>
          </>
        )}
      </Box>
    </Box>
  );
}
