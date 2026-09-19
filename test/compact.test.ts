import { describe, it, expect } from 'vitest';
import type { ModelMessage } from 'ai';
import { estimateTokens, shouldAutoCompact, safeCutIndex } from '../src/core/compact.js';
import { deriveTitle } from '../src/core/session.js';

describe('estimateTokens', () => {
  it('returns zero for empty history', () => {
    expect(estimateTokens([])).toBe(0);
  });

  it('estimates ~1 token per 4 chars of string content', () => {
    const messages: ModelMessage[] = [{ role: 'user', content: 'a'.repeat(400) }];
    expect(estimateTokens(messages)).toBe(100);
  });

  it('counts structured tool-call/tool-result parts', () => {
    const messages: ModelMessage[] = [
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'hello' },
          { type: 'tool-call', toolCallId: '1', toolName: 'read', input: { path: 'a.ts' } },
        ],
      },
    ];
    // Растёт с объёмом, но остаётся положительным и конечным.
    expect(estimateTokens(messages)).toBeGreaterThan(0);
  });

  it('grows with history size', () => {
    const small: ModelMessage[] = [{ role: 'user', content: 'hi' }];
    const big: ModelMessage[] = [{ role: 'user', content: 'x'.repeat(10_000) }];
    expect(estimateTokens(big)).toBeGreaterThan(estimateTokens(small));
  });
});

describe('shouldAutoCompact', () => {
  it('triggers at/above 80% of the context window', () => {
    expect(shouldAutoCompact(80_000, 100_000)).toBe(true);
    expect(shouldAutoCompact(100_000, 100_000)).toBe(true);
  });

  it('does not trigger below the threshold', () => {
    expect(shouldAutoCompact(79_999, 100_000)).toBe(false);
    expect(shouldAutoCompact(0, 100_000)).toBe(false);
  });

  it('never triggers on a non-positive window', () => {
    expect(shouldAutoCompact(1_000_000, 0)).toBe(false);
  });
});

describe('safeCutIndex', () => {
  // История, где почти каждый ход — assistant с tool-call + отдельное tool-сообщение.
  const toolHeavy = (): ModelMessage[] => [
    { role: 'user', content: 'go' },
    { role: 'assistant', content: [{ type: 'tool-call', toolCallId: 'a', toolName: 'read', input: {} }] },
    { role: 'tool', content: [{ type: 'tool-result', toolCallId: 'a', toolName: 'read', output: { type: 'text', value: 'x' } }] },
    { role: 'assistant', content: [{ type: 'tool-call', toolCallId: 'b', toolName: 'read', input: {} }] },
    { role: 'tool', content: [{ type: 'tool-result', toolCallId: 'b', toolName: 'read', output: { type: 'text', value: 'y' } }] },
    { role: 'assistant', content: [{ type: 'tool-call', toolCallId: 'c', toolName: 'read', input: {} }] },
    { role: 'tool', content: [{ type: 'tool-result', toolCallId: 'c', toolName: 'read', output: { type: 'text', value: 'z' } }] },
    { role: 'assistant', content: [{ type: 'tool-call', toolCallId: 'd', toolName: 'read', input: {} }] },
    { role: 'tool', content: [{ type: 'tool-result', toolCallId: 'd', toolName: 'read', output: { type: 'text', value: 'w' } }] },
    { role: 'user', content: 'next' },
  ];

  it('never places the cut so recent starts with an orphaned tool-result', () => {
    const history = toolHeavy();
    const cut = safeCutIndex(history);
    expect(cut).toBeGreaterThan(0);
    // Критично: recent[0] не должно быть tool-сообщением (иначе провайдер вернёт 400).
    expect(history[cut]?.role).not.toBe('tool');
  });

  it('returns -1 when there is effectively nothing to compact', () => {
    expect(safeCutIndex([{ role: 'user', content: 'hi' }])).toBe(-1);
  });
});

describe('deriveTitle', () => {
  it('takes the first line', () => {
    expect(deriveTitle('fix the parser\nmore detail')).toBe('fix the parser');
  });

  it('truncates long titles with an ellipsis', () => {
    const title = deriveTitle('x'.repeat(100));
    expect(title.length).toBeLessThanOrEqual(58);
    expect(title.endsWith('…')).toBe(true);
  });

  it('returns empty for blank input', () => {
    expect(deriveTitle('   \n  ')).toBe('');
  });
});
