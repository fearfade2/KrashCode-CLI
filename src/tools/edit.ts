import { tool } from 'ai';
import { z } from 'zod';
import { readFile, writeFile } from 'node:fs/promises';
import { resolveInside } from '../utils/safepath.js';

const MAX_FILE_BYTES = 5_000_000;

function countOccurrences(haystack: string, needle: string): number {
  if (needle === '') return 0;
  let count = 0;
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) return count;
    count++;
    from = at + needle.length;
  }
}

export function createEditTool(cwd: string) {
  return tool({
    description:
      'Replace an exact string in a file. oldString must match the file byte for byte, ' +
      'including indentation, and must be unique unless replaceAll is true.',
    parameters: z.object({
      path: z.string().describe('File path, relative to the workspace root'),
      oldString: z.string().max(MAX_FILE_BYTES).describe('Text to replace (must match exactly)'),
      newString: z.string().max(MAX_FILE_BYTES).describe('Replacement text'),
      replaceAll: z.boolean().optional().describe('Replace every occurrence'),
    }),
    execute: async ({ path, oldString, newString, replaceAll = false }) => {
      const safe = resolveInside(cwd, path);
      if (!safe.ok) return safe.reason;

      let before: string;
      try {
        const buf = await readFile(safe.path);
        if (buf.subarray(0, 8192).includes(0)) return `Cannot edit ${path}: binary file.`;
        before = buf.toString('utf8');
      } catch {
        return `Cannot read ${path}.`;
      }

      const count = countOccurrences(before, oldString);
      if (count === 0) {
        return `oldString was not found in ${path}. Read the file again and match exactly.`;
      }
      if (count > 1 && !replaceAll) {
        return `oldString matches ${count} places in ${path}. Add more context or set replaceAll.`;
      }

      const after = replaceAll
        ? before.split(oldString).join(newString)
        : before.slice(0, before.indexOf(oldString)) +
          newString +
          before.slice(before.indexOf(oldString) + oldString.length);

      if (Buffer.byteLength(after, 'utf8') > MAX_FILE_BYTES) {
        return `Result exceeds the ${MAX_FILE_BYTES / 1e6} MB limit.`;
      }

      try {
        await writeFile(safe.path, after, 'utf8');
      } catch (err) {
        return `Failed to write ${path}: ${(err as Error).message}`;
      }

      return `Edited ${path} (${count} ${count === 1 ? 'replacement' : 'replacements'})`;
    },
  });
}
