import { z } from 'zod';
import type { ModelMessage } from 'ai';

// ── Разрешения и режимы ──────────────────────────────────────────────────────

export type PermissionMode = 'allow' | 'ask' | 'deny';
export type AgentMode = 'normal' | 'accept' | 'plan';
export const MODES: AgentMode[] = ['normal', 'accept', 'plan'];

// ── Сообщения в UI ───────────────────────────────────────────────────────────

export type Role = 'user' | 'assistant';

export interface ToolCallInfo {
  id: string;
  name: string;
  args: Record<string, unknown>;
  result?: string;
  isError?: boolean;
}

export interface ChatMessage {
  id: string;
  role: Role;
  content: string;
  reasoning?: string;
  toolCalls?: ToolCallInfo[];
  createdAt?: number;
}

// ── Сессии ───────────────────────────────────────────────────────────────────

export interface SessionMeta {
  id: string;
  title: string;
  cwd: string;
  model: string;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface UsageTotals {
  inputTokens: number;
  outputTokens: number;
  requests: number;
  costUsd: number | null;
}

export interface SessionData {
  meta: SessionMeta;
  history: ModelMessage[];
  messages: ChatMessage[];
  usage?: UsageTotals;
}

// ── Конфигурация (валидируется через zod) ────────────────────────────────────

export const providerKindSchema = z.enum([
  'openai',
  'anthropic',
  'google',
  'openrouter',
  'custom',
]);
export type ProviderKind = z.infer<typeof providerKindSchema>;

export const agentModeSchema = z.enum(['normal', 'accept', 'plan']);
export const permissionModeSchema = z.enum(['allow', 'ask', 'deny']);
export const langSchema = z.enum(['ru', 'en']);

export const providerProtocolSchema = z.enum(['openai', 'anthropic']);
export type ProviderProtocol = z.infer<typeof providerProtocolSchema>;

// Уровень «усилий» рассуждения. auto — не навязываем провайдеру ничего (его
// поведение по умолчанию). Остальные включают reasoning_effort (OpenAI) или
// extended thinking с бюджетом токенов (Anthropic).
export const effortSchema = z.enum(['auto', 'low', 'medium', 'high', 'xhigh', 'max']);
export type Effort = z.infer<typeof effortSchema>;
export const EFFORTS: Effort[] = ['auto', 'low', 'medium', 'high', 'xhigh', 'max'];

export const configSchema = z.object({
  version: z.literal(1).default(1),
  provider: providerKindSchema.default('openai'),
  baseUrl: z.string().url().optional(),
  // Для custom-эндпоинта: каким протоколом он реально говорит. Определяется
  // автоматически при подключении (OpenAI-совместимый vs Anthropic Messages).
  protocol: providerProtocolSchema.optional(),
  keyEnv: z.string().optional(),
  model: z.string().default('gpt-4o-mini'),
  // Усилия рассуждения (reasoning_effort / extended thinking). auto — по умолчанию.
  effort: effortSchema.default('auto'),
  maxTokens: z.number().int().positive().max(200_000).default(8192),
  maxTokensPerTurn: z.number().int().min(0).max(20_000_000).default(2_000_000),
  // Порог контекста модели: при превышении доли от него история авто-сжимается.
  maxContextTokens: z.number().int().positive().max(10_000_000).default(128_000),
  autoCompact: z.boolean().default(true),
  language: langSchema.default('ru'),
  mode: agentModeSchema.default('normal'),
  autoDiagnostics: z.boolean().default(true),
  // Точечные переопределения разрешений по имени инструмента.
  permissions: z.record(z.string(), permissionModeSchema).default({}),
});

export type KrashConfig = z.infer<typeof configSchema>;

export function defaultConfig(): KrashConfig {
  return configSchema.parse({});
}

// Хранилище API-ключей отдельно от конфига: { [provider]: key }.
// z.record с enum-ключом в zod v4 делает все ключи обязательными, поэтому
// используем строковый ключ и валидируем провайдер отдельно при чтении.
export const authSchema = z.record(z.string(), z.string());
export type AuthFile = Partial<Record<ProviderKind, string>>;

export const CONVENTIONAL_KEY_ENV: Record<ProviderKind, string> = {
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  google: 'GOOGLE_GENERATIVE_AI_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  custom: 'API_KEY',
};

export const DEFAULT_BASE_URL: Partial<Record<ProviderKind, string>> = {
  openrouter: 'https://openrouter.ai/api/v1',
  custom: 'http://localhost:11434/v1',
};

// ── Приблизительный прайсинг (USD за 1M токенов) для оценки стоимости ─────────
// Ключ — подстрока id модели. Известные модели считаем точно, остальные — null.
export interface ModelPricing {
  input: number;
  output: number;
}

export const PRICING: Record<string, ModelPricing> = {
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'gpt-4o': { input: 2.5, output: 10 },
  'gpt-4.1-mini': { input: 0.4, output: 1.6 },
  'gpt-4.1': { input: 2, output: 8 },
  'o4-mini': { input: 1.1, output: 4.4 },
  'gpt-5-mini': { input: 0.25, output: 2 },
  'gpt-5': { input: 1.25, output: 10 },
  'claude-3-5-haiku': { input: 0.8, output: 4 },
  'claude-3-5-sonnet': { input: 3, output: 15 },
  'claude-3-7-sonnet': { input: 3, output: 15 },
  'claude-sonnet-4': { input: 3, output: 15 },
  'claude-opus-4': { input: 15, output: 75 },
  'gemini-2.0-flash': { input: 0.1, output: 0.4 },
  'gemini-2.5-flash': { input: 0.3, output: 2.5 },
  'gemini-2.5-pro': { input: 1.25, output: 10 },
};

// Популярные модели по провайдерам — чтобы /model без аргумента предлагал выбор,
// как /mode. Список — подсказка, а не ограничение: можно ввести любой id вручную.
export const MODEL_SUGGESTIONS: Record<ProviderKind, string[]> = {
  openai: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini', 'gpt-4.1', 'gpt-5-mini', 'gpt-5', 'o4-mini'],
  anthropic: [
    'claude-3-5-haiku-latest',
    'claude-3-5-sonnet-latest',
    'claude-3-7-sonnet-latest',
    'claude-sonnet-4-20250514',
    'claude-opus-4-20250514',
  ],
  google: ['gemini-2.0-flash', 'gemini-2.5-flash', 'gemini-2.5-pro'],
  openrouter: [
    'openai/gpt-4o-mini',
    'openai/gpt-4o',
    'anthropic/claude-3.7-sonnet',
    'google/gemini-2.5-flash',
    'meta-llama/llama-3.3-70b-instruct',
  ],
  custom: ['llama3', 'qwen2.5-coder', 'deepseek-r1'],
};

export function pricingFor(model: string): ModelPricing | undefined {
  const id = model.toLowerCase();
  // Прямое или частичное совпадение по подстроке.
  for (const [key, price] of Object.entries(PRICING)) {
    if (id.includes(key)) return price;
  }
  return undefined;
}
