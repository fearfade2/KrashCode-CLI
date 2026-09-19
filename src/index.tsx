import React from 'react';
import { render } from 'ink';
import { Command } from 'commander';
import App from './components/App.js';
import dotenv from 'dotenv';

dotenv.config();

const program = new Command();

program
  .name('krashcode')
  .description('Современный терминальный ИИ-агент для написания кода')
  .version('1.0.0');

program
  .command('chat')
  .description('Запустить интерактивный TUI чат (по умолчанию)')
  .action(() => {
    render(<App />);
  });

program
  .command('config')
  .description('Показать текущую конфигурацию')
  .action(() => {
    console.log('Конфигурация KrashCode:\n- Стек: Vercel AI SDK + Ink\n- Статус: В разработке 🚀');
  });

// Если аргументов нет, запускаем 'chat'
if (process.argv.length === 2) {
  process.argv.push('chat');
}

program.parse(process.argv);

