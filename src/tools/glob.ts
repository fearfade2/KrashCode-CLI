import { tool } from 'ai';
import { z } from 'zod';
import { join } from 'node:path';
import fg from 'fast-glob';
import { resolveInside, patternEscapes } from '../utils/safepath.js';

const MAX_RESULTS = 500;
const IGNORED = ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/.next/**'];

export function createGlobTool(cwd: string) {
  return tool({
    description:
      'Find files by glob pattern, most recently modified first. ' +
      'Hidden files, node_modules, .git and dist are skipped.',
    parameters: z.object({
      pattern: z.string().describe('Glob pattern, e.g. **/*.ts'),
      path: z.string().optional().describe('Directory to search in, relative to workspace root'),
    }),
    execute: async ({ pattern, path = '.' }) => {
      if (patternEscapes(pattern)) {
        return `Pattern ${pattern} must be relative to the workspace root.`;
      }
      const safe = resolveInside(cwd, path);
      if (!safe.ok) return safe.reason;

      const entries = await fg(pattern, {
        cwd: safe.path,
        dot: false,
        onlyFiles: true,
        followSymbolicLinks: false,
        suppressErrors: true,
        ignore: IGNORED,
        stats: true,
      });

      if (entries.length === 0) return `No files matched ${pattern}`;

      entries.sort((a, b) => (b.stats?.mtimeMs ?? 0) - (a.stats?.mtimeMs ?? 0));
      const paths = entries.slice(0, MAX_RESULTS).map((e) => join(safe.relative, e.path));
      if (entries.length > MAX_RESULTS) {
        paths.push(`... truncated: ${entries.length - MAX_RESULTS} more files matched.`);
      }
      return paths.join('\n');
    },
  });
}
