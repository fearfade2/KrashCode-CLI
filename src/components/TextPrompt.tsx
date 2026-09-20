import React, { useState, useRef } from 'react';
import { Box, Text } from 'ink';
import { inputChars, cleanInput, inputViewport } from './PromptInput.js';
import { useTerminalSize, useTerminalInput } from '../ui/terminal-size.js';
import { useTheme, G } from '../ui/theme.js';

interface TextPromptProps {
  title: string;
  hint?: string;
  initial?: string;
  placeholder?: string;
  // Маскировать ввод точками — для API-ключей.
  secret?: boolean;
  onSubmit(value: string): void;
  onCancel(): void;
}

// Однострочный ввод в оверлее (base URL, API-ключ, произвольное значение).
// Собственный useInput читает значение из ref: Ink 7 зовёт обработчик через
// useEffectEvent, чей снимок отстаёт от рендера, поэтому state в замыкании
// был бы устаревшим (та же причина, что и в PromptInput).
export function TextPrompt({ title, hint, initial = '', placeholder, secret, onSubmit, onCancel }: TextPromptProps) {
  const T = useTheme();
  const { columns } = useTerminalSize();
  const [value, setValue] = useState(initial);
  const valueRef = useRef(value);
  valueRef.current = value;

  useTerminalInput((input, key) => {
    if (key.return) {
      onSubmit(valueRef.current);
      return;
    }
    if (key.escape) {
      onCancel();
      return;
    }
    const current = inputChars(valueRef.current);
    if (key.backspace || key.delete) {
      current.pop();
      valueRef.current = current.join('');
      setValue(valueRef.current);
      return;
    }
    // Игнорируем управляющие последовательности.
    if (input === '' || key.ctrl || key.meta || key.tab || key.upArrow || key.downArrow || key.leftArrow || key.rightArrow) {
      return;
    }
    valueRef.current = current.join('') + cleanInput(input).replace(/\n/g, ' ');
    setValue(valueRef.current);
  });

  const shown = secret ? '•'.repeat(inputChars(value).length) : value;
  const isEmpty = !value;
  const view = inputViewport(shown, inputChars(shown).length, Math.max(3, columns - 8));

  return (
    <Box flexDirection="column" borderStyle="single" borderColor={T.border} width="100%" paddingX={1} marginBottom={1}>
      <Text color={T.text} bold>{title}{secret ? ' · скрытый ввод' : ''}</Text>
      <Box marginTop={1}>
        <Text color={T.accent}>{G.prompt} </Text>
        {isEmpty && placeholder ? (
          <Text color={T.dim} wrap="truncate-end">{placeholder}</Text>
        ) : (
          <Text color={T.text}>{view.before}<Text underline>{view.current === ' ' ? '▏' : view.current}</Text></Text>
        )}
      </Box>
      <Text color={T.dim}>{hint ? `${hint} ${G.sep} ` : ''}Enter — подтвердить {G.sep} Esc — отмена</Text>
    </Box>
  );
}
