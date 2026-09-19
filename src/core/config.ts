import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_CONFIG, type KrashConfig } from './types.js';

const CONFIG_DIR = join(homedir(), '.krashcode');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');
const SESSIONS_DIR = join(CONFIG_DIR, 'sessions');

export function getConfigDir(): string {
  return CONFIG_DIR;
}

export function getSessionsDir(): string {
  return SESSIONS_DIR;
}

export async function ensureConfigDir(): Promise<void> {
  await mkdir(CONFIG_DIR, { recursive: true });
  await mkdir(SESSIONS_DIR, { recursive: true });
}

export async function loadConfig(): Promise<KrashConfig> {
  try {
    const raw = await readFile(CONFIG_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<KrashConfig>;
    return { ...DEFAULT_CONFIG, ...parsed };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export async function saveConfig(config: KrashConfig): Promise<void> {
  await ensureConfigDir();
  await writeFile(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
}

/** Получить API-ключ: из конфига, из env, или пустую строку */
export function resolveApiKey(config: KrashConfig): string {
  if (config.apiKey) return config.apiKey;
  if (config.keyEnv) return process.env[config.keyEnv] ?? '';
  // Стандартные переменные окружения
  const envMap: Record<string, string> = {
    openai: 'OPENAI_API_KEY',
    anthropic: 'ANTHROPIC_API_KEY',
    google: 'GOOGLE_GENERATIVE_AI_API_KEY',
    openrouter: 'OPENROUTER_API_KEY',
    custom: 'API_KEY',
  };
  return process.env[envMap[config.provider] ?? 'API_KEY'] ?? '';
}
