import {
  streamText,
  stepCountIs,
  type JSONValue,
  type LanguageModel,
  type ModelMessage,
  type ToolSet,
} from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { resolveApiKey } from './config.js';
import { DEFAULT_BASE_URL, type AuthFile, type Effort, type KrashConfig } from './types.js';

const MAX_STEPS = 24;

// Структурно совпадает с ProviderOptions из AI SDK (Record провайдер→опции),
// но берётся из публичного JSONValue, чтобы не тянуть внутренний тип SDK.
type ProviderOptions = Record<string, Record<string, JSONValue>>;

// ── Усилия рассуждения → параметры провайдера ────────────────────────────────
// Vercel AI SDK принимает reasoning_effort через providerOptions.openai, а
// extended thinking Anthropic — через providerOptions.anthropic.thinking.
// planReasoning решает, что и кому отправить, исходя из эффективного протокола
// и модели. auto — ничего не навязываем (поведение провайдера по умолчанию).

// OpenAI reasoning-модели (только они принимают reasoning_effort; gpt-4o и т.п.
// на этот параметр ругаются, поэтому для них ничего не шлём).
const OPENAI_REASONING = /^(?:o[134](?:-|$)|gpt-5(?:[.-]|$)|gpt-6(?:[.-]|$))/;

// Бюджет токенов на размышление для Anthropic по уровням. Минимум Anthropic —
// 1024; все значения выше. max_tokens при этом должен превышать бюджет — это
// учитывается в planReasoning (поднимаем maxOutputTokens под бюджет + ответ).
const ANTHROPIC_BUDGET: Record<Exclude<Effort, 'auto'>, number> = {
  low: 2048,
  medium: 4096,
  high: 8192,
  xhigh: 16384,
  max: 32768,
};

export interface ReasoningPlan {
  providerOptions?: ProviderOptions;
  maxOutputTokens: number;
}

// Эффективный протокол модели: как реально общаемся с провайдером.
function effectiveProtocol(config: KrashConfig): 'openai' | 'anthropic' | 'google' | 'other' {
  switch (config.provider) {
    case 'anthropic':
      return 'anthropic';
    case 'google':
      return 'google';
    case 'openai':
    case 'openrouter':
      return 'openai';
    case 'custom':
      return config.protocol === 'anthropic' ? 'anthropic' : 'openai';
  }
}

// Приводит уровень к enum reasoning_effort. Прокидываем как есть — SDK принимает
// low/medium/high/xhigh/max; на моделях, где старшие уровни не поддержаны,
// провайдер сам их приравняет к максимальному доступному.
function openAiReasoningEffort(effort: Exclude<Effort, 'auto'>): string {
  return effort;
}

export function planReasoning(config: KrashConfig, model: string, maxOutputTokens: number): ReasoningPlan {
  if (config.effort === 'auto') return { maxOutputTokens };
  const effort = config.effort;
  const protocol = effectiveProtocol(config);

  if (protocol === 'openai') {
    const id = model.split('/').at(-1) ?? model;
    if (!OPENAI_REASONING.test(id)) return { maxOutputTokens };
    return {
      providerOptions: { openai: { reasoningEffort: openAiReasoningEffort(effort) } },
      maxOutputTokens,
    };
  }

  if (protocol === 'anthropic') {
    const budget = ANTHROPIC_BUDGET[effort];
    // max_tokens обязан быть больше бюджета размышления; оставляем ≥4k на сам
    // ответ. Не уменьшаем уже заданный пользователем предел, только поднимаем.
    const effMax = Math.max(maxOutputTokens, budget + 4096);
    return {
      providerOptions: { anthropic: { thinking: { type: 'enabled', budgetTokens: budget } } },
      maxOutputTokens: effMax,
    };
  }

  // google/other — свой механизм рассуждения либо его нет; ничего не шлём.
  return { maxOutputTokens };
}

