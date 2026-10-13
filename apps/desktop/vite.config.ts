/**
 * Vite config for the desktop shell.
 *
 * Two things here are not boilerplate:
 *
 * **`@repo` reaches out of the app.** `systems/` and `schemas/` are data the whole project
 * shares — the tests read them off disk, the app imports them — and duplicating either into
 * `apps/desktop/public/` would mean a system definition that is correct in one copy and stale in
 * the other. `server.fs.allow` has to be widened to match, because the files are above the app
 * root.
 *
 * **The dev server is fixed to a port and never searches for a free one.** Tauri points its
 * window at exactly this URL, and a dev server that silently moved would leave the window blank
 * with no error worth reading. The port is `dev-port.json`'s, read by this file and by
 * `scripts/check-port.mjs`; `tauri.conf.json`'s `devUrl` repeats it, and tools/verify's
 * desktop-start test holds the two equal. It is not Vite's default (5173), which every other Vite
 * project on the machine wants: an installed build runs no server at all.
 *
 * `__INCUDO_VERSION__` is this package's version, which the About section prints. The release workflow refuses a tag
 * unless it equals `tauri.conf.json`'s and `Cargo.toml`'s, so the browser build and the window print the same one.
 */

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');
const { version } = JSON.parse(readFileSync(resolve(here, 'package.json'), 'utf8')) as { version: string };
const { port } = JSON.parse(readFileSync(resolve(here, 'dev-port.json'), 'utf8')) as { port: number };

export default defineConfig({
  plugins: [react()],
  define: { __INCUDO_VERSION__: JSON.stringify(version) },
  resolve: {
    alias: { '@repo': repoRoot },
  },
  server: {
    port,
    strictPort: true,
    fs: { allow: [repoRoot] },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
