import { tool } from 'ai';
import { z } from 'zod';
import { readFile, stat } from 'node:fs/promises';
import { resolveInside } from '../utils/safepath.js';

const MAX_LINES = 2000;
const MAX_CHARS = 200_000;
const MAX_FILE_BYTES = 5_000_000;

export function createReadTool(cwd: string) {
  return tool({
    description:
      'Read a text file from the workspace. Returns numbered lines. ' +
      'Use offset and limit to page through large files.',
    parameters: z.object({
      path: z.string().describe('File path, relative to the workspace root'),
      offset: z.number().int().min(1).optional().describe('1-based line to start from'),
      limit: z.number().int().min(1).optional().describe('Maximum number of lines to return'),
    }),
    execute: async ({ path, offset = 1, limit }) => {
      const safe = resolveInside(cwd, path);
      if (!safe.ok) return safe.reason;

      const info = await stat(safe.path).catch(() => null);
      if (!info) return `File not found: ${path}`;
      if (info.isDirectory()) return `${path} is a directory. Use glob to list its contents.`;
      if (info.size > MAX_FILE_BYTES) {
        return `${path} is ${(info.size / 1e6).toFixed(1)} MB; limit is ${MAX_FILE_BYTES / 1e6} MB. Use grep instead.`;
      }

      const buffer = await readFile(safe.path);
      if (buffer.subarray(0, 4096).includes(0)) {
        return `${path} looks like a binary file and cannot be read as text.`;
      }

      const lines = buffer.toString('utf8').split('\n');
      if (lines.at(-1) === '') lines.pop();
      if (lines.length === 0) return `${path} is empty.`;

      const start = Math.max(1, offset) - 1;
      if (start >= lines.length) {
        return `${path} has ${lines.length} lines, offset ${offset} is past the end.`;
      }

      const window = lines.slice(start, start + Math.min(limit ?? MAX_LINES, MAX_LINES));
      const rendered: string[] = [];
      let chars = 0;
      for (const [i, line] of window.entries()) {
        const numbered = `${start + i + 1}\t${line}`;
        if (chars + numbered.length > MAX_CHARS) break;
        chars += numbered.length + 1;
        rendered.push(numbered);
      }

      const remaining = lines.length - (start + rendered.length);
      if (remaining > 0) {
        rendered.push(`... truncated: ${remaining} more lines. Use offset ${start + rendered.length + 1}.`);
      }
      return rendered.join('\n');
    },
  });
}
