import { describe, it, expect } from 'vitest';
import { resolveInside, patternEscapes } from '../src/utils/safepath.js';
import { tmpdir } from 'node:os';

describe('resolveInside', () => {
  const root = tmpdir();

  it('allows paths inside the workspace', () => {
    const r = resolveInside(root, 'src/index.ts');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.relative).toBe('src/index.ts');
  });

  it('rejects parent-directory traversal', () => {
    const r = resolveInside(root, '../../../etc/passwd');
    expect(r.ok).toBe(false);
  });

  it('rejects absolute paths outside the root', () => {
    const r = resolveInside(root, '/etc/passwd');
    expect(r.ok).toBe(false);
  });

  it('treats the root itself as "."', () => {
    const r = resolveInside(root, '.');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.relative).toBe('.');
  });
});

describe('patternEscapes', () => {
  it('flags absolute and traversal globs', () => {
    expect(patternEscapes('/abs/**')).toBe(true);
    expect(patternEscapes('../**/*.ts')).toBe(true);
    expect(patternEscapes('src/**/*.ts')).toBe(false);
  });
});
