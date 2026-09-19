import { useStdout } from 'ink';
import { useMemo, useSyncExternalStore } from 'react';

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
  const update = () => {
    const columns = stdout.columns || 80;
    const rows = stdout.rows || 24;
    if (columns === size.columns && rows === size.rows) return;
    size = { columns, rows };
    for (const listener of listeners) listener();
  };
  return {
    getSnapshot: () => size,
    subscribe(listener: () => void) {
      if (listeners.size === 0) stdout.on('resize', update);
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
