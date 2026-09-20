import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Box, Text, Static, useApp, useStdout } from 'ink';
import type { ModelMessage } from 'ai';
import { PromptInput } from './PromptInput.js';
import { closestCommand } from './commands.js';
import Message from './Message.js';
import type { ChatMsg } from './Message.js';
import ToolCall from './ToolCall.js';
import StatusBar, { Activity, StreamingCursor } from './StatusBar.js';
import { useTerminalSize, useTerminalInput } from '../ui/terminal-size.js';
import { ApprovalPrompt, type ApprovalRequest } from './ApprovalPrompt.js';
import { Picker, type PickerItem, type PickerOptions } from './Picker.js';
import { TextPrompt } from './TextPrompt.js';
import { createModel, runAgent, planReasoning, type AgentCallbacks, type StepUsage } from '../core/agent.js';
import { loadConfig, saveConfig, loadAuth, setApiKey, resolveApiKey } from '../core/config.js';
import { buildSystemPrompt } from '../core/prompt.js';
import { createPermissionEngine } from '../core/permissions.js';
import { readMemory, saveMemory, clearMemory } from '../core/memory.js';
import { compactHistory, estimateTokens, shouldAutoCompact } from '../core/compact.js';
import { detectDiagnostics } from '../core/diagnostics.js';
import { emptyUsage, addUsage, formatUsageReport, formatUsageLine } from '../core/usage.js';
import {
  createSessionMeta,
  saveSession,
  loadSession,
  listSessions,
  deriveTitle,
} from '../core/session.js';
import { createTools } from '../tools/index.js';
import type { AgentMode, Effort, KrashConfig, ProviderKind, SessionData, UsageTotals, ThemeId, MotionMode } from '../core/types.js';
import { defaultConfig, THEME_IDS, MOTION_MODES, MODES, EFFORTS, MODEL_SUGGESTIONS, DEFAULT_BASE_URL, CONVENTIONAL_KEY_ENV } from '../core/types.js';
import { discoverModels, type DiscoveredModel } from '../core/discovery.js';
import { resetJobs, killAllJobs } from '../tools/jobs.js';
import { useTheme, useAppearance, AppearanceProvider, THEMES, MOTION_LABELS, G } from '../ui/theme.js';
import { Logo, WelcomePanel } from './Logo.js';

interface AppProps {
  cwd?: string;
  modelOverride?: string;
  resumeId?: string;
}

type Overlay =
  | { kind: 'none' }
  | { kind: 'approval'; request: ApprovalRequest; resolve: (d: 'once' | 'always' | 'deny') => void }
  | { kind: 'picker'; title: string; items: PickerItem[]; select: (key: string) => void; options?: PickerOptions }
  | {
      kind: 'prompt';
      title: string;
      hint?: string;
      initial?: string;
      placeholder?: string;
      secret?: boolean;
      resolve: (value: string | null) => void;
    };

const PROVIDER_KINDS: ProviderKind[] = ['openai', 'anthropic', 'google', 'openrouter', 'custom'];
const PROVIDER_LABELS: Record<ProviderKind, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  google: 'Google Gemini',
  openrouter: 'OpenRouter',
  custom: 'Свой (OpenAI-совместимый: Ollama, LM Studio, vLLM…)',
};

const MANUAL_MODEL_KEY = '__manual__';

// Маркер шапки в списке <Static>: всегда первый элемент, чтобы логотип и строка
// cwd тоже уходили в скроллбек один раз, а не перерисовывались каждый кадр.
const HEADER_ITEM = { __header: true } as const;

// Короткие пояснения к уровням усилий для пикера /effort.
const EFFORT_HINTS: Record<Effort, string> = {
  auto: 'по содержанию запроса',
  low: 'минимум размышления',
  medium: 'умеренно',
  high: 'подробно',
  xhigh: 'очень подробно',
  max: 'максимум (медленнее)',
};

// Собирает пункты пикера моделей: сначала живые модели от провайдера (если
// нашлись), иначе — статичные подсказки; в конце всегда «ввести вручную».
function modelPickerItems(
  discovered: DiscoveredModel[],
  fallback: string[],
  current?: string,
): PickerItem[] {
  const source: PickerItem[] =
    discovered.length > 0
      ? discovered.map((m) => ({
          key: m.id,
          label: m.id,
          hint: m.id === current ? 'текущая' : m.contextWindow ? `${Math.round(m.contextWindow / 1000)}k` : undefined,
        }))
      : fallback.map((m) => ({ key: m, label: m, hint: m === current ? 'текущая' : undefined }));
  return [...source, { key: MANUAL_MODEL_KEY, label: 'Ввести вручную…' }];
}

let nextId = 0;
const uid = (): string => `msg-${++nextId}`;

export default function App(props: AppProps) {
  return <AppearanceProvider><AppContent {...props} /></AppearanceProvider>;
}

