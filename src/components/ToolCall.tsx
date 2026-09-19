import React from 'react';
import { Box, Text } from 'ink';
import { DiffView } from './Diff.js';
import { T, G } from '../ui/theme.js';

interface ToolCallProps {
  name: string;
  args: Record<string, unknown>;
  result?: string;
  isError?: boolean;
}

function summarizeArgs(name: string, args: Record<string, unknown>): string {
  // Для файловых инструментов показываем только путь — diff расскажет остальное.
  if ((name === 'edit' || name === 'write') && typeof args.path === 'string') {
    return args.path;
  }
  const parts: string[] = [];
  for (const [k, v] of Object.entries(args)) {
    if ((name === 'edit' && (k === 'oldString' || k === 'newString')) || (name === 'write' && k === 'content')) {
      continue;
    }
    const s = typeof v === 'string'
      ? (v.length > 60 ? v.slice(0, 57) + '...' : v)
      : JSON.stringify(v);
    parts.push(`${k}=${s}`);
  }
  return parts.join(', ');
}

function renderDiff(name: string, args: Record<string, unknown>): React.ReactElement | null {
  if (name === 'edit' && typeof args.oldString === 'string' && typeof args.newString === 'string') {
    return <DiffView before={args.oldString} after={args.newString} />;
  }
  if (name === 'write' && typeof args.content === 'string') {
    return <DiffView before="" after={args.content} />;
  }
  return null;
}

const MAX_RESULT_LINES = 15;
const MAX_RESULT_CHARS = 2000;

// Показываем до MAX_RESULT_LINES строк вывода (и не длиннее MAX_RESULT_CHARS),
// а не первые 200 символов одной строкой — иначе вывод команд не разглядеть.
function clip(result: string): string[] {
  const capped = result.length > MAX_RESULT_CHARS ? result.slice(0, MAX_RESULT_CHARS) : result;
  return capped.replace(/\n+$/, '').split('\n').slice(0, MAX_RESULT_LINES);
}

function hiddenLines(result: string): number {
  const total = result.replace(/\n+$/, '').split('\n').length;
  return Math.max(0, total - MAX_RESULT_LINES);
}

export default function ToolCall({ name, args, result, isError }: ToolCallProps) {
  const icon = isError ? G.err : result !== undefined ? G.ok : G.run;
  const iconColor = isError ? T.error : result !== undefined ? T.ok : T.warn;
  const diff = renderDiff(name, args);

  return (
    <Box flexDirection="column" marginLeft={2} marginY={0}>
      <Box gap={1}>
        <Text color={iconColor}>{icon}</Text>
        <Text color={T.accent} bold>{name}</Text>
        <Text dimColor>({summarizeArgs(name, args)})</Text>
      </Box>
      {diff}
      {result !== undefined && !diff && (
        <Box marginLeft={3} flexDirection="column">
          {clip(result).map((line, i) => (
            <Text key={i} color={isError ? 'red' : 'gray'} wrap="truncate-end">{line || ' '}</Text>
          ))}
          {hiddenLines(result) > 0 && (
            <Text dimColor>… ещё {hiddenLines(result)} строк</Text>
          )}
        </Box>
      )}
      {result !== undefined && diff && isError && (
        <Box marginLeft={3}>
          <Text color="red" wrap="truncate-end">{result.slice(0, 197)}</Text>
        </Box>
      )}
    </Box>
  );
}
