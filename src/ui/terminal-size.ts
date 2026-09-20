import { useInput, useIsScreenReaderEnabled, useStdout } from 'ink';
import { useAppearance } from './theme.js';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';

// Реактивный размер терминала. Ink сам не перевыкладывает статику при resize,
// поэтому живую область мы ограничиваем по высоте вручную — а для этого нужно
// знать актуальные rows/columns и обновляться на событие 'resize' у stdout.
export interface TermSize {
  columns: number;
  rows: number;
}

// Один стор на поток вывода (а не на каждый вызов хука): подписку на 'resize'
// вешаем/снимаем по числу слушателей, чтобы не плодить обработчики.
const stores = new WeakMap<NodeJS.WriteStream, ReturnType<typeof createStore>>();

function createStore(stdout: NodeJS.WriteStream) {
  let size: TermSize = { columns: stdout.columns || 80, rows: stdout.rows || 24 };
  const listeners = new Set<() => void>();
  const getSnapshot = () => {
    const columns = stdout.columns || 80;
    const rows = stdout.rows || 24;
    if (columns !== size.columns || rows !== size.rows) size = { columns, rows };
    return size;
  };
  const update = () => {
    getSnapshot();
    for (const listener of listeners) listener();
  };
  return {
    getSnapshot,
    subscribe(listener: () => void) {
      if (listeners.size === 0) stdout.prependListener('resize', update);
      listeners.add(listener);
      update();
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) stdout.off('resize', update);
      };
    },
  };
}

export function useTerminalSize(): TermSize {
  const { stdout } = useStdout();
  const store = useMemo(() => {
    let current = stores.get(stdout);
    if (!current) {
      current = createStore(stdout);
      stores.set(stdout, current);
    }
    return current;
  }, [stdout]);
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

// Motion never runs in redirected output, screen readers, or reduced-motion mode.
export function motionAllowed(isTTY: boolean, env: NodeJS.ProcessEnv = process.env): boolean {
  return isTTY && env.TERM !== 'dumb' && env.NO_COLOR === undefined &&
    !['1', 'true'].includes(env.KRASHCODE_REDUCED_MOTION ?? '') &&
    !['1', 'true'].includes(env.INK_SCREEN_READER ?? '') && !env.CI;
}

export function useMotionFrame(active: boolean, interval = 120, maxFrames = Infinity, decorative = false): number {
  const { stdout } = useStdout();
  const [frame, setFrame] = useState(0);
  const screenReader = useIsScreenReaderEnabled();
  const { motion } = useAppearance();
  const enabled = !screenReader && motionAllowed(Boolean(stdout.isTTY)) &&
    motion !== 'off' && !(decorative && motion === 'reduced');
  const cadence = motion === 'reduced' ? Math.max(250, interval) : interval;
  useEffect(() => {
    setFrame(0);
    if (!active || !enabled) return;
    let current = 0;
    const timer = setInterval(() => {
      current += 1;
      setFrame(current);
      if (current >= maxFrames) clearInterval(timer);
    }, cadence);
    return () => clearInterval(timer);
  }, [active, enabled, cadence, maxFrames]);
  return active && enabled ? frame : maxFrames === Infinity ? 0 : maxFrames;
}

// Ink 7's effect-event callback can retain the mount-time closure in legacy mode.
// Forward through a ref so overlays, disabled fields and callbacks always use the latest render.
export function useTerminalInput(handler: Parameters<typeof useInput>[0], options?: Parameters<typeof useInput>[1]): void {
  const latest = useRef(handler);
  latest.current = handler;
  useInput((input, key) => latest.current(input, key), options);
}