function AppContent({ cwd, modelOverride, resumeId }: AppProps) {
  const T = useTheme();
  const { setTheme, setMotion } = useAppearance();
  const { exit } = useApp();
  const [messages, setMessageState] = useState<ChatMsg[]>([]);
  const messagesRef = useRef<ChatMsg[]>([]);
  const setMessages = useCallback((next: React.SetStateAction<ChatMsg[]>) => {
    const value = typeof next === 'function' ? next(messagesRef.current) : next;
    messagesRef.current = value;
    setMessageState(value);
  }, []);
  const [input, setInput] = useState('');
  const [inputHistory, setInputHistory] = useState<string[]>([]);
  const [commandBusy, setCommandBusy] = useState(false);
  const commandLock = useRef(false);
  const [busy, setBusy] = useState(false);
  const [streaming, setStreaming] = useState('');
  const [reasoning, setReasoning] = useState('');
  // Инструменты текущего (ещё не зафиксированного) хода. Держим отдельно от
  // messages: завершённые сообщения уходят в <Static> и больше не перерисовываются,
  // поэтому «живой» ход рендерим ниже статики из этого состояния.
  const [liveTools, setLiveTools] = useState<NonNullable<ChatMsg['toolCalls']>>([]);
  // Меняется при /clear и загрузке сессии — пересоздаёт <Static>, чтобы он забыл
  // уже выведенные в скроллбек строки (иначе очистка не убрала бы их с экрана).
  const [staticKey, setStaticKey] = useState(0);
  const [model, setModel] = useState(modelOverride ?? '');
  const [mode, setMode] = useState<AgentMode>('normal');
  const [usage, setUsage] = useState<UsageTotals>(emptyUsage());
  const [turnStart, setTurnStart] = useState<number | null>(null);
  const [ready, setReady] = useState(false);
  const [overlay, setOverlay] = useState<Overlay>({ kind: 'none' });
  const [, forceRender] = useState(0);

  const historyRef = useRef<ModelMessage[]>([]);
  const configRef = useRef<KrashConfig | null>(null);
  const sessionRef = useRef<SessionData | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const permissionsRef = useRef(createPermissionEngine({}, 'normal'));
  const workDir = cwd ?? process.cwd();
  const { stdout } = useStdout();
  const { rows, columns } = useTerminalSize();

  // Полная очистка экрана + скроллбека (как \x1b[2J\x1b[3J\x1b[H в KitCode).
  // Нужна вместе с пересозданием <Static>: сама по себе смена ключа не стирает
  // уже выведенные в историю терминала строки.
  const clearScreen = useCallback(() => {
    if (stdout.isTTY) stdout.write('\x1b[2J\x1b[3J\x1b[H');
  }, [stdout]);

  // ── Инициализация ────────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      const cfg = await loadConfig();
      configRef.current = cfg;
      setTheme(cfg.theme);
      setMotion(cfg.motion);
      permissionsRef.current = createPermissionEngine(cfg.permissions, cfg.mode);
      setMode(cfg.mode);
      modeRef.current = cfg.mode;
      if (!modelOverride) setModel(cfg.model);

      if (resumeId) {
        const loaded = await loadSession(resumeId);
        if (loaded) {
          sessionRef.current = loaded;
          historyRef.current = loaded.history;
          setMessages(loaded.messages.map((m) => ({ ...m })));
          setModel(loaded.meta.model || cfg.model);
          if (loaded.usage) setUsageSynced(loaded.usage);
        }
      }
      if (!sessionRef.current) {
        sessionRef.current = { meta: createSessionMeta(workDir, modelOverride ?? cfg.model), history: [], messages: [], usage: emptyUsage() };
      }
      setReady(true);
    })().catch((error) => {
      const cfg = configRef.current ?? defaultConfig();
      configRef.current = cfg;
      if (!sessionRef.current) sessionRef.current = { meta: createSessionMeta(workDir, cfg.model), history: [], messages: [], usage: emptyUsage() };
      notice(`Не удалось восстановить сессию: ${error instanceof Error ? error.message : String(error)}`);
      setReady(true);
    });
  }, []);

  // Зеркала для доступа из колбэков без устаревших замыканий.
  // usageRef — авторитетный источник (не зеркало state): пишется синхронно в
  // onStep, поэтому persist на финише не теряет токены последнего шага. Мирроринг
  // из state тут запрещён — он затирал бы синхронное накопление устаревшим значением.
  const usageRef = useRef<UsageTotals>(usage);
  const setUsageSynced = useCallback((next: UsageTotals) => {
    usageRef.current = next;
    setUsage(next);
  }, []);
  const inputRef = useRef(input);
  inputRef.current = input;
  // mode читаем из ref в afterTurn, чтобы не пересоздавать runTurn на каждый /mode.
  const modeRef = useRef<AgentMode>('normal');
  modeRef.current = mode;

  const notice = useCallback((content: string) => {
    setMessages((prev) => [...prev, { id: uid(), role: 'assistant', content }]);
  }, []);

  const persist = useCallback(async () => {
    const session = sessionRef.current;
    if (!session) return;
    session.history = historyRef.current;
    session.messages = messagesRef.current;
    session.usage = usageRef.current;
    session.meta.model = model;
    if (!session.meta.title) {
      const firstUser = messagesRef.current.find((m) => m.role === 'user');
      if (firstUser) session.meta.title = deriveTitle(firstUser.content);
    }
    try {
      await saveSession(session);
    } catch {
      /* сохранение сессии не должно ронять UI */
    }
  }, [model]);

  const pick = useCallback(
    (title: string, items: PickerItem[], options?: PickerOptions) =>
      new Promise<string | null>((resolve) => {
        if (items.length === 0) {
          resolve(null);
          return;
        }
        setOverlay({ kind: 'picker', title, items, select: resolve, options });
      }),
    [],
  );

  const prompt = useCallback(
    (opts: { title: string; hint?: string; initial?: string; placeholder?: string; secret?: boolean }) =>
      new Promise<string | null>((resolve) => {
        setOverlay({ kind: 'prompt', ...opts, resolve });
      }),
    [],
  );

  // ── Запуск агента ──────────────────────────────────────────────────────────
  const runTurn = useCallback(async () => {
    const cfg = configRef.current;
    if (!cfg || abortRef.current) return;

    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    setStreaming('');
    setReasoning('');
    setLiveTools([]);
    setTurnStart(Date.now());

    const activeModel = model || cfg.model;
    const changedFiles = new Set<string>();
    const assistantId = uid();
    const toolCalls: NonNullable<ChatMsg['toolCalls']> = [];
    // Буферы хода: накапливаем текст/reasoning по всем шагам, чтобы при
    // завершении ИЛИ прерывании ничего не потерять (result.text = только
    // последний шаг, а прерванный ход onFinish вообще не зовёт).
    let turnText = '';
    let turnReasoning = '';
    let counted: StepUsage = { inputTokens: 0, outputTokens: 0 };

    // Фиксирует накопленный текст/reasoning/tool-calls в постоянное сообщение.
    // Дописывает ОДНО сообщение в messages (уходит в <Static>) — в отличие от
    // прежней live-мутации массива, несовместимой со <Static>.
    const commitAssistant = () => {
      if (turnText || turnReasoning || toolCalls.length > 0) {
        setMessages((prev) => [
          ...prev,
          {
            id: assistantId,
            role: 'assistant',
            content: turnText,
            reasoning: turnReasoning || undefined,
            toolCalls: [...toolCalls],
          },
        ]);
      }
    };

    let finalized = false;
    const endTurn = () => {
      setOverlay((current) => current.kind === 'approval' ? { kind: 'none' } : current);
      setBusy(false);
      setStreaming('');
      setReasoning('');
      setLiveTools([]);
      setTurnStart(null);
      abortRef.current = null;
    };

    // Прерывание (Esc/Ctrl-C): фиксируем частичный ответ и сохраняем. Слушатель
    // ставим ДО любых await (loadAuth/сжатие/readMemory) — иначе Esc во время них
    // прервёт сигнал раньше подписки, и ход навсегда завис бы в busy.
    const finalize = () => {
      if (finalized) return;
      finalized = true;
      for (const call of toolCalls) if (call.result === undefined) { call.result = 'Прервано пользователем'; call.isError = true; }
      commitAssistant();
      endTurn();
      void persist();
    };
    controller.signal.addEventListener('abort', finalize, { once: true });

    const fail = (error: unknown) => {
      if (finalized) return;
      finalized = true;
      for (const call of toolCalls) if (call.result === undefined) { call.result = 'Выполнение остановлено'; call.isError = true; }
      commitAssistant();
      endTurn();
      notice(`Ошибка: ${error instanceof Error ? error.message : String(error)}. Проверьте /provider и /model.`);
      void persist();
    };

    try {
      const auth = await loadAuth();

      // Авто-сжатие контекста перед ходом, если он подобрался к лимиту модели.
      if (cfg.autoCompact && shouldAutoCompact(estimateTokens(historyRef.current), cfg.maxContextTokens)) {
        try {
          const lm = createModel({ ...cfg, model: activeModel }, auth);
          const result = await compactHistory(lm, historyRef.current, controller.signal);
          if (result.compacted) {
            historyRef.current = result.history;
            notice(`Контекст сжат автоматически: свёрнуто ${result.removed} сообщений.`);
          }
        } catch {
          /* не удалось сжать — продолжаем как есть, ход всё равно попробуем */
        }
      }

      // Прервали во время предстартовых await — finalize уже отработал, выходим.
      if (controller.signal.aborted) return;

      const languageModel = createModel({ ...cfg, model: activeModel }, auth);
      const reasoningPlan = planReasoning({ ...cfg, model: activeModel }, activeModel, cfg.maxTokens);
      const memory = await readMemory(workDir).catch(() => '');
      if (controller.signal.aborted) return;

      const tools = createTools(workDir, {
        signal: controller.signal,
        permissions: permissionsRef.current,
        approve: (name, input) =>
          new Promise((resolve) => {
            if (controller.signal.aborted) {
              resolve('deny');
              return;
            }
            const onAbort = () => { setOverlay({ kind: 'none' }); resolve('deny'); };
            controller.signal.addEventListener('abort', onAbort, { once: true });
            setOverlay({
              kind: 'approval',
              request: { name, input },
              resolve: (d) => {
                controller.signal.removeEventListener('abort', onAbort);
                resolve(d);
              },
            });
          }),
        memory: {
          read: () => memory,
          save: (text) => saveMemory(workDir, text),
          isPlanMode: () => modeRef.current === 'plan',
        },
        onFileChanged: (path) => changedFiles.add(path),
      });

      const callbacks: AgentCallbacks = {
        onTextDelta: (delta) => {
          if (finalized || controller.signal.aborted) return;
          turnText += delta;
          setStreaming((prev) => prev + delta);
        },
        onReasoningDelta: (delta) => {
          if (finalized || controller.signal.aborted) return;
          turnReasoning += delta;
          setReasoning((prev) => prev + delta);
        },
        onToolCall: (id, name, args) => {
          if (finalized || controller.signal.aborted) return;
          toolCalls.push({ id, name, args });
          setLiveTools([...toolCalls]);
        },
        onToolResult: (id, _name, result, isError) => {
          if (finalized || controller.signal.aborted) return;
          const tc = toolCalls.find((t) => t.id === id);
          if (tc) {
            tc.result = result;
            tc.isError = isError;
          }
          setLiveTools([...toolCalls]);
        },
        onStep: (stepMessages, stepUsage) => {
          if (finalized || controller.signal.aborted) return;
          historyRef.current = [...historyRef.current, ...stepMessages];
          // Учитываем токены по шагам: прерванный/упавший ход всё равно посчитан.
          counted = {
            inputTokens: counted.inputTokens + stepUsage.inputTokens,
            outputTokens: counted.outputTokens + stepUsage.outputTokens,
          };
          // Пишем в ref синхронно (авторитетный источник для persist), затем в state.
          // Иначе setUsage асинхронный, и persist на финише сохранил бы прошлый шаг.
          setUsageSynced(addUsage(usageRef.current, activeModel, stepUsage.inputTokens, stepUsage.outputTokens));
          // Предохранитель от разгона: прерываем ход, если он превысил лимит токенов.
          const total = counted.inputTokens + counted.outputTokens;
          if (cfg.maxTokensPerTurn > 0 && total > cfg.maxTokensPerTurn) {
            // abort() синхронно зовёт finalize → commit частичного ответа, и лишь
            // затем notice: так уведомление встаёт ПОСЛЕ ответа в истории.
            controller.abort();
            notice(`Ход остановлен: превышен лимит ${cfg.maxTokensPerTurn} токенов за ход.`);
          }
        },
        onFinish: () => {
          if (finalized) return;
          finalized = true;
          commitAssistant();
          endTurn();
          void afterTurn(changedFiles).catch((error) => notice(`Проверка проекта: ${String(error)}`));
        },
        onError: fail,
      };

      await runAgent(
        {
          model: languageModel,
          system: buildSystemPrompt({
            cwd: workDir,
            toolNames: Object.keys(tools),
            memory,
            language: cfg.language,
            mode: modeRef.current,
          }),
          messages: historyRef.current,
          tools,
          maxOutputTokens: reasoningPlan.maxOutputTokens,
          providerOptions: reasoningPlan.providerOptions,
          signal: controller.signal,
        },
        callbacks,
      );
    } catch (error) { fail(error); }
    finally { controller.signal.removeEventListener('abort', finalize); }
  }, [model, workDir, notice, persist, setUsageSynced]);

  // Авто-диагностика после хода, если менялись файлы.
  const afterTurn = useCallback(
    async (changedFiles: Set<string>) => {
      await persist();
      const cfg = configRef.current;
      if (!cfg?.autoDiagnostics || changedFiles.size === 0 || modeRef.current === 'plan') return;
      const commands = await detectDiagnostics(workDir);
      if (commands.length > 0) {
        notice(`После правок можно проверить: ${commands.join(', ')} (запусти сам или попроси меня).`);
      }
    },
    [persist, workDir, notice],
  );

  // ── Slash-команды ────────────────────────────────────────────────────────
  const handleSlash = useCallback(
    async (line: string) => {
      const body = line.slice(1).trim();
      const [cmd = '', ...rest] = body.split(/\s+/);
      const arg = rest.join(' ').trim();
      setInput('');

      switch (cmd.toLowerCase()) {
        case 'exit':
        case 'quit':
          await persist();
          killAllJobs();
          exit();
          return;

        case 'clear': {
          if (abortRef.current) abortRef.current.abort();
          resetJobs();
          historyRef.current = [];
          setMessages([]);
          // Пересоздаём <Static> и чистим экран: иначе выведенные в скроллбек
          // сообщения остались бы на экране, хотя state уже пуст.
          setStaticKey((k) => k + 1);
          clearScreen();
          setUsageSynced(emptyUsage());
          sessionRef.current = {
            meta: createSessionMeta(workDir, model),
            history: [],
            messages: [],
            usage: emptyUsage(),
          };
          return;
        }

        case 'theme': {
          const cfg = configRef.current;
          if (!cfg) return;
          const previous = cfg.theme;
          let chosen = arg.toLowerCase();
          if (!chosen) {
            chosen = await pick('Тема оформления', THEME_IDS.map((id) => ({
              key: id, label: THEMES[id].name, hint: id === previous ? 'текущая' : THEMES[id].description,
            })), { initialKey: previous, preview: true, onHighlight: (id) => setTheme(id as ThemeId) }) ?? '';
          }
          if (!chosen) { setTheme(previous); return; }
          if (!THEME_IDS.includes(chosen as ThemeId)) {
            notice(`Неизвестная тема: ${chosen}. Доступны: ${THEME_IDS.join(', ')}.`);
            return;
          }
          const next = { ...cfg, theme: chosen as ThemeId };
          try { await saveConfig(next); }
          catch (error) { setTheme(previous); throw error; }
          configRef.current = next;
          setTheme(next.theme);
          notice(`Тема ${THEMES[next.theme].name} сохранена. /theme — изменить.`);
          return;
        }

        case 'motion': {
          const cfg = configRef.current;
          if (!cfg) return;
          const chosen = arg.toLowerCase() || await pick('Анимации', MOTION_MODES.map((id) => ({
            key: id, label: id, hint: MOTION_LABELS[id],
          })), { initialKey: cfg.motion });
          if (!chosen) return;
          if (!MOTION_MODES.includes(chosen as MotionMode)) {
            notice('Режимы анимации: full, reduced, off.');
            return;
          }
          const next = { ...cfg, motion: chosen as MotionMode };
          await saveConfig(next);
          configRef.current = next;
          setMotion(next.motion);
          notice(`Анимации: ${MOTION_LABELS[next.motion]}. Настройка сохранена.`);
          return;
        }

        case 'model': {
          if (arg) {
            setModel(arg);
            if (configRef.current) {
              configRef.current.model = arg;
              await saveConfig(configRef.current);
            }
            notice(`Модель: ${arg}`);
            return;
          }
          const cfg = configRef.current;
          const provider = (cfg?.provider ?? 'openai') as ProviderKind;
          const current = model || cfg?.model;

          // Тянем список моделей прямо у провайдера. Не вышло — молча падаем на
          // статичные подсказки (плюс всегда есть «ввести вручную»).
          notice('Загружаю список моделей у провайдера…');
          const auth = await loadAuth();
          const key = cfg ? resolveApiKey({ ...cfg, provider }, auth) : '';
          const { models, error } = await discoverModels(provider, cfg?.baseUrl, key);
          if (error && models.length === 0) {
            notice(`Не удалось получить модели от провайдера (${error}). Показываю подсказки.`);
          }

          let chosen = await pick(
            models.length > 0 ? `Модель · найдено ${models.length}` : 'Модель',
            modelPickerItems(models, MODEL_SUGGESTIONS[provider] ?? [], current),
          );
          if (chosen === null || chosen === '') return;
          if (chosen === MANUAL_MODEL_KEY) {
            const typed = await prompt({ title: 'ID модели', placeholder: current || 'gpt-4o-mini' });
            if (typed === null || !typed.trim()) return;
            chosen = typed.trim();
          }
          setModel(chosen);
          if (configRef.current) {
            configRef.current.model = chosen;
            await saveConfig(configRef.current);
          }
          notice(`Модель: ${chosen}`);
          return;
        }

        case 'mode': {
          const next = arg as AgentMode;
          if (MODES.includes(next)) {
            permissionsRef.current.mode.set(next);
            setMode(next);
            if (configRef.current) {
              configRef.current.mode = next;
              await saveConfig(configRef.current);
            }
            notice(`Режим: ${next}`);
          } else {
            const chosen = await pick('Режим работы', MODES.map((m) => ({ key: m, label: m })));
            if (chosen) {
              permissionsRef.current.mode.set(chosen as AgentMode);
              setMode(chosen as AgentMode);
              if (configRef.current) {
                configRef.current.mode = chosen as AgentMode;
                await saveConfig(configRef.current);
              }
              notice(`Режим: ${chosen}`);
            }
          }
          return;
        }

        case 'effort': {
          const apply = async (next: Effort) => {
            if (configRef.current) {
              configRef.current.effort = next;
              await saveConfig(configRef.current);
            }
            notice(`Усилия рассуждения: ${next}`);
          };
          const typed = arg.toLowerCase() as Effort;
          if (EFFORTS.includes(typed)) {
            await apply(typed);
          } else {
            const current = configRef.current?.effort ?? 'auto';
            const chosen = await pick(
              'Усилия рассуждения',
              EFFORTS.map((e) => ({
                key: e,
                label: e,
                hint: e === current ? 'текущее' : EFFORT_HINTS[e],
              })),
            );
            if (chosen) await apply(chosen as Effort);
          }
          return;
        }

        case 'provider':
        case 'login': {
          const cfg = configRef.current;
          if (!cfg) return;

          // 1. Выбор провайдера.
          const kind = (await pick(
            'Провайдер',
            PROVIDER_KINDS.map((p) => ({
              key: p,
              label: PROVIDER_LABELS[p],
              hint: p === cfg.provider ? 'текущий' : undefined,
            })),
          )) as ProviderKind | null;
          if (!kind) return;

          // 2. Base URL — для custom/openrouter (OpenAI-совместимые эндпоинты).
          let baseUrl: string | undefined = cfg.baseUrl;
          if (kind === 'custom' || kind === 'openrouter') {
            // Текущее значение (или дефолт) показываем как placeholder, а поле
            // оставляем пустым: пустой ввод = взять его же. Так не приходится
            // стирать префилл перед вводом нового адреса.
            const fallback = (cfg.provider === kind && cfg.baseUrl) || DEFAULT_BASE_URL[kind] || '';
            const url = await prompt({
              title: `Base URL для ${PROVIDER_LABELS[kind]}`,
              hint: `Enter пустым — ${fallback}`,
              placeholder: fallback,
            });
            if (url === null) return;
            baseUrl = url.trim() || fallback;
          } else {
            baseUrl = undefined; // у openai/anthropic/google — свой дефолт SDK
          }

          // 3. API-ключ (секрет). Спрашиваем ДО выбора модели, чтобы им же
          //    авторизовать автообнаружение. Для локальных эндпоинтов можно пусто.
          const keyOptional = kind === 'custom';
          const existingKey = resolveApiKey({ ...cfg, provider: kind, baseUrl }, await loadAuth());
          const keyInput = await prompt({
            title: `API-ключ для ${PROVIDER_LABELS[kind]}`,
            hint: existingKey
              ? 'Enter пустым — оставить текущий ключ'
              : keyOptional
                ? 'Enter пустым — без ключа (локальный сервер)'
                : `или задай переменную окружения ${CONVENTIONAL_KEY_ENV[kind]}`,
            secret: true,
          });
          if (keyInput === null) return;
          const key = keyInput.trim() || existingKey;

          // 4. Автообнаружение моделей + протокола у провайдера этим ключом
          //    (как в KitCode). Для custom определяется и рабочий base URL.
          notice('Ищу доступные модели у провайдера…');
          const discovery = await discoverModels(kind, baseUrl, key);
          const { models, error } = discovery;
          if (kind === 'custom' && discovery.baseUrl) baseUrl = discovery.baseUrl;
          if (error && models.length === 0) {
            notice(`Автообнаружение не удалось (${error}). Можно выбрать из подсказок или ввести вручную.`);
          }

          // 5. Модель — из найденных / подсказок / вручную.
          let chosenModel = await pick(
            models.length > 0 ? `Модель · найдено ${models.length}` : 'Модель',
            modelPickerItems(models, MODEL_SUGGESTIONS[kind] ?? []),
          );
          if (chosenModel === null || chosenModel === '') return;
          if (chosenModel === MANUAL_MODEL_KEY) {
            const typed = await prompt({
              title: 'ID модели',
              hint: 'например gpt-4o-mini, claude-sonnet-4, llama3',
              placeholder: 'gpt-4o-mini',
            });
            if (typed === null || !typed.trim()) return;
            chosenModel = typed.trim();
          }

          // 6. Сохраняем конфиг + ключ. keyEnv чистим — теперь ключ берётся из
          //    auth.json/стандартной переменной, а не из произвольного env
          //    (иначе старый keyEnv мог бы перехватывать не тот ключ).
          cfg.provider = kind;
          cfg.model = chosenModel;
          delete (cfg as { keyEnv?: string }).keyEnv;
          if (baseUrl) cfg.baseUrl = baseUrl;
          else delete (cfg as { baseUrl?: string }).baseUrl;
          if (kind === 'custom' && discovery.protocol) cfg.protocol = discovery.protocol;
          else delete (cfg as { protocol?: string }).protocol;
          await saveConfig(cfg);
          if (keyInput.trim()) await setApiKey(kind, keyInput.trim());
          setModel(chosenModel);

          notice(
            `Провайдер: ${PROVIDER_LABELS[kind]}\n` +
              `  Модель: ${chosenModel}${models.length > 0 ? ` (из ${models.length} найденных)` : ''}\n` +
              (baseUrl ? `  Base URL: ${baseUrl}\n` : '') +
              (kind === 'custom' && discovery.protocol ? `  Протокол: ${discovery.protocol === 'anthropic' ? 'Anthropic' : 'OpenAI-совместимый'}\n` : '') +
              (keyInput.trim()
                ? '  Ключ сохранён в auth.json (0600).'
                : key
                  ? '  Ключ оставлен прежним.'
                  : keyOptional
                    ? '  Без ключа (локальный сервер).'
                    : `  Ключ не задан — укажи ${CONVENTIONAL_KEY_ENV[kind]} в окружении или запусти /provider снова.`),
          );
          return;
        }

        case 'sessions': {
          const items = await listSessions();
          if (items.length === 0) {
            notice('Сохранённых сессий нет.');
            return;
          }
          const chosen = await pick(
            'Сессии',
            items.map((s) => ({
              key: s.id,
              label: s.title || `${s.id.slice(0, 12)} · ${s.updatedAt.slice(0, 16).replace('T', ' ')}`,
              hint: `${s.messageCount} сообщ.`,
            })),
          );
          if (!chosen) return;
          const loaded = await loadSession(chosen);
          if (loaded) {
            sessionRef.current = loaded;
            historyRef.current = loaded.history;
            // Смена всего транскрипта — пересоздаём <Static> и чистим экран,
            // чтобы прежняя сессия не осталась в скроллбеке под новой.
            setStaticKey((k) => k + 1);
            clearScreen();
            setMessages(loaded.messages.map((m) => ({ ...m })));
            setModel(loaded.meta.model || model);
            if (loaded.usage) setUsageSynced(loaded.usage);
            notice(`Возобновлена сессия (${loaded.messages.length} сообщ.).`);
          }
          return;
        }

        case 'compact': {
          const cfg = configRef.current;
          if (!cfg || historyRef.current.length === 0) {
            notice('Нечего сжимать.');
            return;
          }
          notice('Сжимаю контекст…');
          const auth = await loadAuth();
          const lm = createModel({ ...cfg, model: model || cfg.model }, auth);
          try {
            const result = await compactHistory(lm, historyRef.current);
            if (result.compacted) {
              historyRef.current = result.history;
              notice(`Контекст сжат: свёрнуто ${result.removed} сообщений.`);
            } else {
              notice('Контекст ещё небольшой — сжатие не требуется.');
            }
          } catch (err) {
            notice(`Сжатие не удалось: ${err instanceof Error ? err.message : String(err)}`);
          }
          return;
        }

        case 'memory': {
          if (arg === 'clear') {
            await clearMemory(workDir);
            notice('Память проекта очищена.');
          } else if (arg.startsWith('set ')) {
            await saveMemory(workDir, arg.slice(4).trim());
            notice('Память проекта обновлена.');
          } else {
            const mem = await readMemory(workDir);
            notice(mem || 'Память проекта пуста.');
          }
          return;
        }

        case 'bypass': {
          const engine = permissionsRef.current;
          if (engine.bypass.isEnabled()) {
            engine.bypass.disable();
            notice('Bypass выключен — подтверждения снова спрашиваются.');
          } else {
            engine.bypass.enable();
            notice('Bypass включён — вызовы инструментов больше не спрашивают подтверждения.');
          }
          forceRender((n) => n + 1);
          return;
        }

        case 'config': {
          const cfg = configRef.current;
          notice(
            `Конфигурация:\n` +
              `  Провайдер: ${cfg?.provider}\n` +
              `  Модель: ${model || cfg?.model}\n` +
              (cfg?.baseUrl ? `  Base URL: ${cfg.baseUrl}\n` : '') +
              `  Режим: ${mode}\n` +
              `  Усилия: ${cfg?.effort ?? 'auto'}\n` +
              `  Язык: ${cfg?.language}\n` +
              `  Тема: ${cfg?.theme} · Анимации: ${cfg?.motion}\n` +
              `  CWD: ${workDir}\n` +
              `  /provider — сменить провайдера и ключ`,
          );
          return;
        }

        case 'usage':
          notice(`Использование:\n${formatUsageReport(usageRef.current)}`);
          return;

        case 'help':
          notice(
            'Команды:\n' +
              '  /theme [name] — тема с предпросмотром (Enter сохранить, Esc отменить)\n' +
              '  /motion [full|reduced|off] — анимации\n' +
              '  /provider       — выбрать провайдера, модель и ключ (модели ищутся автоматически)\n' +
              '  /model [name]   — сменить модель (без имени — список моделей от провайдера)\n' +
              '  /mode [m]       — режим: normal | accept | plan\n' +
              '  /effort [level] — усилия рассуждения: auto | low | medium | high | xhigh | max\n' +
              '  /sessions       — возобновить сессию\n' +
              '  /compact        — сжать контекст\n' +
              '  /memory [set|clear] — заметки проекта\n' +
              '  /bypass         — вкл/выкл подтверждения\n' +
              '  /usage          — токены и стоимость\n' +
              '  /config         — показать конфиг\n' +
              '  /clear          — новая сессия\n' +
              '  /exit           — выйти\n\n' +
              '  Shift+Tab — цикл режимов · Esc — прервать/очистить/выйти · Ctrl+C — выход',
          );
          return;

        default: {
          const closest = closestCommand(cmd);
          notice(`Неизвестная команда /${cmd}.${closest ? ` Может быть /${closest.name}?` : ''} /help — список.`);
        }
      }
    },
    [exit, model, mode, workDir, notice, persist, pick, prompt, setUsageSynced, clearScreen, setTheme, setMotion],
  );

  // ── Отправка сообщения ─────────────────────────────────────────────────────
  const handleSubmit = useCallback(
    async (value: string) => {
      const text = value.trim();
      if (!text || abortRef.current || commandLock.current) return;
      setInputHistory((items) => [text, ...items.filter((item) => item !== text)].slice(0, 50));

      if (text.startsWith('/')) {
        commandLock.current = true;
        setCommandBusy(true);
        try { await handleSlash(text); }
        catch (error) { notice(`Не удалось выполнить команду: ${error instanceof Error ? error.message : String(error)}`); }
        finally { commandLock.current = false; setCommandBusy(false); }
        return;
      }

      setMessages((prev) => [...prev, { id: uid(), role: 'user', content: text }]);
      setInput('');
      historyRef.current = [...historyRef.current, { role: 'user', content: text }];
      // Заголовок сессии — из первого сообщения пользователя.
      if (sessionRef.current && !sessionRef.current.meta.title) {
        sessionRef.current.meta.title = deriveTitle(text);
      }
      await runTurn();
    },
    [busy, handleSlash, runTurn, notice],
  );

  const quit = useCallback(() => {
    void persist().then(() => {
      killAllJobs();
      exit();
    });
  }, [persist, exit]);

  useTerminalInput((_ch, key) => {
    // Ctrl+C — выход с сохранением сессии (Ink exitOnCtrlC отключён).
    if (key.ctrl && _ch === 'c') {
      if (abortRef.current) abortRef.current.abort();
      quit();
      return;
    }
    // Пока открыт оверлей — навигацию обрабатывает он сам.
    if (overlay.kind !== 'none') return;

    if (key.tab && key.shift && !commandLock.current && !abortRef.current) {
      const next = permissionsRef.current.mode.cycle();
      setMode(next);
      if (configRef.current) {
        configRef.current.mode = next;
        void saveConfig(configRef.current).catch((error) => notice(`Не удалось сохранить режим: ${String(error)}`));
      }
      return;
    }
    if (key.escape) {
      if (busy && abortRef.current) {
        abortRef.current.abort();
        return;
      }
      // Esc с непустым вводом — очистить строку (в т.ч. закрыть подсказки команд),
      // а не выходить из приложения.
      if (inputRef.current !== '') {
        setInput('');
        return;
      }
      if (!commandLock.current) quit();
    }
  });

  if (!ready) {
    return (
      <Box flexDirection="column" padding={1}>
        <Logo compact />
        <Activity label="Подготавливаю рабочее пространство…" />
      </Box>
    );
  }

  // Живая область ограничена по высоте: при переполнении показываем хвост, а не
  // распираем экран за пределы терминала (из-за чего ломался вывод при ресайзе).
  const panelWidth = Math.min(92, Math.max(16, columns - 4));
  const liveRows = Math.max(3, (rows || 24) - (overlay.kind === 'none' ? 8 : 16));
  const liveActive = busy || streaming !== '' || reasoning !== '' || liveTools.length > 0;

  return (
    <Box flexDirection="column">
      {/* Завершённые сообщения + шапка выводятся в скроллбек один раз и больше
          не перерисовываются — это и лечит артефакты при ресайзе/прокрутке. */}
      <Static key={staticKey} items={[HEADER_ITEM, ...messages]}>
        {(item) =>
          item === HEADER_ITEM ? (
            <Box key="header" flexDirection="column" paddingX={1} paddingTop={1} marginBottom={1}>
              <Logo compact />
              <Text color={T.dim} wrap="truncate-middle">workspace / {workDir}</Text>
            </Box>
          ) : (
            <Box key={(item as ChatMsg).id} paddingX={1}>
              <Message msg={item as ChatMsg} />
            </Box>
          )
        }
      </Static>

      <Box flexDirection="column" alignItems="center">
      <Box flexDirection="column" width={panelWidth}>
      {messages.length === 0 && !liveActive && !input.startsWith('/') && overlay.kind === 'none' && <WelcomePanel />}

      {liveActive && overlay.kind === 'none' && (
        <Box
          flexDirection="column"
          paddingX={1}
          marginBottom={1}
          maxHeight={liveRows}
          overflowY="hidden"
          justifyContent="flex-end"
        >
          <Box gap={1}>
            <Text color={T.accent} bold>{G.bar}</Text>
            <Text bold>KrashCode</Text>
          </Box>
          {reasoning && (
            <Box marginLeft={2}>
              <Text color={T.dim} italic wrap="wrap">Размышления {G.sep} {reasoning}</Text>
            </Box>
          )}
          {streaming && (
            <Box marginLeft={2}>
              <Text color={T.text} wrap="wrap">{streaming}<StreamingCursor /></Text>
            </Box>
          )}
          {liveTools.map((tc) => (
            <ToolCall key={tc.id} animate name={tc.name} args={tc.args} result={tc.result} isError={tc.isError} />
          ))}
          {busy && !streaming && !reasoning && liveTools.length === 0 && (
            <Box marginLeft={2}>
              <Activity label="Обдумываю задачу…" />
            </Box>
          )}
        </Box>
      )}

      {overlay.kind === 'approval' && (
        <Box paddingX={1}>
          <ApprovalPrompt
            request={overlay.request}
            onDecide={(d) => {
              overlay.resolve(d);
              setOverlay({ kind: 'none' });
            }}
          />
        </Box>
      )}

      {overlay.kind === 'picker' && (
        <Box paddingX={1}>
          <Picker
            title={overlay.title}
            items={overlay.items}
            {...overlay.options}
            onSelect={(k) => {
              overlay.select(k);
              setOverlay({ kind: 'none' });
            }}
            onCancel={() => {
              overlay.select('');
              setOverlay({ kind: 'none' });
            }}
          />
        </Box>
      )}

      {overlay.kind === 'prompt' && (
        <Box paddingX={1}>
          <TextPrompt
            title={overlay.title}
            hint={overlay.hint}
            initial={overlay.initial}
            placeholder={overlay.placeholder}
            secret={overlay.secret}
            onSubmit={(v) => {
              overlay.resolve(v);
              setOverlay({ kind: 'none' });
            }}
            onCancel={() => {
              overlay.resolve(null);
              setOverlay({ kind: 'none' });
            }}
          />
        </Box>
      )}

      <StatusBar
        width={panelWidth}
        model={model || 'не задана'}
        mode={mode}
        usage={formatUsageLine(usage)}
        bypass={permissionsRef.current.bypass.isEnabled()}
        busy={busy || (commandBusy && overlay.kind === 'none')}
        waiting={overlay.kind === 'approval'}
        phase={commandBusy ? 'настройка' : liveTools.some((call) => call.result === undefined) ? 'инструменты' : streaming ? 'ответ' : reasoning ? 'размышляю' : 'подготовка'}
        turnTime={turnStart}
      />

      {overlay.kind === 'none' && (
        <Box paddingX={1}>
          <PromptInput
            width={panelWidth - 2}
            value={input}
            onChange={setInput}
            onSubmit={handleSubmit}
            disabled={busy || commandBusy}
            history={inputHistory}
            placeholder={busy ? 'KrashCode работает…' : 'Что нужно сделать?'}
          />
        </Box>
      )}
      </Box>
      </Box>
    </Box>
  );
}
