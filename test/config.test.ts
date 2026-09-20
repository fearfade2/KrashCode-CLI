import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import { defaultConfig, configSchema, THEME_IDS } from '../src/core/types.js';

let directory: string;
let config: typeof import('../src/core/config.js');
beforeAll(async () => {
  // Keep all filesystem fixtures inside the workspace, never the real user home.
  directory = await mkdtemp(join(process.cwd(), '.krashcode-test-'));
  vi.stubEnv('KRASHCODE_HOME', directory);
  config = await import('../src/core/config.js');
});
afterAll(async () => { vi.unstubAllEnvs(); await rm(directory, { recursive: true, force: true }); });

describe('appearance configuration on disk', () => {
  it('keeps old configurations compatible', () => {
    const parsed = configSchema.parse({ model: 'custom-model' });
    expect(parsed.theme).toBe('system'); expect(parsed.motion).toBe('full');
    expect(parsed.model).toBe('custom-model');
  });

  it.each(THEME_IDS)('saves and reloads the %s theme', async (theme) => {
    await config.saveConfig({ ...defaultConfig(), theme, motion: 'reduced' });
    expect(await config.loadConfig()).toMatchObject({ theme, motion: 'reduced' });
  });

  it('recovers invalid preferences without losing provider settings', async () => {
    await writeFile(config.getConfigFile(), JSON.stringify({ model: 'keep-me', theme: 'unknown', motion: 'unknown' }));
    expect(await config.loadConfig()).toMatchObject({ model: 'keep-me', theme: 'system', motion: 'full' });
  });

  it('recovers from malformed JSON', async () => {
    await writeFile(config.getConfigFile(), '{broken');
    expect(await config.loadConfig()).toEqual(defaultConfig());
  });

  it('serializes overlapping saves in invocation order', async () => {
    const snapshot = { ...defaultConfig(), theme: 'forest' as const };
    const first = config.saveConfig(snapshot);
    snapshot.model = 'not-part-of-snapshot';
    const second = config.saveConfig({ ...defaultConfig(), theme: 'paper', motion: 'off' });
    await Promise.all([first, second]);
    const raw = JSON.parse(await readFile(config.getConfigFile(), 'utf8'));
    expect(raw).toMatchObject({ theme: 'paper', motion: 'off', model: defaultConfig().model });
  });
});
