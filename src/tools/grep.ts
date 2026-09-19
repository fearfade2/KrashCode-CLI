import { tool } from 'ai';
import { z } from 'zod';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import fg from 'fast-glob';
import { resolveInside, patternEscapes } from '../utils/safepath.js';

const MAX_MATCHES = 200;
const MAX_FILE_BYTES = 1_000_000;
const MAX_LINE_WIDTH = 300;
const MAX_FILES = 5_000;
const IGNORED = ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/.next/**'];

export function createGrepTool(cwd: string) {
  return tool({
    description:
      'Search file contents with a JavaScript regular expression. ' +
      'Returns matching lines as path:line: text, most recently modified first.',
    parameters: z.object({
      pattern: z.string().max(2000).describe('JavaScript regular expression'),
      path: z.string().optional().describe('Directory to search, relative to workspace root'),
      glob: z.string().optional().describe('Glob to filter files, e.g. **/*.ts'),
      maxMatches: z.number().int().min(1).optional().describe(`Max matches (default ${MAX_MATCHES})`),
    }),
    execute: async ({ pattern, path = '.', glob = '**/*', maxMatches }) => {
      let re: RegExp;
      try {
        re = new RegExp(pattern);
      } catch (err) {
        return `Invalid regex: ${(err as Error).message}`;
      }

      if (patternEscapes(glob)) {
        return `Glob ${glob} must be relative to the workspace root.`;
      }
      const safe = resolveInside(cwd, path);
      if (!safe.ok) return safe.reason;

      const target = await stat(safe.path).catch(() => null);
      if (!target) return `Path not found: ${path}`;

      const discovered = target.isDirectory()
        ? (await fg(glob, {
            cwd: safe.path,
            dot: false,
            onlyFiles: true,
            followSymbolicLinks: false,
            suppressErrors: true,
            ignore: IGNORED,
            stats: true,
          }))
            .sort((a, b) => (b.stats?.mtimeMs ?? 0) - (a.stats?.mtimeMs ?? 0))
            .map((e) => ({
              absolute: join(safe.path, e.path),
              relative: join(safe.relative, e.path),
              size: e.stats?.size ?? 0,
            }))
        : [{ absolute: safe.path, relative: safe.relative, size: target.size }];

      const files = discovered.slice(0, MAX_FILES);
      const limit = Math.min(maxMatches ?? MAX_MATCHES, MAX_MATCHES);
      const hits: string[] = [];

      for (const file of files) {
        if (file.size > MAX_FILE_BYTES) continue;
        const buf = await readFile(file.absolute).catch(() => null);
        if (!buf || buf.subarray(0, 4096).includes(0)) continue;

        const lines = buf.toString('utf8').split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (re.test(lines[i]!)) {
            const text = lines[i]!.trim();
            hits.push(
              `${file.relative}:${i + 1}: ${text.length > MAX_LINE_WIDTH ? text.slice(0, MAX_LINE_WIDTH) + '…' : text}`,
            );
            if (hits.length >= limit) break;
          }
        }
        if (hits.length >= limit) break;
      }

      if (hits.length === 0) return `No matches for ${pattern}`;
      if (hits.length >= limit) {
        hits.push(`... stopped at ${limit} matches. Narrow the pattern or glob.`);
      }
      return hits.join('\n');
    },
  });
}
