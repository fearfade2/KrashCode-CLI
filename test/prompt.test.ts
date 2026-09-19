import { describe, it, expect } from 'vitest';
import { buildSystemPrompt } from '../src/core/prompt.js';

const base = { cwd: '/work/repo', toolNames: ['read', 'edit', 'bash'], language: 'en' as const };

describe('buildSystemPrompt', () => {
  it('embeds cwd, tools and identity', () => {
    const p = buildSystemPrompt(base);
    expect(p).toContain('You are KrashCode');
    expect(p).toContain('Working directory: /work/repo');
    expect(p).toContain('Tools: read, edit, bash');
  });

  it('adds the plan-mode block only in plan mode', () => {
    expect(buildSystemPrompt({ ...base, mode: 'plan' })).toContain('PLAN MODE');
    expect(buildSystemPrompt({ ...base, mode: 'normal' })).not.toContain('PLAN MODE');
    expect(buildSystemPrompt(base)).not.toContain('PLAN MODE');
  });

  it('picks the reply language from the language flag', () => {
    expect(buildSystemPrompt({ ...base, language: 'ru' })).toContain('in Russian');
    expect(buildSystemPrompt({ ...base, language: 'en' })).toContain('language the user writes');
  });

  it('includes project notes only when memory is non-empty', () => {
    expect(buildSystemPrompt({ ...base, memory: 'prefers tabs' })).toContain('prefers tabs');
    expect(buildSystemPrompt({ ...base, memory: '   ' })).not.toContain('Project notes');
  });
});
