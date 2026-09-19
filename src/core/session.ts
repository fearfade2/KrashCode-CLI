import { readFile, writeFile, readdir, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { getSessionsDir, ensureConfigDir } from './config.js';
import type { SessionData, SessionMeta } from './types.js';

function generateId(): string {
  return Date.now().toString(36) + '-' + randomBytes(4).toString('hex');
}

// Заголовок сессии из первого сообщения пользователя: первая строка, обрезанная.
export function deriveTitle(firstMessage: string): string {
  const line = firstMessage.trim().split('\n')[0]?.trim() ?? '';
  if (!line) return '';
  return line.length > 60 ? line.slice(0, 57).trimEnd() + '…' : line;
}

export function createSessionMeta(cwd: string, model: string): SessionMeta {
  const now = new Date().toISOString();
  return {
    id: generateId(),
    title: '',
    cwd,
    model,
    messageCount: 0,
    createdAt: now,
    updatedAt: now,
  };
}

export async function saveSession(session: SessionData): Promise<void> {
  if (!/^[a-zA-Z0-9-]+$/.test(session.meta.id)) throw new Error('Invalid session ID');
  await ensureConfigDir();
  const dir = getSessionsDir();
  const file = join(dir, `${session.meta.id}.json`);
  session.meta.updatedAt = new Date().toISOString();
  session.meta.messageCount = session.messages.length;
  const temporary = `${file}.${randomBytes(6).toString('hex')}.tmp`;
  await writeFile(temporary, JSON.stringify(session, null, 2), { encoding: 'utf-8', mode: 0o600 });
  await rename(temporary, file);
}

export async function loadSession(id: string): Promise<SessionData | null> {
  if (!/^[a-zA-Z0-9-]+$/.test(id)) return null;
  try {
    const dir = getSessionsDir();
    const file = join(dir, `${id}.json`);
    const raw = await readFile(file, 'utf-8');
    return JSON.parse(raw) as SessionData;
  } catch {
    return null;
  }
}

export async function listSessions(): Promise<SessionMeta[]> {
  try {
    await ensureConfigDir();
    const dir = getSessionsDir();
    const files = await readdir(dir);
    const sessions: SessionMeta[] = [];

    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      try {
        const raw = await readFile(join(dir, file), 'utf-8');
        const data = JSON.parse(raw) as SessionData;
        sessions.push(data.meta);
      } catch { /* skip corrupt sessions */ }
    }

    return sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  } catch {
    return [];
  }
}
