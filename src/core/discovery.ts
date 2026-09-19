import { DEFAULT_BASE_URL, type ProviderKind, type ProviderProtocol } from './types.js';

// Автообнаружение моделей прямо у провайдера — как в KitCode: бьём в его
// "list models" эндпоинт и парсим ответ. Для custom-эндпоинтов ещё и определяем
// ПРОТОКОЛ (OpenAI-совместимый `/chat/completions` vs Anthropic `/v1/messages`),
// потому что часть гейтвеев Anthropic-нативные и OpenAI-формат у них не работает.
// Форматы ответа:
//   • OpenAI-совместимый  → { data: [{ id, ... }] }
//   • Anthropic           → { data: [{ id, display_name }] }
//   • Google Generative   → { models: [{ name: "models/…", inputTokenLimit }] }
// Сеть/парсинг обёрнуты так, чтобы UI мог спокойно откатиться к статичным
// подсказкам: ошибки не роняют приложение, а возвращаются в outcome.error.

export interface DiscoveredModel {
  id: string;
  contextWindow?: number;
}

export interface DiscoveryOutcome {
  models: DiscoveredModel[];
  // Заполняются только для custom: определённый протокол и рабочий base URL
  // (тот, что реально ответил — например с дописанным /v1).
  protocol?: ProviderProtocol;
  baseUrl?: string;
  error?: string;
}

const DETECT_TIMEOUT_MS = 12_000;
const MAX_BODY_BYTES = 5_000_000;

interface Endpoint {
  url: string;
  headers: Record<string, string>;
}

/**
 * Забирает доступные модели у провайдера. Никогда не бросает: при неудаче
 * возвращает пустой список и текст ошибки (с вырезанным ключом) в error.
 */
