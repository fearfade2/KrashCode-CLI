import { describe, it, expect } from 'vitest';
import { createPermissionEngine } from '../src/core/permissions.js';

describe('permission engine', () => {
  it('normal mode: mutating tools ask, read-only allow', () => {
    const p = createPermissionEngine({}, 'normal');
    expect(p.decide('write')).toBe('ask');
    expect(p.decide('edit')).toBe('ask');
    expect(p.decide('bash')).toBe('ask');
    expect(p.decide('read')).toBe('allow');
    expect(p.decide('glob')).toBe('allow');
    expect(p.decide('grep')).toBe('allow');
  });

  it('plan mode: mutating tools denied, read-only allowed', () => {
    const p = createPermissionEngine({}, 'plan');
    expect(p.decide('write')).toBe('deny');
    expect(p.decide('bash')).toBe('deny');
    expect(p.decide('read')).toBe('allow');
    expect(p.denyReason('write')).toContain('plan');
  });

  it('accept mode: write/edit auto-allowed, bash still asks', () => {
    const p = createPermissionEngine({}, 'accept');
    expect(p.decide('write')).toBe('allow');
    expect(p.decide('edit')).toBe('allow');
    expect(p.decide('bash')).toBe('ask');
  });

  it('config deny overrides everything', () => {
    const p = createPermissionEngine({ bash: 'deny' }, 'normal');
    expect(p.decide('bash')).toBe('deny');
    p.bypass.enable();
    expect(p.decide('bash')).toBe('deny');
  });

  it('bypass turns ask into allow', () => {
    const p = createPermissionEngine({}, 'normal');
    expect(p.decide('write')).toBe('ask');
    p.bypass.enable();
    expect(p.decide('write')).toBe('allow');
    p.bypass.disable();
    expect(p.decide('write')).toBe('ask');
  });

  it('session grant persists for that tool', () => {
    const p = createPermissionEngine({}, 'normal');
    expect(p.decide('bash')).toBe('ask');
    p.grantForSession('bash');
    expect(p.decide('bash')).toBe('allow');
  });

  it('mode cycles normal -> accept -> plan -> normal', () => {
    const p = createPermissionEngine({}, 'normal');
    expect(p.mode.cycle()).toBe('accept');
    expect(p.mode.cycle()).toBe('plan');
    expect(p.mode.cycle()).toBe('normal');
  });
});
