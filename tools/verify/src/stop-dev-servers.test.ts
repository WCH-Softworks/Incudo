// Holds the hook in .claude/hooks/stop-dev-servers.mjs to what it stops. Sessions left Metro and Vite servers running after
// a drive (three Metro servers from three worktrees at once, on 8081, 8082 and 8084); the hook stops a worktree's servers
// when its turn or session ends, and at a session's start any whose worktree is gone or that ran past STALE_HOURS.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const hook = (await import(pathToFileURL(path.join(root, '.claude', 'hooks', 'stop-dev-servers.mjs')).href)) as {
  STALE_HOURS: number;
  devServerCheckout(command: string): string | undefined;
  selectServers(mode: string, list: { pid: number; started: number; command: string }[], checkout: string, now?: number): { pid: number }[];
};

// Generic paths: no machine's own. The real root is used only where a folder must exist.
const repo = 'C:/Work/Repo';
const here = `${repo}/.claude/worktrees/here-1`;
const other = `${repo}/.claude/worktrees/other-2`;
const metro = (dir: string, port = 8081) => `"node" "${dir.replace(/\//g, '\\')}\\node_modules\\.bin\\\\..\\expo\\bin\\cli" start --dev-client --port ${port}`;
const vite = (dir: string) => `"node" "${dir.replace(/\//g, '\\')}\\apps\\desktop\\node_modules\\.bin\\\\..\\vite\\bin\\vite.js"`;
const now = Date.UTC(2026, 10, 23, 20);
const hour = 3600_000;

test('a dev server is Metro, Vite or Tauri dev, placed at its checkout, never a test or a build', () => {
  // Fails if Vite is placed at apps/desktop rather than the worktree (it was: the hook missed the desktop's server).
  assert.equal(hook.devServerCheckout(metro(here)), here.toLowerCase());
  assert.equal(hook.devServerCheckout(vite(here)), here.toLowerCase());
  assert.equal(hook.devServerCheckout(`"node" "${repo}/node_modules/@tauri-apps/cli/tauri.js" dev`), repo.toLowerCase());
  assert.equal(hook.devServerCheckout(`"node" "${here}/node_modules/expo/bin/cli" export`), undefined, 'an export is not a server');
  assert.equal(hook.devServerCheckout(`"node" "${repo}/node_modules/@tauri-apps/cli/tauri.js" build`), undefined, 'a build ends');
  assert.equal(hook.devServerCheckout(`node --test --experimental-strip-types tools/verify/src/a.test.ts`), undefined);
});

test("a turn's end stops its own worktree's servers and no other's", () => {
  const list = [
    { pid: 1, started: now, command: metro(here) },
    { pid: 2, started: now, command: vite(here) },
    { pid: 3, started: now, command: metro(other, 8082) },
    { pid: 4, started: now, command: metro(repo, 8083) },
    { pid: 5, started: now, command: metro('D:/Elsewhere/App', 8084) },
  ];
  // Fails if the match is a prefix of the path (it would take another worktree's) or skips a package's own node_modules.
  assert.deepEqual(hook.selectServers('own', list, here, now).map((p) => p.pid), [1, 2]);
  // The main checkout owns what runs from it, not its worktrees'.
  assert.deepEqual(hook.selectServers('own', list, repo, now).map((p) => p.pid), [4]);
});

test("a session's start stops this repository's servers that are old or whose worktree is gone, and nothing young", () => {
  const live = path.join(root);
  const gone = `${repo.replace('Repo', 'Gone')}/.claude/worktrees/deleted-9`;
  const list = [
    { pid: 1, started: now - 1 * hour, command: metro(live) },
    { pid: 2, started: now - (hook.STALE_HOURS + 1) * hour, command: metro(live) },
    { pid: 3, started: now - 1 * hour, command: metro(gone) },
    { pid: 4, started: now - 99 * hour, command: metro('D:/Elsewhere/App') },
  ];
  // Fails if age is ignored (2 kept), if a young live server is stopped (1), or another repository's is touched (4).
  assert.deepEqual(hook.selectServers('stale', list, live, now).map((p) => p.pid), [2]);
  assert.deepEqual(hook.selectServers('stale', list, gone, now).map((p) => p.pid), [3], 'a deleted worktree’s server goes at once');
});
