import { tool } from 'ai';
import { z } from 'zod';
import { spawn } from 'node:child_process';

const DEFAULT_TIMEOUT = 120_000;
const MAX_TIMEOUT = 600_000;
const MAX_OUTPUT = 100_000;

export function createBashTool(cwd: string) {
  return tool({
    description:
      'Run a shell command in the workspace root. stdout and stderr are merged. ' +
      'Avoid commands that wait for interactive input.',
    parameters: z.object({
      command: z.string().max(20_000).describe('Shell command to run'),
      timeoutMs: z.number().int().min(1).optional()
        .describe(`Timeout in ms (default ${DEFAULT_TIMEOUT}, max ${MAX_TIMEOUT})`),
    }),
    execute: async ({ command, timeoutMs }) => {
      const timeout = Math.min(timeoutMs ?? DEFAULT_TIMEOUT, MAX_TIMEOUT);

      return new Promise<string>((resolve) => {
        const child = spawn(command, {
          shell: true,
          cwd,
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true,
        });

        const chunks: string[] = [];
        let captured = 0;
        let truncated = false;

        const collect = (buf: Buffer) => {
          if (truncated) return;
          const text = buf.toString('utf8');
          if (text.length > MAX_OUTPUT - captured) {
            chunks.push(text.slice(0, MAX_OUTPUT - captured));
            truncated = true;
            return;
          }
          chunks.push(text);
          captured += text.length;
        };

        child.stdout.on('data', collect);
        child.stderr.on('data', collect);

        let timedOut = false;
        const timer = setTimeout(() => {
          timedOut = true;
          try { process.kill(-child.pid!, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
        }, timeout);

        child.on('error', (err) => {
          clearTimeout(timer);
          resolve(`Command failed to start: ${err.message}`);
        });

        child.on('close', (code, signal) => {
          clearTimeout(timer);
          const output = chunks.join('');
          const notes: string[] = [];
          if (truncated) notes.push(`[output truncated at ${MAX_OUTPUT} chars]`);
          if (timedOut) notes.push(`[timed out after ${timeout}ms]`);
          if (code !== 0 && !timedOut) {
            notes.push(`[exit ${signal ? `signal ${signal}` : `code ${code}`}]`);
          }
          const body = output.trim() === '' ? '(no output)' : output.replace(/\n+$/, '');
          resolve([body, ...notes].join('\n'));
        });
      });
    },
  });
}
