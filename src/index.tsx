import React from 'react';
import { render } from 'ink';
import { Command } from 'commander';
import App from './components/App.js';
import { loadConfig, saveConfig, resolveApiKey, getConfigDir } from './core/config.js';
import { listSessions } from './core/session.js';
import dotenv from 'dotenv';
import { resolve } from 'node:path';

dotenv.config();

const VERSION = '1.0.0';

const program = new Command();

program
  .name('krashcode')
  .description('Terminal coding agent — KrashCode')
  .version(VERSION);

program
  .command('chat', { isDefault: true })
  .description('Start interactive TUI chat')
  .option('--cwd <path>', 'Use a different working directory')
  .option('--model <ref>', 'Start with this model')
  .action((options: { cwd?: string; model?: string }) => {
    let cwd = options.cwd;
    if (cwd) {
      try { cwd = resolve(cwd); } catch { /* keep as-is */ }
    }
    render(<App cwd={cwd} modelOverride={options.model} />);
  });

program
  .command('config')
  .description('Show current configuration')
  .action(async () => {
    const cfg = await loadConfig();
    const dir = getConfigDir();
    console.log(`Config dir:  ${dir}`);
    console.log(`Provider:    ${cfg.provider}`);
    console.log(`Model:       ${cfg.model}`);
    console.log(`Max tokens:  ${cfg.maxTokens}`);
    console.log(`Base URL:    ${cfg.baseUrl ?? '(default)'}`);
    console.log(`API key:     ${resolveApiKey(cfg) ? '***set***' : '(not set)'}`);
  });

program
  .command('setup')
  .description('Configure provider and API key')
  .argument('<provider>', 'Provider: openai | anthropic | google | openrouter | custom')
  .option('--model <model>', 'Model ID')
  .option('--base-url <url>', 'Base URL for custom/openrouter provider')
  .option('--key-env <name>', 'Read API key from this env variable')
  .action(async (
    provider: string,
    options: { model?: string; baseUrl?: string; keyEnv?: string },
  ) => {
    const valid = ['openai', 'anthropic', 'google', 'openrouter', 'custom'] as const;
    if (!valid.includes(provider as any)) {
      console.error(`Unknown provider "${provider}". Use: ${valid.join(', ')}`);
      process.exitCode = 1;
      return;
    }
    const cfg = await loadConfig();
    cfg.provider = provider as typeof cfg.provider;
    if (options.model) cfg.model = options.model;
    if (options.baseUrl) cfg.baseUrl = options.baseUrl;
    if (options.keyEnv) cfg.keyEnv = options.keyEnv;
    await saveConfig(cfg);
    console.log(`✓ Provider set to ${provider}${options.model ? `, model: ${options.model}` : ''}`);
  });

program
  .command('sessions')
  .description('List saved sessions')
  .action(async () => {
    const entries = await listSessions();
    if (entries.length === 0) {
      console.log('No saved sessions.');
      return;
    }
    for (const s of entries) {
      console.log(
        `${s.id.slice(0, 12)}  ${s.updatedAt.slice(0, 16).replace('T', ' ')}  ` +
        `${String(s.messageCount).padStart(3)} msgs  ${s.cwd}`,
      );
      if (s.title) console.log(`  ${s.title}`);
    }
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