export function createModel(config: KrashConfig, auth: AuthFile = {}): LanguageModel {
  const apiKey = resolveApiKey(config, auth);

  switch (config.provider) {
    case 'anthropic':
      return createAnthropic({ apiKey })(config.model);
    case 'google':
      return createGoogleGenerativeAI({ apiKey })(config.model);
    case 'openrouter':
      return createOpenAI({
        apiKey: apiKey || 'local',
        baseURL: config.baseUrl ?? DEFAULT_BASE_URL.openrouter,
      }).chat(config.model);
    case 'custom': {
      const baseURL = config.baseUrl ?? DEFAULT_BASE_URL.custom;
      // Некоторые кастомные гейтвеи говорят по Anthropic-протоколу (/v1/messages),
      // а не OpenAI (/chat/completions). Протокол определяется при подключении и
      // хранится в конфиге; по умолчанию считаем OpenAI-совместимым.
      if (config.protocol === 'anthropic') {
        return createAnthropic({ apiKey: apiKey || 'local', baseURL })(config.model);
      }
      return createOpenAI({ apiKey: apiKey || 'local', baseURL }).chat(config.model);
    }
    case 'openai':
    default:
      return createOpenAI({ apiKey })(config.model);
  }
}

export interface StepUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface AgentCallbacks {
  onTextDelta(delta: string): void;
  onReasoningDelta?(delta: string): void;
  onToolCall(id: string, name: string, args: Record<string, unknown>): void;
  onToolResult(id: string, name: string, result: string, isError: boolean): void;
  // Вызывается после каждого шага: новые сообщения + токены этого шага.
  // Учёт по шагам, а не только в конце, чтобы прерванный ход всё равно считался.
  onStep(messages: ModelMessage[], usage: StepUsage): void | Promise<void>;
  onFinish(text: string): void;
  onError(error: Error): void;
}

export interface RunAgentOptions {
  model: LanguageModel;
  system: string;
  messages: ModelMessage[];
  tools: ToolSet;
  maxOutputTokens: number;
  providerOptions?: ProviderOptions;
  signal?: AbortSignal;
}

export async function runAgent(options: RunAgentOptions, callbacks: AgentCallbacks): Promise<void> {
  const { model, system, messages, tools, maxOutputTokens, providerOptions, signal } = options;

  try {
    const result = streamText({
      model,
      system,
      messages,
      tools,
      stopWhen: stepCountIs(MAX_STEPS),
      maxOutputTokens,
      providerOptions,
      abortSignal: signal,
      onStepFinish: async (step) => {
        await callbacks.onStep(step.response.messages, {
          inputTokens: step.usage.inputTokens ?? 0,
          outputTokens: step.usage.outputTokens ?? 0,
        });
      },
    });

    for await (const part of result.fullStream) {
      if (signal?.aborted) return;
      switch (part.type) {
        case 'text-delta':
          callbacks.onTextDelta(part.text);
          break;
        case 'reasoning-delta':
          callbacks.onReasoningDelta?.(part.text);
          break;
        case 'tool-call':
          callbacks.onToolCall(
            part.toolCallId,
            part.toolName,
            part.input as Record<string, unknown>,
          );
          break;
        case 'tool-result':
          callbacks.onToolResult(
            part.toolCallId,
            part.toolName,
            typeof part.output === 'string' ? part.output : JSON.stringify(part.output),
            false,
          );
          break;
        case 'tool-error':
          callbacks.onToolResult(
            part.toolCallId,
            part.toolName,
            String(part.error),
            true,
          );
          break;
        case 'error':
          throw part.error instanceof Error ? part.error : new Error(String(part.error));
      }
    }

    if (signal?.aborted) return;
    // Токены уже учтены пошагово через onStep — здесь отдаём только финальный текст.
    const text = await result.text;
    callbacks.onFinish(text);
  } catch (err) {
    if (signal?.aborted) return;
    callbacks.onError(err instanceof Error ? err : new Error(String(err)));
  }
}
