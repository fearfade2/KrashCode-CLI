import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import { PromptInput } from './PromptInput.js';
import { closestCommand } from './commands.js';
import Message from './Message.js';
import type { ChatMsg } from './Message.js';
import StatusBar from './StatusBar.js';
import { runAgent } from '../core/agent.js';
import type { AgentCallbacks } from '../core/agent.js';
import { loadConfig } from '../core/config.js';
import { createTools } from '../tools/index.js';
import type { CoreMessage } from 'ai';

const LOGO = `  _  __               _      ____          _      
 | |/ /_ __ __ _ ___ | |__  / ___|___   __| | ___ 
 | ' /| '__/ _\` / __|| '_ \\| |   / _ \\ / _\` |/ _ \\
 | . \\| | | (_| \\__ \\| | | | |__| (_) | (_| |  __/
 |_|\\_\\_|  \\__,_|___/|_| |_|\\____\\___/ \\__,_|\\___|`;

interface AppProps {
  cwd?: string;
  modelOverride?: string;
}

let nextId = 0;
function uid(): string {
  return `msg-${++nextId}`;
}

export default function App({ cwd, modelOverride }: AppProps) {
  const { exit } = useApp();
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [streaming, setStreaming] = useState('');
  const [model, setModel] = useState(modelOverride ?? '');
  const [mode] = useState<'normal' | 'accept' | 'plan'>('normal');
  const [tokenCount, setTokenCount] = useState(0);
  const [turnStart, setTurnStart] = useState<number | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const historyRef = useRef<CoreMessage[]>([]);
  const workDir = cwd ?? process.cwd();

  // Инициализация
  useEffect(() => {
    loadConfig().then((cfg) => {
      if (!model) setModel(modelOverride ?? cfg.model);
      setReady(true);
    });
  }, []);

  const handleSubmit = useCallback(async (value: string) => {
    const text = value.trim();
    if (!text || busy) return;

    // Slash-команды
    if (text.startsWith('/')) {
      const parts = text.slice(1).split(' ');
      const cmd = parts[0]!.toLowerCase();
      const arg = parts.slice(1).join(' ').trim();

      switch (cmd) {
        case 'exit':
        case 'quit':
          exit();
          return;
        case 'clear':
          setMessages([]);
          historyRef.current = [];
          setTokenCount(0);
          setInput('');
          return;
        case 'model':
          if (arg) {
            setModel(arg);
            setMessages((prev) => [...prev, { id: uid(), role: 'assistant', content: `Модель изменена на ${arg}` }]);
          } else {
            setMessages((prev) => [...prev, { id: uid(), role: 'assistant', content: `Текущая модель: ${model || 'не задана'}. Используй /model <name>` }]);
          }
          setInput('');
          return;
        case 'help':
          setMessages((prev) => [...prev, { id: uid(), role: 'assistant', content:
            '📖 Команды:\n' +
            '  /model <name>  — сменить модель\n' +
            '  /mode <mode>   — режим: normal | accept | plan\n' +
            '  /config        — показать конфиг\n' +
            '  /usage         — токены и стоимость\n' +
            '  /clear         — очистить чат\n' +
            '  /compact       — сжать контекст\n' +
            '  /sessions      — список сессий\n' +
            '  /exit          — выйти\n' +
            '\n  Esc — прервать запрос'
          }]);
          setInput('');
          return;
        case 'config':
          setMessages((prev) => [...prev, { id: uid(), role: 'assistant', content:
            `⚙ Конфигурация:\n  Модель: ${model || 'не задана'}\n  Режим: ${mode}\n  CWD: ${workDir}\n  Токены: ${tokenCount}`
          }]);
          setInput('');
          return;
        case 'usage':
          setMessages((prev) => [...prev, { id: uid(), role: 'assistant', content:
            `📊 Использование:\n  Токены: ${tokenCount.toLocaleString()}\n  Сообщений: ${messages.length}`
          }]);
          setInput('');
          return;
        default: {
          // Неизвестная команда — предлагаем ближайшую
          const closest = closestCommand(cmd);
          const hint = closest ? ` Может быть /${closest.name}?` : '';
          setMessages((prev) => [...prev, {
            id: uid(), role: 'assistant',
            content: `Неизвестная команда /${cmd}.${hint} Введите /help для списка.`
          }]);
          setInput('');
          return;
        }
      }
    }

    // Добавляем сообщение пользователя
    const userMsg: ChatMsg = { id: uid(), role: 'user', content: text };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setBusy(true);
    setStreaming('');
    setTurnStart(Date.now());

    historyRef.current.push({ role: 'user', content: text });

    const tools = createTools(workDir);
    const assistantId = uid();
    const toolCalls: ChatMsg['toolCalls'] = [];

    const callbacks: AgentCallbacks = {
      onTextDelta: (delta) => {
        setStreaming((prev) => prev + delta);
      },
      onToolCall: (name, args) => {
        toolCalls.push({ name, args: args as Record<string, unknown> });
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last?.id === assistantId) {
            return [...prev.slice(0, -1), { ...last, toolCalls: [...toolCalls] }];
          }
          return [...prev, { id: assistantId, role: 'assistant', content: '', toolCalls: [...toolCalls] }];
        });
      },
      onToolResult: (name, result, isError) => {
        const tc = toolCalls.find((t) => t.name === name && t.result === undefined);
        if (tc) {
          tc.result = result;
          tc.isError = isError;
        }
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last?.id === assistantId) {
            return [...prev.slice(0, -1), { ...last, toolCalls: [...toolCalls] }];
          }
          return prev;
        });
      },
      onFinish: (text, usage) => {
        setStreaming('');
        setBusy(false);
        setTurnStart(null);
        setTokenCount((prev) => prev + usage.promptTokens + usage.completionTokens);
        historyRef.current.push({ role: 'assistant', content: text });
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last?.id === assistantId) {
            return [...prev.slice(0, -1), { ...last, content: text }];
          }
          return [...prev, { id: assistantId, role: 'assistant', content: text, toolCalls: [...toolCalls] }];
        });
      },
      onError: (err) => {
        setStreaming('');
        setBusy(false);
        setTurnStart(null);
        setError(err.message);
        setMessages((prev) => [
          ...prev,
          { id: uid(), role: 'assistant', content: `⚠ Error: ${err.message}` },
        ]);
      },
    };

    try {
      await runAgent(historyRef.current, tools, callbacks, { model: model || undefined });
    } catch (err) {
      callbacks.onError(err instanceof Error ? err : new Error(String(err)));
    }
  }, [busy, model, workDir, exit]);

  useInput((ch, key) => {
    if (key.escape) {
      if (busy) {
        setBusy(false);
        setStreaming('');
        setTurnStart(null);
      } else {
        exit();
      }
    }
  });

  if (!ready) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color="cyan">{LOGO}</Text>
        <Text dimColor>Loading...</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" padding={0}>
      {/* Header */}
      <Box paddingX={1} paddingTop={1}>
        <Text color="cyan">{LOGO}</Text>
      </Box>
      <Box paddingX={1} marginBottom={1}>
        <Text dimColor>terminal coding agent • </Text>
        <Text dimColor>cwd: {workDir}</Text>
      </Box>

      {/* Messages */}
      <Box flexDirection="column" paddingX={1} flexGrow={1}>
        {messages.map((msg) => (
          <Message key={msg.id} msg={msg} />
        ))}

        {/* Streaming text */}
        {streaming && (
          <Box flexDirection="column" marginBottom={1}>
            <Box gap={1}>
              <Text color="magenta" bold>⚡</Text>
              <Text color="white" bold>krashcode</Text>
            </Box>
            <Box marginLeft={2}>
              <Text wrap="wrap">{streaming}{'▌'}</Text>
            </Box>
          </Box>
        )}

        {/* Error */}
        {error && !busy && (
          <Box marginBottom={1}>
            <Text color="red" dimColor>tip: check your API key and model name. Use /model to change.</Text>
          </Box>
        )}
      </Box>

      {/* Status bar */}
      <StatusBar
        model={model || 'not set'}
        mode={mode}
        tokenCount={tokenCount}
        busy={busy}
        turnTime={turnStart}
      />

      {/* Input */}
      <Box paddingX={1}>
        <PromptInput
          value={input}
          onChange={setInput}
          onSubmit={handleSubmit}
          disabled={busy}
          placeholder={busy ? 'thinking...' : 'Message KrashCode... (/help)'}
        />
      </Box>
    </Box>
  );
}
