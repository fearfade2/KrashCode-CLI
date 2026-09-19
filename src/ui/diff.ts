// Простой построчный diff по алгоритму наибольшей общей подпоследовательности.
// Возвращает строки с пометкой типа для рендера.

export type DiffLine = { type: 'add' | 'del' | 'ctx'; text: string };

export function diffLines(before: string, after: string, contextLimit = 6): DiffLine[] {
  const a = before.split('\n');
  const b = after.split('\n');

  // LCS через таблицу длин.
  const n = a.length;
  const m = b.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i]![j] = a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }

  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ type: 'ctx', text: a[i]! });
      i++;
      j++;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      out.push({ type: 'del', text: a[i]! });
      i++;
    } else {
      out.push({ type: 'add', text: b[j]! });
      j++;
    }
  }
  while (i < n) out.push({ type: 'del', text: a[i++]! });
  while (j < m) out.push({ type: 'add', text: b[j++]! });

  return trimContext(out, contextLimit);
}

// Схлопывает длинные участки неизменённого контекста, оставляя по contextLimit
// строк вокруг изменений.
function trimContext(lines: DiffLine[], limit: number): DiffLine[] {
  if (limit <= 0) return lines;
  const keep = new Array<boolean>(lines.length).fill(false);
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]!.type !== 'ctx') {
      for (let k = Math.max(0, i - limit); k <= Math.min(lines.length - 1, i + limit); k++) {
        keep[k] = true;
      }
    }
  }
  const out: DiffLine[] = [];
  let skipping = false;
  for (let i = 0; i < lines.length; i++) {
    if (keep[i]) {
      out.push(lines[i]!);
      skipping = false;
    } else if (!skipping) {
      out.push({ type: 'ctx', text: '…' });
      skipping = true;
    }
  }
  return out;
}

export function diffStats(lines: DiffLine[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const l of lines) {
    if (l.type === 'add') added++;
    else if (l.type === 'del') removed++;
  }
  return { added, removed };
}
