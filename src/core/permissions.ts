import type { AgentMode, PermissionMode } from './types.js';
import { MODES } from './types.js';

// Инструменты, которые изменяют состояние (файлы/процессы) и требуют внимания.
// memory тоже пишет на диск — в plan-режиме его мутации блокируются на уровне
// самого инструмента (чтение остаётся доступным).
const MUTATING_TOOLS = new Set(['write', 'edit', 'bash']);

export function isMutatingTool(name: string): boolean {
  return MUTATING_TOOLS.has(name);
}

export interface PermissionEngine {
  /** Итоговое решение по инструменту с учётом режима, настроек и session-grants. */
  decide(toolName: string, requested?: PermissionMode): PermissionMode;
  denyReason(toolName: string): string | undefined;
  grantForSession(toolName: string): void;
  bypass: { enable(): void; disable(): void; isEnabled(): boolean };
  mode: { get(): AgentMode; set(mode: AgentMode): void; cycle(): AgentMode };
}

export const PLAN_REFUSAL =
  'Режим plan включён: этот инструмент меняет состояние и недоступен. Исследуй проект read-only инструментами и верни план. Не повторяй вызов.';

export function createPermissionEngine(
  configPermissions: Record<string, PermissionMode> = {},
  initialMode: AgentMode = 'normal',
): PermissionEngine {
  const sessionGrants = new Set<string>();
  let bypassEnabled = false;
  let current: AgentMode = initialMode;

  const configured = (toolName: string, requested?: PermissionMode): PermissionMode =>
    configPermissions[toolName] ?? requested ?? (isMutatingTool(toolName) ? 'ask' : 'allow');

  return {
    decide(toolName, requested) {
      const base = configured(toolName, requested);
      if (base === 'deny') return 'deny';
      if (current === 'plan' && isMutatingTool(toolName)) return 'deny';
      if (base === 'allow') return 'allow';
      if (bypassEnabled) return 'allow';
      if (current === 'accept' && (toolName === 'write' || toolName === 'edit')) return 'allow';
      if (sessionGrants.has(toolName)) return 'allow';
      return 'ask';
    },
    denyReason(toolName) {
      if (current === 'plan' && isMutatingTool(toolName)) return PLAN_REFUSAL;
      if (configured(toolName) === 'deny') {
        return `Инструмент "${toolName}" отключён в настройках. Не повторяй вызов — найди другой путь или спроси.`;
      }
      return undefined;
    },
    grantForSession(toolName) {
      sessionGrants.add(toolName);
    },
    bypass: {
      enable() {
        bypassEnabled = true;
      },
      disable() {
        bypassEnabled = false;
      },
      isEnabled: () => bypassEnabled,
    },
    mode: {
      get: () => current,
      set(mode) {
        current = mode;
      },
      cycle() {
        current = MODES[(MODES.indexOf(current) + 1) % MODES.length] ?? 'normal';
        return current;
      },
    },
  };
}
