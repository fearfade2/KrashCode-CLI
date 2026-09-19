export interface SlashCommand {
  name: string;
  args?: string;
  description: string;
}

export const COMMANDS: SlashCommand[] = [
  { name: 'provider', description: 'Провайдер, модель и ключ (в т.ч. свой)' },
  { name: 'model', args: '[name]', description: 'Сменить модель' },
  { name: 'mode', args: '[normal|accept|plan]', description: 'Режим работы' },
  { name: 'effort', args: '[auto|low|medium|high|xhigh|max]', description: 'Усилия рассуждения' },
  { name: 'compact', description: 'Сжать старый контекст' },
  { name: 'memory', args: '[set|clear]', description: 'Заметки проекта' },
  { name: 'sessions', description: 'Возобновить сессию' },
  { name: 'bypass', description: 'Вкл/выкл подтверждения' },
  { name: 'config', description: 'Показать конфиг' },
  { name: 'usage', description: 'Токены и стоимость' },
  { name: 'clear', description: 'Новая сессия' },
  { name: 'help', description: 'Показать помощь' },
  { name: 'exit', description: 'Выйти' },
];

export function matchCommands(line: string): SlashCommand[] {
  if (!line.startsWith('/')) return [];
  const token = line.slice(1).toLowerCase();
  if (token === '') return COMMANDS;

  const starts = COMMANDS.filter((c) => c.name.startsWith(token));
  if (starts.length > 0) return starts;

  const contains = COMMANDS.filter((c) => c.name.includes(token));
  if (contains.length > 0) return contains;

  return COMMANDS.filter((c) => isSubsequence(token, c.name));
}

export function closestCommand(name: string): SlashCommand | undefined {
  const needle = name.toLowerCase();
  let best: SlashCommand | undefined;
  let bestScore = Infinity;
  for (const cmd of COMMANDS) {
    const d = editDistance(needle, cmd.name);
    if (d < bestScore) { bestScore = d; best = cmd; }
  }
  return bestScore <= Math.max(2, Math.floor(needle.length / 2)) ? best : undefined;
}

function isSubsequence(needle: string, haystack: string): boolean {
  let i = 0;
  for (const ch of haystack) {
    if (ch === needle[i]) i++;
    if (i === needle.length) return true;
  }
  return needle.length === 0;
}

function editDistance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const curr = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min((curr[j - 1] ?? 0) + 1, (prev[j] ?? 0) + 1, (prev[j - 1] ?? 0) + cost);
    }
    prev = curr;
  }
  return prev[b.length] ?? 0;
}
