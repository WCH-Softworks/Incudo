/**
 * Vite config for the desktop shell.
 *
 * Two things here are not boilerplate:
 *
 * **`@repo` reaches out of the app.** `systems/` and `schemas/` are data the whole project
 * shares — the CLI reads them off disk, the app imports them — and duplicating either into
 * `apps/desktop/public/` would mean a system definition that is correct in one copy and stale in
 * the other. `server.fs.allow` has to be widened to match, because the files are above the app
 * root.
 *
 * **The dev server is fixed to a port and never searches for a free one.** Tauri points its
 * window at exactly this URL, and a dev server that silently moved to 5174 would leave the
 * window blank with no error worth reading.
 */

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@repo': repoRoot },
  },
  server: {
    port: 5173,
    strictPort: true,
    fs: { allow: [repoRoot] },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
