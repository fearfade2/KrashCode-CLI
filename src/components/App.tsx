import React, { useState } from 'react';
import { Box, Text, Newline } from 'ink';

const LOGO = `
  _  __               _    ____          _      
 | |/ /_ __ __ _ ___ | |__/ ___|___   __| | ___ 
 | ' /| '__/ _` + "`" + ` / __|| '_ \\___ \\ / _ \\ / _` + "`" + ` |/ _ \\
 | . \\| | | (_| \\__ \\| | | |__) | (_) | (_| |  __/
 |_|\\_\\_|  \\__,_|___/|_| |_|____/ \\___/ \\__,_|\\___|
`;

export default function App() {
  const [messages, setMessages] = useState<{ role: string, content: string }[]>([]);

  return (
    <Box flexDirection="column" padding={1}>
      <Box borderStyle="round" borderColor="cyan" padding={1}>
        <Text color="cyanBright">{LOGO}</Text>
      </Box>
      <Box marginY={1} flexDirection="column">
        <Text color="gray">Добро пожаловать в KrashCode CLI! 🚀</Text>
        <Text color="gray">Загрузка модулей и инициализация Vercel AI SDK...</Text>
      </Box>
    </Box>
  );
}
