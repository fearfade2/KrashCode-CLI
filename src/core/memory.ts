import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getMemoryDir } from './config.js';

const MAX_MEMORY_CHARS = 16_000;

// Заметки хранятся по каноническому пути воркспейса, отдельным файлом.
function memoryPath(workspace: string): string {
  const key = process.platform === 'win32' ? workspace.toLowerCase() : workspace;
  return join(getMemoryDir(), createHash('sha256').update(key).digest('hex') + '.txt');
}

export async function readMemory(workspace: string): Promise<string> {
  try {
    return await readFile(memoryPath(workspace), 'utf-8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return '';
    throw error;
  }
}

export async function saveMemory(workspace: string, text: string): Promise<void> {
  if (text.length > MAX_MEMORY_CHARS) {
    throw new Error(`Память проекта ограничена ${MAX_MEMORY_CHARS} символами.`);
  }
  const file = memoryPath(workspace);
  await mkdir(getMemoryDir(), { recursive: true, mode: 0o700 });
  await writeFile(file, redactSecrets(text), { mode: 0o600 });
}

export async function clearMemory(workspace: string): Promise<void> {
  await rm(memoryPath(workspace), { force: true });
}

// Грубая редакция очевидных секретов, чтобы они случайно не попали в память.
export function redactSecrets(text: string): string {
  return text
    .replace(/\b(sk|pk|ghp|gho|glpat|nvapi|xai|AIza)[-_a-zA-Z0-9]{16,}\b/g, '[redacted]')
    // AWS access key id (AKIA…) и временный (ASIA…).
    .replace(/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, '[redacted]')
    .replace(/\bBearer\s+[A-Za-z0-9._/+-]{16,}=*\b/gi, 'Bearer [redacted]')
    .replace(/\b[A-Za-z0-9_-]{40,}\b/g, (match) =>
      /^[A-Za-z0-9_-]+$/.test(match) && !/\s/.test(match) ? '[redacted]' : match,
    )
    // Base64-подобные секреты (в т.ч. AWS secret key) с '/' и '+', которые не
    // ловятся классом выше. Границы — по не-base64 символам, а не \b.
    .replace(/(?<![A-Za-z0-9/+])[A-Za-z0-9/+]{40,}={0,2}(?![A-Za-z0-9/+])/g, '[redacted]');
}
