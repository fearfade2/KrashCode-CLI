import { streamText, type CoreMessage, type ToolSet } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { loadConfig, resolveApiKey } from './config.js';
import type { KrashConfig } from './types.js';

const SYSTEM_PROMPT = `You are KrashCode — a powerful terminal coding agent.
You help the user read, write, and edit code, run shell commands, and search across projects.
Be concise, precise, and use the tools available to you.
When showing file changes, be specific about what you changed and why.
Answer in the language the user writes to you.`;

function createModel(config: KrashConfig) {
  const apiKey = resolveApiKey(config);

  switch (config.provider) {
    case 'anthropic': {
      const anthropic = createAnthropic({ apiKey });
      return anthropic(config.model);
    }
    case 'google': {
      const google = createGoogleGenerativeAI({ apiKey });
      return google(config.model);
    }
    case 'openrouter': {
      const openrouter = createOpenAI({
        apiKey,
        baseURL: config.baseUrl ?? 'https://openrouter.ai/api/v1',
      });
      return openrouter(config.model);
    }
    case 'custom': {
      const custom = createOpenAI({
        apiKey,
        baseURL: config.baseUrl ?? 'http://localhost:11434/v1',
      });
      return custom(config.model);
    }
    case 'openai':
    default: {
      const openai = createOpenAI({ apiKey });
      return openai(config.model);
    }
  }
}

export interface AgentCallbacks {
  onTextDelta: (delta: string) => void;
  onToolCall: (name: string, args: Record<string, unknown>) => void;
  onToolResult: (name: string, result: string, isError: boolean) => void;
  onFinish: (text: string, usage: { promptTokens: number; completionTokens: number }) => void;
  onError: (error: Error) => void;
}

export async function runAgent(
  messages: CoreMessage[],
  tools: ToolSet,
  callbacks: AgentCallbacks,
  configOverride?: Partial<KrashConfig>,
): Promise<void> {
  const config = { ...(await loadConfig()), ...configOverride };
  const model = createModel(config);

  try {
    const result = streamText({
      model,
      system: SYSTEM_PROMPT,
      messages,
      tools,
      maxSteps: 15,
      maxTokens: config.maxTokens,
    });

    for await (const part of result.fullStream) {
      switch (part.type) {
        case 'text-delta':
          callbacks.onTextDelta(part.textDelta);
          break;
        case 'tool-call':
          callbacks.onToolCall(part.toolName, part.args as Record<string, unknown>);
          break;
        case 'tool-result':
          callbacks.onToolResult(
            part.toolName,
            typeof part.result === 'string' ? part.result : JSON.stringify(part.result),
            false,
          );
          break;
        case 'error':
          callbacks.onError(part.error instanceof Error ? part.error : new Error(String(part.error)));
          break;
      }
    }

    const usage = await result.usage;
    const text = await result.text;
    callbacks.onFinish(text, usage);
  } catch (err) {
    callbacks.onError(err instanceof Error ? err : new Error(String(err)));
  }
}
