import React from 'react';
import { Box, Text } from 'ink';
import ToolCall from './ToolCall.js';
import { Markdown } from '../ui/markdown.js';
import { T, G } from '../ui/theme.js';

export interface ChatMsg {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  reasoning?: string;
  toolCalls?: { id: string; name: string; args: Record<string, unknown>; result?: string; isError?: boolean }[];
}

interface MessageProps {
  msg: ChatMsg;
}

export default function Message({ msg }: MessageProps) {
  const isUser = msg.role === 'user';

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box gap={1}>
        <Text color={isUser ? T.user : T.accent} bold>
          {G.bar}
        </Text>
        <Text color={isUser ? T.user : T.accent} bold>
          {isUser ? 'you' : 'krashcode'}
        </Text>
      </Box>
      {msg.reasoning && (
        <Box marginLeft={2}>
          <Text dimColor italic wrap="wrap">think {G.sep} {msg.reasoning}</Text>
        </Box>
      )}
      {msg.content && (
        <Box marginLeft={2}>
          {isUser ? <Text wrap="wrap">{msg.content}</Text> : <Markdown>{msg.content}</Markdown>}
        </Box>
      )}
      {msg.toolCalls?.map((tc) => (
        <ToolCall key={tc.id} name={tc.name} args={tc.args} result={tc.result} isError={tc.isError} />
      ))}
    </Box>
  );
}
