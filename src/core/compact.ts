import { generateText, type LanguageModel, type ModelMessage } from 'ai';

// Сколько последних сообщений всегда оставляем нетронутыми.
const KEEP_RECENT = 6;
const SUMMARY_MAX_TOKENS = 1024;

const SYSTEM_SUMMARIZE =
  'You are summarizing a coding conversation so another agent can continue the work. ' +
  'Extract and preserve ONLY: concrete requirements, user preferences, files changed, ' +
  'commands run and their results, errors encountered, decisions made, and unfinished work. ' +
  'Be terse and factual. No greetings, no chain-of-thought, no step-by-step narration. ' +
  'Use sections: Requirements; Changes made; Verification (commands + pass/fail); ' +
  'Decisions; Remaining work. Do not keep secrets or credentials. Return only the summary.';

export interface CompactResult {
  history: ModelMessage[];
  compacted: boolean;
  removed: number;
}

/**
 * Заменяет старые сообщения кратким машинным резюме, оставляя KEEP_RECENT
 * последних. Требования KitCode: сохранить смысл, отрезать шум.
 */
// Точка разреза истории. Начинаем с «оставить KEEP_RECENT последних», затем
// сдвигаем вперёд, пока recent начинается с tool-сообщения: его tool-call ушёл
// бы в текстовое резюме, а осиротевший tool-result ломает следующий запрос к
// провайдеру (400: нет парного tool_call_id). Возвращает -1, если сжимать нечего.
export function safeCutIndex(history: ModelMessage[]): number {
  let cut = history.length - KEEP_RECENT;
  while (cut < history.length && history[cut]?.role === 'tool') {
    cut += 1;
  }
  if (cut >= history.length || cut <= 1) return -1;
  return cut;
}

export async function compactHistory(
  model: LanguageModel,
  history: ModelMessage[],
  signal?: AbortSignal,
): Promise<CompactResult> {
  if (history.length <= KEEP_RECENT + 2) {
    return { history, compacted: false, removed: 0 };
  }

  const cut = safeCutIndex(history);
  if (cut < 0) {
    return { history, compacted: false, removed: 0 };
  }

  const older = history.slice(0, cut);
  const recent = history.slice(cut);

  const rendered = renderForSummary(older);
  if (!rendered.trim()) return { history, compacted: false, removed: 0 };

  const { text } = await generateText({
    model,
    system: SYSTEM_SUMMARIZE,
    prompt: rendered,
    maxOutputTokens: SUMMARY_MAX_TOKENS,
    abortSignal: signal,
  });

  const summary = text.trim();
  if (!summary) return { history, compacted: false, removed: 0 };

  const prefix: ModelMessage[] = [
    { role: 'user', content: `[Резюме предыдущего диалога]\n${summary}` },
    { role: 'assistant', content: 'Контекст загружен. Продолжаю с этого резюме.' },
  ];

  return { history: [...prefix, ...recent], compacted: true, removed: cut };
}

// Порог автосжатия: примерно по числу токенов, оценённых грубо по символам.
export function shouldAutoCompact(estimatedTokens: number, maxContext: number): boolean {
  return maxContext > 0 && estimatedTokens / maxContext >= 0.8;
}

// Грубая оценка числа токенов в истории по объёму символов (~4 симв/токен).
// Достаточно для решения «пора ли сжимать», точный учёт делает провайдер.
export function estimateTokens(messages: ModelMessage[]): number {
  let chars = 0;
  for (const message of messages) {
    if (typeof message.content === 'string') {
      chars += message.content.length;
    } else {
      for (const part of message.content) {
        if (part.type === 'text') chars += part.text.length;
        else if (part.type === 'tool-call') chars += JSON.stringify(part.input ?? '').length + 32;
        else if (part.type === 'tool-result') chars += JSON.stringify(part.output ?? '').length + 32;
        else chars += 16;
      }
    }
  }
  return Math.ceil(chars / 4);
}

function renderForSummary(messages: ModelMessage[]): string {
  return messages
    .map((message) => {
      const role = message.role.toUpperCase();
      const content =
        typeof message.content === 'string'
          ? message.content
          : message.content
              .map((part) => {
                if (part.type === 'text') return part.text;
                if (part.type === 'tool-call') return `[tool: ${part.toolName}]`;
                if (part.type === 'tool-result') return `[tool result]`;
                return '';
              })
              .filter(Boolean)
              .join('\n');
      return content.trim() ? `${role}:\n${truncate(content, 2000)}` : '';
    })
    .filter(Boolean)
    .join('\n\n');
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  const keep = Math.floor(max * 0.4);
  return `${text.slice(0, max - keep)}\n...\n${text.slice(-keep)}`;
}
