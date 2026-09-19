import React, { useState, useRef } from 'react';
import { Box, Text, useInput } from 'ink';
import { T, G } from '../ui/theme.js';

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
  const [value, setValue] = useState(initial);
  const valueRef = useRef(value);
  valueRef.current = value;

  useInput((input, key) => {
    if (key.return) {
      onSubmit(valueRef.current);
      return;
    }
    if (key.escape) {
      onCancel();
      return;
    }
    const current = [...valueRef.current];
    if (key.backspace || key.delete) {
      current.pop();
      setValue(current.join(''));
      return;
    }
    // Игнорируем управляющие последовательности.
    if (input === '' || key.ctrl || key.meta || key.tab || key.upArrow || key.downArrow || key.leftArrow || key.rightArrow) {
      return;
    }
    setValue(current.join('') + input);
  });

  const shown = secret ? '•'.repeat([...value].length) : value;
  const isEmpty = [...value].length === 0;

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={T.accent} paddingX={1} marginBottom={1}>
      <Text color={T.accent} bold>{title}</Text>
      <Box marginTop={1}>
        <Text color={T.accent}>{G.prompt} </Text>
        {isEmpty && placeholder ? (
          <Text dimColor>{placeholder}</Text>
        ) : (
          <Text>{shown}<Text inverse> </Text></Text>
        )}
      </Box>
      <Text dimColor>{hint ? `${hint} ${G.sep} ` : ''}Enter — подтвердить {G.sep} Esc — отмена</Text>
    </Box>
  );
}
