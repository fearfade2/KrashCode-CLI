import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { T, G } from '../ui/theme.js';

export interface ApprovalRequest {
  name: string;
  input: Record<string, unknown>;
}

interface ApprovalPromptProps {
  request: ApprovalRequest;
  onDecide(decision: 'once' | 'always' | 'deny'): void;
}

const OPTIONS: { key: 'once' | 'always' | 'deny'; label: string }[] = [
  { key: 'once', label: 'Разрешить один раз' },
  { key: 'always', label: 'Разрешать всегда в этой сессии' },
  { key: 'deny', label: 'Отклонить (Esc)' },
];

// Оверлей подтверждения вызова инструмента — как в KitCode.
export function ApprovalPrompt({ request, onDecide }: ApprovalPromptProps) {
  const [active, setActive] = useState(0);

  useInput((_input, key) => {
    if (key.upArrow) setActive((a) => Math.max(0, a - 1));
    else if (key.downArrow) setActive((a) => Math.min(OPTIONS.length - 1, a + 1));
    else if (key.return) onDecide(OPTIONS[active]!.key);
    else if (key.escape) onDecide('deny');
  });

  const preview = summarize(request.input);

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={T.warn} paddingX={1} marginBottom={1}>
      <Box gap={1}>
        <Text color={T.warn} bold>Разрешить</Text>
        <Text color={T.accent} bold>{request.name}</Text>
      </Box>
      {preview && (
        <Box marginTop={1} marginLeft={2}>
          <Text dimColor wrap="truncate-end">{preview}</Text>
        </Box>
      )}
      <Box flexDirection="column" marginTop={1}>
        {OPTIONS.map((opt, i) => (
          <Text key={opt.key} color={i === active ? T.accent : undefined} dimColor={i !== active}>
            {i === active ? `${G.caret} ` : '  '}
            {opt.label}
          </Text>
        ))}
      </Box>
    </Box>
  );
}

function summarize(input: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(input)) {
    const s = typeof v === 'string' ? v : JSON.stringify(v);
    parts.push(`${k}: ${s.length > 120 ? s.slice(0, 117) + '…' : s}`);
  }
  return parts.join('\n');
}