export async function discoverModels(
  provider: ProviderKind,
  baseUrl: string | undefined,
  apiKey: string,
  opts: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<DiscoveryOutcome> {
  const timeoutMs = opts.timeoutMs ?? DETECT_TIMEOUT_MS;

  // custom — единственный, где неизвестны и путь, и протокол: пробуем схемы
  // авторизации и кандидаты URL, определяем протокол по ответу.
  if (provider === 'custom') {
    return discoverCustom(baseUrl, apiKey, timeoutMs, opts.signal);
  }

  const endpoint = fixedEndpoint(provider, baseUrl, apiKey);
  try {
    const body = await probe(endpoint, timeoutMs, opts.signal);
    return { models: filterModels(provider, parseModels(provider, body)) };
  } catch (error) {
    return { models: [], error: redact(describe(error), apiKey) };
  }
}

// ── custom: перебор схем авторизации + определение протокола ──────────────────

interface Scheme {
  protocol: ProviderProtocol;
  headers(key: string): Record<string, string>;
}

// Сначала OpenAI-схема (Bearer), затем Anthropic (x-api-key). Первый непустой
// список моделей выигрывает; протокол берём из победившей схемы/тела ответа.
const CUSTOM_SCHEMES: Scheme[] = [
  {
    protocol: 'openai',
    headers: (k): Record<string, string> => (k ? { Authorization: `Bearer ${k}` } : {}),
  },
  {
    protocol: 'anthropic',
    headers: (k): Record<string, string> =>
      k ? { 'x-api-key': k, 'anthropic-version': '2023-06-01' } : { 'anthropic-version': '2023-06-01' },
  },
];

async function discoverCustom(
  baseUrl: string | undefined,
  key: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<DiscoveryOutcome> {
  const root = trimSlash(baseUrl ?? DEFAULT_BASE_URL.custom!);
  const bases = root.endsWith('/v1') ? [root] : [root, `${root}/v1`];
  let lastError = '';

  for (const scheme of CUSTOM_SCHEMES) {
    for (const base of bases) {
      try {
        const body = await probe({ url: `${base}/models`, headers: scheme.headers(key) }, timeoutMs, signal);
        const models = filterModels('custom', parseModels('custom', body));
        if (models.length > 0) {
          return { models, protocol: detectProtocol(scheme.protocol, body), baseUrl: base };
        }
      } catch (error) {
        lastError = redact(describe(error), key);
      }
    }
  }
  return { models: [], error: lastError || undefined };
}

// Протокол: если сам ответ пришёл на Anthropic-схему — точно anthropic. Иначе
// смотрим, что модель советует (supported_endpoint_types / owned_by): гейтвей,
// где КАЖДАЯ модель говорит "anthropic" — Anthropic-нативный, даже если заодно
// принимает и openai-вызовы (на практике те часто не работают).
function detectProtocol(scheme: ProviderProtocol, body: unknown): ProviderProtocol {
  if (scheme === 'anthropic') return 'anthropic';
  return advertisesAnthropic(body) ? 'anthropic' : 'openai';
}

function advertisesAnthropic(body: unknown): boolean {
  const entries = modelEntries(body);
  if (entries.length === 0) return false;
  const advertised = entries.map((e) => stringList(e['supported_endpoint_types']));
  if (advertised.some((types) => types.length > 0)) {
    return advertised.every((types) => types.includes('anthropic'));
  }
  if (entries.some((e) => typeof e['id'] === 'string' && (e['id'] as string).includes('/'))) return false;
  return entries.every((e) => e['owned_by'] === 'anthropic');
}

// ── Фиксированные эндпоинты для известных провайдеров ─────────────────────────

function fixedEndpoint(provider: Exclude<ProviderKind, 'custom'>, baseUrl: string | undefined, key: string): Endpoint {
  const bearer: Record<string, string> = key ? { Authorization: `Bearer ${key}` } : {};
  switch (provider) {
    case 'openai':
      return { url: 'https://api.openai.com/v1/models', headers: bearer };
    case 'anthropic':
      return {
        url: 'https://api.anthropic.com/v1/models?limit=1000',
        headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      };
    case 'google':
      return {
        url: 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000',
        headers: key ? { 'x-goog-api-key': key } : {},
      };
    case 'openrouter': {
      const root = trimSlash(baseUrl ?? DEFAULT_BASE_URL.openrouter!);
      return { url: `${root}/models`, headers: bearer };
    }
  }
}

// ── Разбор ответа ─────────────────────────────────────────────────────────────

function parseModels(provider: ProviderKind, body: unknown): DiscoveredModel[] {
  const list = modelArray(body);
  const out: DiscoveredModel[] = [];
  for (const entry of list) {
    if (typeof entry !== 'object' || entry === null) continue;
    const raw = entry as Record<string, unknown>;
    const id = extractId(provider, raw);
    if (!id) continue;
    const model: DiscoveredModel = { id };
    const ctx = contextWindow(raw);
    if (ctx !== undefined) model.contextWindow = ctx;
    out.push(model);
  }
  return out;
}

// Ответ может быть { data: [...] } (OpenAI/Anthropic), { models: [...] } (Google)
// или голым массивом.
function modelArray(body: unknown): unknown[] {
  if (Array.isArray(body)) return body;
  if (typeof body !== 'object' || body === null) return [];
  const record = body as Record<string, unknown>;
  if (Array.isArray(record.data)) return record.data;
  if (Array.isArray(record.models)) return record.models;
  return [];
}

function modelEntries(body: unknown): Record<string, unknown>[] {
  return modelArray(body).filter(
    (e): e is Record<string, unknown> => typeof e === 'object' && e !== null,
  );
}

function extractId(provider: ProviderKind, raw: Record<string, unknown>): string {
  // Google отдаёт name = "models/gemini-1.5-pro" — приводим к чистому id.
  if (provider === 'google' && typeof raw.name === 'string' && raw.name) {
    return raw.name.replace(/^models\//, '');
  }
  if (typeof raw.id === 'string' && raw.id) return raw.id;
  if (typeof raw.name === 'string' && raw.name) return raw.name;
  return '';
}

function contextWindow(raw: Record<string, unknown>): number | undefined {
  const top = raw.top_provider as { context_length?: unknown } | null | undefined;
  return (
    positiveInt(raw.context_length) ??
    positiveInt(raw.context_window) ??
    positiveInt(raw.max_model_len) ??
    positiveInt(raw.max_context_length) ??
    positiveInt(raw.inputTokenLimit) ??
    positiveInt(top?.context_length)
  );
}

// Для OpenAI /models возвращает и не-чатовые модели (embeddings, tts, whisper,
// dall-e…) — отсеиваем очевидный шум, чтобы список выбора был по делу. Нужную
// модель всегда можно ввести вручную. Прочие провайдеры не фильтруем.
const OPENAI_NON_CHAT = /embedding|whisper|tts|audio|dall-?e|moderation|image|transcribe|realtime|search|similarity|davinci|babbage|codex-mini/i;

function filterModels(provider: ProviderKind, models: DiscoveredModel[]): DiscoveredModel[] {
  const filtered =
    provider === 'openai' ? models.filter((m) => !OPENAI_NON_CHAT.test(m.id)) : models;
  const seen = new Set<string>();
  const unique = filtered.filter((m) => (seen.has(m.id) ? false : (seen.add(m.id), true)));
  unique.sort((a, b) => a.id.localeCompare(b.id));
  return unique;
}

// ── Сеть ──────────────────────────────────────────────────────────────────────

async function probe(endpoint: Endpoint, timeoutMs: number, signal?: AbortSignal): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`тайм-аут ${Math.round(timeoutMs / 1000)}s`)), timeoutMs);
  const onAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', onAbort, { once: true });
  }
  try {
    const res = await fetch(endpoint.url, {
      method: 'GET',
      headers: { Accept: 'application/json', ...endpoint.headers },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await boundedText(res);
    return JSON.parse(text);
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onAbort);
  }
}

async function boundedText(res: Response): Promise<string> {
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    await res.body?.cancel().catch(() => undefined);
    throw new Error('ответ слишком большой');
  }
  if (!res.body) return '';
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_BODY_BYTES) throw new Error('ответ слишком большой');
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    void reader.cancel().catch(() => undefined);
  }
}

// ── Утилиты ─────────────────────────────────────────────────────────────────

function trimSlash(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

function positiveInt(value: unknown): number | undefined {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isFinite(n)) return undefined;
  const int = Math.trunc(n);
  return int >= 1 ? int : undefined;
}

function describe(error: unknown): string {
  if (error instanceof Error) {
    const cause = error.cause instanceof Error ? ` (${error.cause.message})` : '';
    return `${error.message}${cause}`;
  }
  return String(error);
}

function redact(text: string, key: string): string {
  return key && key.length >= 6 ? text.split(key).join('[ключ]') : text;
}
