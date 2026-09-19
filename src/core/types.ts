// Общие типы KrashCode

export type Role = 'user' | 'assistant' | 'tool';

export interface ChatMessage {
  id: string;
  role: Role;
  content: string;
  toolCalls?: ToolCallInfo[];
  toolResults?: ToolResultInfo[];
  createdAt: number;
}

export interface ToolCallInfo {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface ToolResultInfo {
  id: string;
  name: string;
  result: string;
  isError?: boolean;
}

export interface SessionMeta {
  id: string;
  title: string;
  cwd: string;
  model: string;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface SessionData {
  meta: SessionMeta;
  messages: ChatMessage[];
}

export interface KrashConfig {
  provider: 'openai' | 'anthropic' | 'google' | 'openrouter' | 'custom';
  baseUrl?: string;
  apiKey?: string;
  keyEnv?: string;
  model: string;
  maxTokens: number;
  language: 'ru' | 'en';
}

export const DEFAULT_CONFIG: KrashConfig = {
  provider: 'openai',
  model: 'gpt-4o-mini',
  maxTokens: 4096,
  language: 'ru',
};
