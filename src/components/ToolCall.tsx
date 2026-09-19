import React from 'react';
import { Box, Text } from 'ink';

interface ToolCallProps {
  name: string;
  args: Record<string, unknown>;
  result?: string;
  isError?: boolean;
}

function summarizeArgs(args: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(args)) {
    const s = typeof v === 'string'
      ? (v.length > 60 ? v.slice(0, 57) + '...' : v)
      : JSON.stringify(v);
    parts.push(`${k}=${s}`);
  }
  return parts.join(', ');
}

export default function ToolCall({ name, args, result, isError }: ToolCallProps) {
  const icon = isError ? '✗' : result !== undefined ? '✓' : '⟳';
  const iconColor = isError ? 'red' : result !== undefined ? 'green' : 'yellow';

  return (
    <Box flexDirection="column" marginLeft={2} marginY={0}>
      <Box gap={1}>
        <Text color={iconColor}>{icon}</Text>
        <Text color="cyan" bold>{name}</Text>
        <Text dimColor>({summarizeArgs(args)})</Text>
      </Box>
      {result !== undefined && (
        <Box marginLeft={3}>
          <Text color={isError ? 'red' : 'gray'} wrap="truncate-end">
            {result.length > 200 ? result.slice(0, 197) + '...' : result}
          </Text>
        </Box>
      )}
    </Box>
  );
}
