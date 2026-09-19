import { tool } from 'ai';
import { z } from 'zod';
import { spawn } from 'node:child_process';
import { startJob } from './jobs.js';

const DEFAULT_TIMEOUT = 120_000;
const MAX_TIMEOUT = 600_000;
const MAX_OUTPUT = 100_000;

export function createBashTool(cwd: string, optionSignal?: AbortSignal) {
  return tool({
    description:
      'Run a shell command in the workspace root. stdout and stderr are merged. Avoid commands that wait for interactive input. Set background: true to keep a long command (dev server, watcher, build) running while you carry on, then read its output with bash_output.',
    inputSchema: z.object({
      command: z.string().max(20_000).describe('Shell command to run'),
      timeoutMs: z.number().int().min(1).optional()
        .describe(`Timeout in ms (default ${DEFAULT_TIMEOUT}, max ${MAX_TIMEOUT}); ignored for background`),
      background: z.boolean().optional()
        .describe('Run in the background and return immediately; collect output later with bash_output'),
    }),
    execute: async ({ command, timeoutMs, background }, context) => {
      const signals = [optionSignal, context?.abortSignal].filter((s): s is AbortSignal => !!s);
      const signal = signals.length ? AbortSignal.any(signals) : undefined;
      if (signal?.aborted) return 'Command cancelled before execution.';

      if (background) {
        const started = startJob(command, cwd);
        if ('error' in started) return started.error;
        return `[${started.id} started in background]\nRead its output with bash_output({ id: "${started.id}" }).`;
      }

      const timeout = Math.min(timeoutMs ?? DEFAULT_TIMEOUT, MAX_TIMEOUT);
      return new Promise<string>((resolve) => {
        const child = spawn(command, {
          shell: true, cwd, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
          detached: process.platform !== 'win32',
        });
        const chunks: Buffer[] = [];
        let captured = 0;
        let truncated = false;
        let timedOut = false;
        let aborted = false;
        let killError: string | undefined;
        const collect = (buf: Buffer) => {
          const remaining = MAX_OUTPUT - captured;
          if (buf.length > remaining) truncated = true;
          const chunk = buf.subarray(0, remaining);
          chunks.push(chunk);
          captured += chunk.length;
        };
        child.stdout.on('data', collect);
        child.stderr.on('data', collect);
        const kill = () => {
          try {
            if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGKILL');
            else child.kill('SIGKILL');
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ESRCH') {
              killError = `Failed to kill process group: ${(error as Error).message}`;
              child.kill('SIGKILL');
            }
          }
        };
        const abort = () => { aborted = true; kill(); };
        const timer = setTimeout(() => { timedOut = true; kill(); }, timeout);
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) abort();
        const cleanup = () => {
          clearTimeout(timer);
          signal?.removeEventListener('abort', abort);
        };
        child.on('error', (error) => {
          cleanup();
          resolve(`Command failed to start: ${error.message}`);
        });
        child.on('close', (code, exitSignal) => {
          cleanup();
          const output = Buffer.concat(chunks).toString('utf8');
          const notes: string[] = [];
          if (truncated) notes.push(`[output truncated at ${MAX_OUTPUT} bytes]`);
          if (timedOut) notes.push(`[timed out after ${timeout}ms]`);
          if (aborted) notes.push('[command cancelled]');
          if (killError) notes.push(killError);
          if (code !== 0 && !timedOut && !aborted) notes.push(`[exit ${exitSignal ? `signal ${exitSignal}` : `code ${code}`}]`);
          resolve([output.trim() === '' ? '(no output)' : output.replace(/\n+$/, ''), ...notes].join('\n'));
        });
      });
    },
  });
}
