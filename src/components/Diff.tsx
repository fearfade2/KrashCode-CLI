import React from 'react';
import { Box, Text } from 'ink';
import { useTheme } from '../ui/theme.js';
import { diffLines, diffStats } from '../ui/diff.js';

const MAX_LINES = 40;

// Рендер diff для edit/write. Для edit — oldString→newString,
// для write нового файла — все строки как добавленные.
export function DiffView({ before, after }: { before: string; after: string }): React.ReactElement {
  const T = useTheme();
  const lines = diffLines(before, after);
  const { added, removed } = diffStats(lines);
  const shown = lines.slice(0, MAX_LINES);
  const hidden = lines.length - shown.length;

  return (
    <Box flexDirection="column" marginLeft={3}>
      <Text color={T.dim}>
        +{added} −{removed}
      </Text>
      {shown.map((l, i) => {
        const sign = l.type === 'add' ? '+' : l.type === 'del' ? '-' : ' ';
        const color = l.type === 'add' ? T.ok : l.type === 'del' ? T.error : T.dim;
        return (
          <Text key={i} color={color} dimColor={l.type === 'ctx'} wrap="truncate-end">
            {sign} {l.text}
          </Text>
        );
      })}
      {hidden > 0 && <Text color={T.dim}>… ещё {hidden} строк</Text>}
    </Box>
  );
}
