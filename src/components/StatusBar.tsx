import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import { useTheme, useAppearance, THEMES, G } from '../ui/theme.js';
import { useMotionFrame, useTerminalSize } from '../ui/terminal-size.js';

interface StatusBarProps {
  model: string;
  mode: 'normal' | 'accept' | 'plan';
  usage: string;
  bypass: boolean;
  busy: boolean;
  turnTime: number | null;
  phase?: string;
  waiting?: boolean;
  width?: number;
}

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const MODE_LABELS = { normal: 'normal · с проверкой', accept: 'accept · автоправки', plan: 'plan · только план' };

// Kept in a small component so only the indicator rerenders at animation speed.
export function Activity({ label = '', color }: { label?: string; color?: string }) {
  const T = useTheme();
  const frame = useMotionFrame(true);
  return <Text color={color ?? T.accent}>{FRAMES[frame % FRAMES.length]}{label ? ` ${label}` : ''}</Text>;
}

export function StreamingCursor() {
  const T = useTheme();
  const frame = useMotionFrame(true, 480, Infinity, true);
  return <Text color={T.accent}>{frame % 2 === 0 ? '▍' : ' '}</Text>;
}

export default function StatusBar({ model, mode, usage, bypass, busy, turnTime, phase, waiting = false, width }: StatusBarProps) {
  const T = useTheme();
  const { theme, motion } = useAppearance();
  const MODE_COLORS = { normal: T.ok, accept: T.warn, plan: T.secondary };
  const { columns } = useTerminalSize();
  const contentWidth = width ?? columns - 4;
  const compact = contentWidth < 70;
  const [, tick] = useState(0);
  useEffect(() => {
    if (turnTime === null) return;
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [turnTime]);
  const elapsed = turnTime !== null ? `${Math.max(0, Math.floor((Date.now() - turnTime) / 1000))}s` : '';

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box justifyContent="space-between" columnGap={2}>
        <Box flexShrink={1} minWidth={0}>
          <Text color={T.dim} wrap="truncate-middle">{model}</Text>
        </Box>
        <Box flexShrink={0} gap={1}>
          {waiting ? <Text color={T.warn}>◇ подтверждение</Text> : busy ? <Activity label={phase ?? (compact ? 'работаю' : 'в работе')} /> : <Text color={T.dim}>{G.dot} готов</Text>}
          {busy && elapsed && <Text color={T.dim}>{elapsed}</Text>}
        </Box>
      </Box>
      <Box flexWrap="wrap" columnGap={2}>
        <Text color={MODE_COLORS[mode]}>{compact ? mode : MODE_LABELS[mode]}</Text>
        {bypass && <Text color={T.error} bold>! BYPASS — без подтверждений</Text>}
        {contentWidth >= 86 && <Text color={T.dim}>{THEMES[theme].name} · motion {motion}</Text>}
        {usage && <Text color={T.dim} wrap="truncate-end">{usage}</Text>}
      </Box>
    </Box>
  );
}
