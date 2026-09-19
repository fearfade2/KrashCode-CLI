import { pricingFor, type UsageTotals } from './types.js';

export function emptyUsage(): UsageTotals {
  return { inputTokens: 0, outputTokens: 0, requests: 0, costUsd: 0 };
}

// Аккумулирует токены и считает стоимость по известному прайсингу.
export function addUsage(
  totals: UsageTotals,
  model: string,
  inputTokens: number,
  outputTokens: number,
): UsageTotals {
  const pricing = pricingFor(model);
  const requestCost = pricing
    ? (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000
    : null;
  const costUsd =
    requestCost === null
      ? totals.costUsd // неизвестная модель не ломает уже накопленную стоимость
      : (totals.costUsd ?? 0) + requestCost;
  return {
    inputTokens: totals.inputTokens + inputTokens,
    outputTokens: totals.outputTokens + outputTokens,
    requests: totals.requests + 1,
    costUsd,
  };
}

export function formatTokens(count: number): string {
  if (count < 1000) return String(count);
  const [value, suffix] = count < 1_000_000 ? [count / 1000, 'k'] : [count / 1_000_000, 'M'];
  return `${value.toFixed(1).replace(/\.0$/, '')}${suffix}`;
}

export function formatCost(costUsd: number | null): string {
  if (costUsd === null) return 'неизвестно';
  if (costUsd > 0 && costUsd < 0.01) return '<$0.01';
  return `$${costUsd.toFixed(2)}`;
}

export function formatUsageLine(usage: UsageTotals): string {
  const parts = [`${formatTokens(usage.inputTokens)}↑`, `${formatTokens(usage.outputTokens)}↓`];
  if (usage.costUsd !== null) parts.push(`· ${formatCost(usage.costUsd)}`);
  return parts.join(' ');
}

export function formatUsageReport(usage: UsageTotals): string {
  return [
    `Запросов:      ${usage.requests}`,
    `Входные:       ${formatTokens(usage.inputTokens)} токенов`,
    `Выходные:      ${formatTokens(usage.outputTokens)} токенов`,
    `Всего:         ${formatTokens(usage.inputTokens + usage.outputTokens)} токенов`,
    `Стоимость:     ${formatCost(usage.costUsd)}`,
  ].join('\n');
}
