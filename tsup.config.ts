import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.tsx'],
  format: ['esm'],
  target: 'node22',
  clean: true,
  dts: false,
  outDir: 'dist',
  banner: {
    js: '#!/usr/bin/env node',
  },
});
