import React from 'react';
import { Box, Text } from 'ink';
import ToolCall from './ToolCall.js';

export interface ChatMsg {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  toolCalls?: { name: string; args: Record<string, unknown>; result?: string; isError?: boolean }[];
}

interface MessageProps {
  msg: ChatMsg;
}

export default function Message({ msg }: MessageProps) {
  const isUser = msg.role === 'user';

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box gap={1}>
        <Text color={isUser ? 'green' : 'magenta'} bold>
          {isUser ? '❯' : '⚡'}
        </Text>
        <Text color={isUser ? 'green' : 'white'} bold>
          {isUser ? 'you' : 'krashcode'}
        </Text>
      </Box>
      {msg.content && (
        <Box marginLeft={2}>
          <Text wrap="wrap">{msg.content}</Text>
        </Box>
      )}
      {msg.toolCalls?.map((tc, i) => (
        <ToolCall key={i} name={tc.name} args={tc.args} result={tc.result} isError={tc.isError} />
      ))}
    </Box>
  );
}
