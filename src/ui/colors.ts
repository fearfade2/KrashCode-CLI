import chalk, { type ColorSupportLevel } from 'chalk';

export interface ColorStream {
  isTTY?: boolean;
  getColorDepth?: (env?: NodeJS.ProcessEnv) => number;
}

// A conservative default prevents RGB escape codes being interpreted as unrelated
// palette entries by old terminals. Explicit user controls win over auto-detection.
export function colorLevel(stream: ColorStream, env: NodeJS.ProcessEnv = process.env): ColorSupportLevel {
  if (env.NO_COLOR !== undefined || env.TERM === 'dumb' || !stream.isTTY) return 0;
  const mode = env.KRASHCODE_COLOR?.toLowerCase();
  if (mode === 'off' || mode === 'none') return 0;
  if (mode === 'ansi') return 1;
  if (mode === '256') return 2;
  if (mode === 'truecolor') return 3;
  if (env.FORCE_COLOR === '0' || env.FORCE_COLOR === 'false') return 0;
  if (env.FORCE_COLOR === '3') return 3;
  if (env.FORCE_COLOR === '2') return 2;
  if (env.FORCE_COLOR === '1' || env.FORCE_COLOR === '' || env.FORCE_COLOR === 'true') return 1;
  if (/^(truecolor|24bit)$/i.test(env.COLORTERM ?? '')) return 3;
  try {
    const depth = stream.getColorDepth?.(env);
    if (depth !== undefined) return depth >= 24 ? 3 : depth >= 8 ? 2 : depth >= 4 ? 1 : 0;
  } catch { /* Remote / synthetic stdout streams may not support this API. */ }
  return /256color/i.test(env.TERM ?? '') ? 2 : 1;
}

export function configureTerminalColors(stream: ColorStream = process.stdout): ColorSupportLevel {
  const level = colorLevel(stream);
  chalk.level = level;
  return level;
}
