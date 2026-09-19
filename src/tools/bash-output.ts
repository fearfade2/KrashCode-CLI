import { tool } from 'ai';
import { z } from 'zod';
import { killJob, listJobs, readJob, type JobState } from './jobs.js';

export function createBashOutputTool() {
  return tool({
    description:
      'Собрать вывод команд, запущенных через bash с background: true. Возвращает только то, что появилось с прошлого чтения. Без id — список всех фоновых команд. kill — остановить команду.',
    inputSchema: z.object({
      id: z.string().optional().describe('Идентификатор фоновой команды, например "bg-1"'),
      kill: z.boolean().optional().describe('Остановить команду вместо чтения вывода'),
    }),
    execute: async ({ id, kill }) => {
      if (!id) {
        const jobs = listJobs();
        if (jobs.length === 0) return 'Фоновых команд не запускалось.';
        return jobs
          .map((j) => `${j.id}  ${describeState(j.state, j.exitCode, j.signal)}  ${j.command}`)
          .join('\n');
      }

      if (kill) {
        return killJob(id)
          ? `[${id} остановлена]`
          : `Нет фоновой команды с id "${id}".`;
      }

      const job = readJob(id);
      if (!job) return `Нет фоновой команды с id "${id}".`;

      const notes = [`[${id} ${describeState(job.state, job.exitCode, job.signal)}]`];
      if (job.truncated) notes.push('[буфер вывода переполнен; ранний вывод отброшен]');
      const body = job.output.trim() === '' ? '(нет нового вывода)' : job.output.replace(/\n+$/, '');
      return [body, ...notes].join('\n');
    },
  });
}

function describeState(state: JobState, exitCode: number | null, signal: string | null): string {
  if (state === 'running') return 'ещё выполняется';
  if (state === 'killed') return `остановлена${signal ? ` сигналом ${signal}` : ''}`;
  return exitCode === 0 ? 'завершена' : `код выхода ${exitCode}`;
}
