import type { Tool, ToolSet } from 'ai';
import { createBashTool } from './bash.js';
import { createReadTool } from './read.js';
import { createWriteTool } from './write.js';
import { createEditTool } from './edit.js';
import { createGlobTool } from './glob.js';
import { createGrepTool } from './grep.js';
import { createBashOutputTool } from './bash-output.js';
import { createMemoryTool, type MemoryStore } from './memory.js';
import type { PermissionEngine } from '../core/permissions.js';

export interface ToolsOptions {
  signal?: AbortSignal;
  permissions: PermissionEngine;
  // Возвращает true, если пользователь одобрил вызов. 'always' даётся движку сам.
  approve(name: string, input: Record<string, unknown>): Promise<'once' | 'always' | 'deny'>;
  memory?: MemoryStore;
  // Вызывается для файловых мутаций — для авто-диагностики после хода.
  onFileChanged?(path: string): void;
}

const READONLY = new Set(['read', 'glob', 'grep', 'memory', 'bash_output']);

export function createTools(cwd: string, options: ToolsOptions): ToolSet {
  const { permissions } = options;
  let queue: Promise<unknown> = Promise.resolve();

  function protect<I extends Record<string, unknown>>(
    name: string,
    definition: Tool<I, string>,
  ): Tool<I, string> {
    const execute = definition.execute!;
    definition.execute = (input, context) => {
      const signals = [options.signal, context?.abortSignal].filter(
        (s): s is AbortSignal => !!s,
      );
      const signal = signals.length ? AbortSignal.any(signals) : undefined;

      // Вызовы делят очередь: выполняются строго по одному, чтобы не гонять
      // права/файлы параллельно (как в KitCode).
      const run = queue.then(async () => {
        if (signal?.aborted) return `Cancelled ${name}.`;

        const verdict = permissions.decide(name);
        if (verdict === 'deny') {
          return permissions.denyReason(name) ?? `Инструмент "${name}" отключён.`;
        }
        if (verdict === 'ask') {
          let decision: 'once' | 'always' | 'deny';
          try {
            decision = await options.approve(name, input);
          } catch (error) {
            return signal?.aborted ? `Cancelled ${name}.` : `Approval failed for ${name}: ${String(error)}`;
          }
          if (signal?.aborted) return `Cancelled ${name}.`;
          if (decision === 'deny') {
            return `Пользователь отклонил вызов ${name}. Не повторяй — спроси, как поступить.`;
          }
          if (decision === 'always') permissions.grantForSession(name);
        }

        if (signal?.aborted) return `Cancelled ${name}.`;
        try {
          const result = execute(input, { ...context, abortSignal: signal });
          const value =
            typeof result === 'object' && result !== null && Symbol.asyncIterator in result
              ? await drain(result as AsyncIterable<string>)
              : await result;
          if (!READONLY.has(name) && typeof input.path === 'string') {
            options.onFileChanged?.(input.path);
          }
          return value;
        } catch (error) {
          return signal?.aborted ? `Cancelled ${name}.` : `${name} failed: ${String(error)}`;
        }
      });
      queue = run.catch(() => undefined);
      return run;
    };
    return definition;
  }

  const tools: ToolSet = {
    bash: protect('bash', createBashTool(cwd, options.signal)),
    read: protect('read', createReadTool(cwd)),
    write: protect('write', createWriteTool(cwd)),
    edit: protect('edit', createEditTool(cwd)),
    glob: protect('glob', createGlobTool(cwd)),
    grep: protect('grep', createGrepTool(cwd)),
    bash_output: protect('bash_output', createBashOutputTool()),
  };

  if (options.memory) {
    tools.memory = protect('memory', createMemoryTool(options.memory));
  }

  return tools;
}

async function drain(iterable: AsyncIterable<string>): Promise<string> {
  let last = '';
  for await (const value of iterable) last = value;
  return last;
}
