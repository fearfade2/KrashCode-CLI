import React from 'react';
import { render } from 'ink';
import { Command } from 'commander';
import App from './components/App.js';
import { loadConfig, saveConfig, resolveApiKey, getConfigDir, setApiKey } from './core/config.js';
import { listSessions } from './core/session.js';
import type { ProviderKind } from './core/types.js';
import { killAllJobs } from './tools/jobs.js';
import dotenv from 'dotenv';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';

dotenv.config({ quiet: true });

// Подстраховка: если процесс завершится любым путём, гасим фоновые команды,
// чтобы detached dev-серверы/watcher'ы не оставались сиротами.
process.on('exit', () => killAllJobs());

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
  .option('-c, --continue', 'Resume the most recent session for this directory')
  .option('-r, --resume <id>', 'Resume a session by id')
  .action(async (options: { cwd?: string; model?: string; continue?: boolean; resume?: string }) => {
    let cwd = options.cwd;
    if (cwd) {
      try { cwd = resolve(cwd); } catch { /* keep as-is */ }
    }
    const workDir = cwd ?? process.cwd();

    let resumeId = options.resume;
    if (!resumeId && options.continue) {
      const entries = await listSessions();
      resumeId = entries.find((s) => s.cwd === workDir)?.id ?? entries[0]?.id;
    }

    // exitOnCtrlC=false: Ctrl-C обрабатываем сами в App (сохранить сессию, погасить джобы).
    render(<App cwd={cwd} modelOverride={options.model} resumeId={resumeId} />, { exitOnCtrlC: false });
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

    // Если ключ не берётся из env, спрашиваем его скрытым вводом и храним в auth.json (0600).
    if (!options.keyEnv) {
      const key = await promptHidden(`API key for ${provider} (Enter — пропустить): `);
      if (key.trim()) {
        await setApiKey(provider as ProviderKind, key.trim());
        console.log('✓ API key saved to auth.json (0600).');
      }
    }
    console.log(`✓ Provider set to ${provider}${options.model ? `, model: ${options.model}` : ''}`);
  });

program
  .command('key')
  .description('Set or update the API key for a provider')
  .argument('<provider>', 'openai | anthropic | google | openrouter | custom')
  .action(async (provider: string) => {
    const valid = ['openai', 'anthropic', 'google', 'openrouter', 'custom'] as const;
    if (!valid.includes(provider as (typeof valid)[number])) {
      console.error(`Unknown provider "${provider}". Use: ${valid.join(', ')}`);
      process.exitCode = 1;
      return;
    }
    const key = await promptHidden(`API key for ${provider}: `);
    if (!key.trim()) {
      console.log('No key entered — nothing changed.');
      return;
    }
    await setApiKey(provider as ProviderKind, key.trim());
    console.log('✓ API key saved to auth.json (0600).');
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

// Скрытый ввод: не эхоим набранный ключ в терминал.
function promptHidden(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const stdout = process.stdout as NodeJS.WriteStream & { _writeToOutput?: (s: string) => void };
    let first = true;
    stdout._writeToOutput = (str: string) => {
      if (first) {
        stdout.write(str);
        first = false;
      }
      // после вывода приглашения глушим эхо символов
    };
    rl.question(prompt, (answer) => {
      stdout._writeToOutput = undefined;
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
  });
}

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
