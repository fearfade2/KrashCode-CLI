import { describe, it, expect } from 'vitest';
import { createMemoryTool } from '../src/tools/memory.js';
import { redactSecrets } from '../src/core/memory.js';

// Мини-хранилище в памяти для теста инструмента.
function makeStore(initial = '') {
  let value = initial;
  return {
    read: () => value,
    save: async (text: string) => {
      value = text;
    },
    current: () => value,
  };
}

async function run(tool: ReturnType<typeof createMemoryTool>, input: Record<string, unknown>) {
  // execute у ai-tool принимает (input, context)
  return (tool.execute as (i: unknown, c: unknown) => Promise<string>)(input, {});
}

describe('memory tool', () => {
  it('reads empty memory', async () => {
    const tool = createMemoryTool(makeStore());
    expect(await run(tool, { action: 'read' })).toContain('пуста');
  });

  it('rejects add without source', async () => {
    const tool = createMemoryTool(makeStore());
    const res = await run(tool, { action: 'add', text: 'use pnpm' });
    expect(res).toContain('source');
  });

  it('adds a note with source', async () => {
    const store = makeStore();
    const tool = createMemoryTool(store);
    await run(tool, { action: 'add', text: 'use pnpm', source: 'user' });
    expect(store.current()).toContain('use pnpm');
    expect(store.current()).toContain('Source: user');
  });

  it('replace requires an exact unique match', async () => {
    const store = makeStore('foo\n\nfoo');
    const tool = createMemoryTool(store);
    const res = await run(tool, { action: 'replace', oldText: 'foo', text: 'bar', source: 'user' });
    expect(res).toContain('ровно один раз');
  });

  it('blocks mutations in plan mode but still allows reads', async () => {
    const store = { ...makeStore('note'), isPlanMode: () => true };
    const tool = createMemoryTool(store);
    // Чтение доступно даже в plan-режиме.
    expect(await run(tool, { action: 'read' })).toContain('note');
    // Мутация отклоняется до сохранения и не меняет содержимое.
    const res = await run(tool, { action: 'add', text: 'x', source: 'user' });
    expect(res).toContain('plan');
    expect(store.current()).toBe('note');
  });
});

describe('redactSecrets', () => {
  it('masks obvious API keys', () => {
    expect(redactSecrets('key sk-abcdefghijklmnop1234567890')).toContain('[redacted]');
    expect(redactSecrets('AIzaSyAbcdefghijklmnopqrstuvwxyz12345')).toContain('[redacted]');
  });

  it('masks AWS access key ids and secrets containing / and +', () => {
    expect(redactSecrets('id AKIAIOSFODNN7EXAMPLE')).toContain('[redacted]');
    expect(redactSecrets('id AKIAIOSFODNN7EXAMPLE')).not.toContain('AKIAIOSFODNN7EXAMPLE');
    const secret = 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY';
    expect(redactSecrets(`secret ${secret}`)).not.toContain(secret);
  });

  it('leaves ordinary prose intact', () => {
    expect(redactSecrets('run npm test before committing')).toBe('run npm test before committing');
  });
});
