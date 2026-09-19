import React from 'react';
import { Box, Text } from 'ink';
import { T, EMBLEM, WORDMARK } from '../ui/theme.js';

interface LogoProps {
  // Короткая подпись под словесным знаком (например «terminal coding agent»).
  subtitle?: string;
}

// Логотип KrashCode: фирменная эмблема (Braille-арт) слева, словесный знак
// «KrashCode» справа, по центру по вертикали относительно эмблемы. Подпись —
// строкой ниже знака в том же правом столбце.
export function Logo({ subtitle }: LogoProps) {
  return (
    <Box flexDirection="row" gap={2}>
      <Text color={T.accent}>{EMBLEM}</Text>
      <Box flexDirection="column" justifyContent="center">
        <Text color={T.accent} bold>{WORDMARK}</Text>
        {subtitle ? <Text dimColor>{subtitle}</Text> : null}
      </Box>
    </Box>
  );
}

export default Logo;
