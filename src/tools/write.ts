import { tool } from 'ai';
import { z } from 'zod';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { resolveInside } from '../utils/safepath.js';

const MAX_FILE_BYTES = 5_000_000;

export function createWriteTool(cwd: string) {
  return tool({
    description:
      'Write a file, replacing it if it already exists. Missing parent directories are created. ' +
      'Prefer edit for changing part of an existing file.',
    inputSchema: z.object({
      path: z.string().describe('File path, relative to the workspace root'),
      content: z.string().max(MAX_FILE_BYTES).describe('Full file contents'),
    }),
    execute: async ({ path, content }) => {
      if (Buffer.byteLength(content, 'utf8') > MAX_FILE_BYTES) {
        return `Content exceeds the ${MAX_FILE_BYTES} byte limit.`;
      }
      const safe = resolveInside(cwd, path);
      if (!safe.ok) return safe.reason;

      try {
        await mkdir(dirname(safe.path), { recursive: true });

        const rechecked = resolveInside(cwd, path);
        if (!rechecked.ok || rechecked.path !== safe.path) {
          return `Cannot write ${path}: the path changed while parent was created.`;
        }

        const before = await stat(safe.path).catch(() => null);
        await writeFile(safe.path, content, 'utf8');

        const lines = content === '' ? 0 : content.replace(/\n$/, '').split('\n').length;
        return `${before === null ? 'Created' : 'Updated'} ${path} (${lines} ${lines === 1 ? 'line' : 'lines'})`;
      } catch (err) {
        return `Failed to write ${path}: ${(err as Error).message}`;
      }
    },
  });
}
