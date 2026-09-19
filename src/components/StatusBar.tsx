import React from 'react';
import { Box, Text } from 'ink';

interface StatusBarProps {
  model: string;
  mode: 'normal' | 'accept' | 'plan';
  tokenCount: number;
  busy: boolean;
  turnTime: number | null;
}

const MODE_COLORS: Record<string, string> = {
  normal: 'green',
  accept: 'yellow',
  plan: 'cyan',
};

export default function StatusBar({ model, mode, tokenCount, busy, turnTime }: StatusBarProps) {
  const modeColor = MODE_COLORS[mode] ?? 'white';
  const elapsed = turnTime !== null ? `${((Date.now() - turnTime) / 1000).toFixed(0)}s` : '';

  return (
    <Box borderStyle="single" borderColor="gray" paddingX={1} justifyContent="space-between">
      <Box gap={2}>
        <Text dimColor>model:</Text>
        <Text color="magenta" bold>{model}</Text>
        <Text dimColor>│</Text>
        <Text color={modeColor} bold>{mode}</Text>
      </Box>
      <Box gap={2}>
        {busy && (
          <>
            <Text color="yellow">● thinking</Text>
            {elapsed && <Text dimColor>{elapsed}</Text>}
          </>
        )}
        {tokenCount > 0 && (
          <>
            <Text dimColor>│</Text>
            <Text dimColor>{tokenCount.toLocaleString()} tok</Text>
          </>
        )}
      </Box>
    </Box>
  );
}
