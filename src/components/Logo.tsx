import React from 'react';
import { Box, Text, useIsScreenReaderEnabled } from 'ink';
import { useTheme, useAppearance, THEMES, EMBLEM_DISPLAY, BRAND_LEFT, BRAND_RIGHT } from '../ui/theme.js';
import { useTerminalSize } from '../ui/terminal-size.js';

interface LogoProps { subtitle?: string; compact?: boolean; animated?: boolean }

export function Logo({ subtitle, compact = false }: LogoProps) {
  const T = useTheme();
  const { columns, rows } = useTerminalSize();
  const screenReader = useIsScreenReaderEnabled();
  const largeName = !compact && !screenReader && columns >= 54 && rows >= 18;
  const showEmblem = largeName && columns >= 80 && rows >= 24;
  return (
    <Box flexDirection="row" columnGap={showEmblem ? 3 : 0} justifyContent={compact ? "flex-start" : "center"}>
      {showEmblem && <Box flexDirection="column" flexShrink={0}>
        {EMBLEM_DISPLAY.map((line, row) => <Text key={row} color={T.dim}>{line}</Text>)}
      </Box>}
      <Box flexDirection="column" justifyContent="center" flexShrink={1} minWidth={0}>
        {largeName && <Box flexDirection="column" marginBottom={1}>
          {BRAND_LEFT.map((line, row) => <Text key={row}>
            <Text color={T.dim}>{line}</Text>{'  '}<Text bold>{BRAND_RIGHT[row]}</Text>
          </Text>)}
        </Box>}
        <Text wrap="truncate-end"><Text color={T.dim}>Krash</Text><Text bold>Code</Text>
          {!compact && <Text color={T.dim}> / terminal coding agent</Text>}
        </Text>
        {subtitle && <Text color={T.dim} wrap="wrap">{subtitle}</Text>}
      </Box>
    </Box>
  );
}

export function WelcomePanel() {
  const T = useTheme();
  const { theme } = useAppearance();
  const { rows } = useTerminalSize();
  return (
    <Box flexDirection="column" alignItems="center" marginTop={rows >= 32 ? 2 : 0} marginBottom={1}>
      <Logo subtitle={rows >= 30 ? 'Что создадим сегодня?' : undefined} />
      <Box marginTop={rows >= 30 ? 1 : 0}>
        <Text color={T.dim} wrap="truncate-end">/theme {THEMES[theme].name}   /model выбрать модель   /help</Text>
      </Box>
    </Box>
  );
}
export default Logo;
