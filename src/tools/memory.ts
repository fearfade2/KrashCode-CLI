import { tool } from 'ai';
import { z } from 'zod';
import { redactSecrets } from '../core/memory.js';

export interface MemoryStore {
  read(): string;
  save(text: string): Promise<void>;
  // В plan-режиме мутации памяти запрещены (только чтение).
  isPlanMode?(): boolean;
}

// Инструмент долговременной памяти проекта: read / add / replace / delete.
// Мутации требуют source; replace/delete требуют точного совпадения oldText.
export function createMemoryTool(store: MemoryStore) {
  return tool({
    description:
      'Read or update persistent notes for this project. Remember only explicit user preferences, ' +
      'confirmed project facts and accepted decisions, with their source. Never store secrets, guesses ' +
      'or temporary progress. For replace/delete, oldText must match exactly once. Notes survive new chats.',
    inputSchema: z.object({
      action: z.enum(['read', 'add', 'replace', 'delete']),
      text: z.string().max(4000).optional().describe('New note text (for add/replace)'),
      oldText: z.string().optional().describe('Existing note to replace/delete (exact match)'),
      source: z.string().max(1000).optional().describe('Where this fact came from (required for mutations)'),
    }),
    execute: async ({ action, text, oldText, source }) => {
      const before = store.read();
      if (action === 'read') return before || 'Память проекта пуста.';

      if (store.isPlanMode?.()) {
        return 'Режим plan: память только для чтения, изменять её нельзя. Верни план — не повторяй вызов.';
      }
      if (!source?.trim()) return 'Мутации памяти требуют source (откуда факт).';
      const note = text ? `${redactSecrets(text)}\nSource: ${redactSecrets(source)}` : '';

      let after: string;
      if (action === 'add') {
        if (!text?.trim()) return 'add требует text.';
        if (before.includes(note)) return 'Эта заметка уже есть в памяти.';
        after = [before.trim(), note].filter(Boolean).join('\n\n');
      } else {
        if (!oldText) return `${action} требует oldText.`;
        const at = before.indexOf(oldText);
        if (at === -1 || before.indexOf(oldText, at + 1) !== -1) {
          return 'oldText должен совпадать ровно один раз. Прочитай память заново.';
        }
        after = (before.slice(0, at) + note + before.slice(at + oldText.length)).trim();
      }

      await store.save(after);
      return `Память обновлена (${action}).`;
    },
  });
}
