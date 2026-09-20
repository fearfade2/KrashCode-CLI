import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  authSchema,
  configSchema,
  CONVENTIONAL_KEY_ENV,
  defaultConfig,
  type AuthFile,
  type KrashConfig,
  type ProviderKind,
} from './types.js';

const CONFIG_DIR = process.env.KRASHCODE_HOME || join(homedir(), '.krashcode');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');
const AUTH_FILE = join(CONFIG_DIR, 'auth.json');
const SESSIONS_DIR = join(CONFIG_DIR, 'sessions');
const MEMORY_DIR = join(CONFIG_DIR, 'memory');

export function getConfigDir(): string {
  return CONFIG_DIR;
}
export function getConfigFile(): string {
  return CONFIG_FILE;
}
export function getSessionsDir(): string {
  return SESSIONS_DIR;
}
export function getMemoryDir(): string {
  return MEMORY_DIR;
}

export async function ensureConfigDir(): Promise<void> {
  await mkdir(CONFIG_DIR, { recursive: true, mode: 0o700 });
  await chmod(CONFIG_DIR, 0o700).catch(() => undefined);
  await mkdir(SESSIONS_DIR, { recursive: true });
}

export async function loadConfig(): Promise<KrashConfig> {
  // Битый JSON не должен ронять/вешать запуск — читаем терпимо к ошибкам.
  const raw = await readJsonSafe(CONFIG_FILE);
  if (raw === undefined || typeof raw !== 'object' || raw === null) return defaultConfig();

  const parsed = configSchema.safeParse(raw);
  if (parsed.success) return parsed.data;

  // Не теряем ВЕСЬ конфиг из-за одного плохого поля: выкидываем только те
  // верхнеуровневые ключи, что не прошли валидацию, остальное берём как есть
  // (недостающее дополнится дефолтами схемы).
  const cleaned: Record<string, unknown> = { ...(raw as Record<string, unknown>) };
  for (const issue of parsed.error.issues) {
    const key = issue.path[0];
    if (typeof key === 'string') delete cleaned[key];
  }
  const retry = configSchema.safeParse(cleaned);
  return retry.success ? retry.data : defaultConfig();
}

let configWrites: Promise<void> = Promise.resolve();
export function saveConfig(config: KrashConfig): Promise<void> {
  const snapshot = configSchema.parse(config);
  const write = configWrites.catch(() => undefined).then(async () => {
    await ensureConfigDir();
    await writeJsonAtomic(CONFIG_FILE, snapshot);
  });
  configWrites = write;
  return write;
}

// ── Ключи хранятся отдельно, с правами 0600 ──────────────────────────────────

export async function loadAuth(): Promise<AuthFile> {
  const raw = await readJsonSafe(AUTH_FILE);
  if (raw === undefined) return {};
  const parsed = authSchema.safeParse(raw);
  return parsed.success ? (parsed.data as AuthFile) : {};
}

export async function saveAuth(auth: AuthFile): Promise<void> {
  await ensureConfigDir();
  await writeJsonAtomic(AUTH_FILE, auth, 0o600);
}

export async function setApiKey(provider: ProviderKind, key: string): Promise<void> {
  const auth = await loadAuth();
  auth[provider] = key;
  await saveAuth(auth);
}

/**
 * Ключ ищется в порядке: keyEnv из конфига → сохранённый auth.json →
 * стандартная переменная окружения провайдера.
 */
export function resolveApiKey(config: KrashConfig, auth: AuthFile = {}): string {
  const candidates = [
    config.keyEnv ? process.env[config.keyEnv] : undefined,
    auth[config.provider],
    process.env[CONVENTIONAL_KEY_ENV[config.provider]],
  ];
  return candidates.find((v) => v !== undefined && v !== '') ?? '';
}

// ── Утилиты чтения/записи ────────────────────────────────────────────────────

async function readJson(file: string): Promise<unknown> {
  let text: string;
  try {
    text = await readFile(file, 'utf-8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${file} is not valid JSON: ${(error as Error).message}`);
  }
}

// Как readJson, но битый JSON не бросает исключение, а возвращает undefined —
// чтобы повреждённый config.json/auth.json не вешал запуск на экране загрузки.
async function readJsonSafe(file: string): Promise<unknown> {
  try {
    return await readJson(file);
  } catch {
    return undefined;
  }
}

async function writeJsonAtomic(file: string, value: unknown, mode = 0o644): Promise<void> {
  const temp = `${file}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf-8', mode });
    await rename(temp, file);
    await chmod(file, mode).catch(() => undefined);
  } catch (error) {
    await import('node:fs/promises').then((fs) => fs.rm(temp, { force: true })).catch(() => undefined);
    throw error;
  }
}
