# KrashCode

```text
  _  __               _      ____          _      
 | |/ /_ __ __ _ ___ | |__  / ___|___   __| | ___ 
 | ' /| '__/ _` / __|| '_ \| |   / _ \ / _` |/ _ \
 | . \| | | (_| \__ \| | | | |__| (_) | (_| |  __/
 |_|\_\_|  \__,_|___/|_| |_|\____\___/ \__,_|\___|
```

KrashCode — терминальный ИИ-агент для работы с кодом. Читает и изменяет файлы, ищет по проекту,
запускает команды и стримит ответы в интерактивном TUI.

Построен на TypeScript, React/Ink и Vercel AI SDK. Поддерживает OpenAI, Anthropic, Google и
OpenAI-совместимые провайдеры (OpenRouter, Ollama и т.д.).

## Возможности

- потоковые ответы от ИИ в реальном времени
- чтение, создание и точечное редактирование файлов
- поиск по именам и содержимому файлов (glob/grep)
- запуск shell-команд
- переключение моделей и провайдеров
- сохранение и восстановление сессий
- slash-команды (`/model`, `/clear`, `/exit`)
- стильный минималистичный TUI

## Требования

- Node.js 22+
- npm

## Установка

```sh
git clone https://github.com/your-username/KrashCode.git
cd KrashCode
npm install
npm run build
npm link
```

## Настройка

```sh
# OpenAI
krashcode setup openai --model gpt-4o

# Anthropic
krashcode setup anthropic --model claude-sonnet-4-20250514

# Google
krashcode setup google --model gemini-2.5-flash

# OpenRouter
krashcode setup openrouter --model openai/gpt-4o --key-env OPENROUTER_API_KEY

# Локальный сервер (Ollama)
krashcode setup custom --model llama3 --base-url http://localhost:11434/v1
```

API-ключ берётся из стандартных переменных окружения (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY` и т.д.)
или из `--key-env`.

## Запуск

```sh
krashcode          # запустить TUI
krashcode config   # показать конфиг
krashcode sessions # показать сессии
```

## Команды внутри TUI

| Команда | Действие |
|---------|----------|
| `/model <name>` | Сменить модель |
| `/clear` | Очистить чат |
| `/exit` | Выйти |
| `Esc` | Прервать запрос / Выйти |

## Встроенные инструменты

| Инструмент | Описание |
|------------|----------|
| `read` | Чтение файла с нумерацией строк |
| `write` | Создание/перезапись файла |
| `edit` | Точечная замена фрагмента в файле |
| `bash` | Запуск shell-команды |
| `glob` | Поиск файлов по паттерну |
| `grep` | Поиск по содержимому файлов (regex) |

## Разработка

```sh
npm run dev        # запустить через tsx
npm run build      # собрать dist/
npm run typecheck  # проверить TypeScript
```

## Лицензия

MIT
