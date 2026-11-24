#!/usr/bin/env node
// Stop, SessionEnd and SessionStart hook: stops the dev servers (Metro, Vite, Tauri dev) that sessions start and leave
// running.
//
// Why: drives start a Metro or a Vite server, finish, and the session goes idle with the server still holding its port.
// Three Metro servers from three worktrees were found holding 8081, 8082 and 8084 at once, the oldest from a session long
// done. An idle session never reaches SessionEnd, so its servers are stopped when its turn ends: a server a later turn
// needs is started again (preview_start reuses nothing that is gone).
//
//   node stop-dev-servers.mjs own     Stop and SessionEnd: every dev server running from this worktree.
//   node stop-dev-servers.mjs stale   SessionStart: every dev server of this repository whose worktree no longer exists,
//                                     or that has run longer than STALE_HOURS.
//   node stop-dev-servers.mjs list    prints what each mode would stop, stops nothing.
//
// A dev server is recognised by its command line: a node process running Expo's CLI with `start`, Vite, or the Tauri
// CLI with `dev`, from a node_modules inside this repository (the main checkout or a worktree). Nothing else is touched:
// not the Android emulator, which is shared and slow to start, not a test run, not another repository's servers.
// The hook never fails a turn: anything it cannot read is left alone and it exits 0.

import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

export const STALE_HOURS = 12;

function readInput() {
  try {
    return JSON.parse(readFileSync(0, 'utf8'));
  } catch {
    return {};
  }
}

/** Every process as `{ pid, started (ms), command }`. */
export function processes() {
  try {
    if (process.platform === 'win32') {
      const script =
        "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | ForEach-Object { '{0}\t{1}\t{2}' -f $_.ProcessId, ([DateTimeOffset]$_.CreationDate).ToUnixTimeMilliseconds(), $_.CommandLine }";
      const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        windowsHide: true,
      });
      return out
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => {
          const [pid, started, ...rest] = line.split('\t');
          return { pid: Number(pid), started: Number(started), command: rest.join('\t') };
        });
    }
    const out = execFileSync('ps', ['-eo', 'pid=,etimes=,args='], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return out
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [, pid, seconds, command] = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line) ?? [];
        return { pid: Number(pid), started: Date.now() - Number(seconds) * 1000, command: command ?? '' };
      });
  } catch {
    return [];
  }
}

// Forward slashes, one at a time, case kept: the case is what a folder is found by on Linux; comparisons lowercase.
const slashes = (p) => p.replace(/\\/g, '/').replace(/\/+/g, '/');
const norm = (p) => slashes(p).toLowerCase();

/** The repository root holding `dir`: the main checkout, also when `dir` is one of its worktrees. */
export function repositoryRoot(dir) {
  const n = norm(dir);
  const at = n.indexOf('/.claude/worktrees/');
  return (at >= 0 ? dir.slice(0, at) : dir).replace(/[\\/]+$/, '');
}

/**
 * The checkout a dev server runs from, spelled as its command spells it: the folder holding the node_modules it names,
 * or undefined. The case is kept so the folder can be looked for on a filesystem that minds case.
 */
export function devServerFolder(command) {
  const n = slashes(command);
  const isDev =
    (/\/(?:@expo\/cli|expo)\/bin\/cli\b/i.test(n) && /\sstart\b/i.test(n)) ||
    /\/vite\/bin\/vite\.js\b/i.test(n) ||
    /\/node_modules\/\.bin\/vite\b/i.test(n) ||
    (/\/@tauri-apps\/cli\//i.test(n) && /\sdev\b/i.test(n));
  if (!isDev) return undefined;
  // The folder holding the first node_modules: the checkout, or a package inside it (the desktop's Vite runs from
  // apps/desktop/node_modules).
  const match = /([a-z]:\/[^"]*?|\/[^"\s]*?)\/node_modules\//i.exec(n);
  if (!match) return undefined;
  const worktree = /^(.*?\/\.claude\/worktrees\/[^/]+)/i.exec(match[1]);
  return worktree ? worktree[1] : match[1];
}

/** The same folder lowercased, as every comparison here reads it. */
export function devServerCheckout(command) {
  return devServerFolder(command)?.toLowerCase();
}

/** Whether a server whose folder is `at` belongs to `checkout`: that worktree, or the main checkout outside its worktrees. */
function belongs(at, checkout) {
  if (at === checkout) return true;
  if (checkout.includes('/.claude/worktrees/')) return false;
  return at.startsWith(`${checkout}/`) && !at.startsWith(`${checkout}/.claude/worktrees/`);
}

/** What a mode stops, given the processes, this checkout and the time. Pure, so the test can hold it. */
export function selectServers(mode, list, checkout, now = Date.now()) {
  const own = norm(checkout).replace(/\/$/, '');
  const root = norm(repositoryRoot(checkout)).replace(/\/$/, '');
  return list.filter((p) => {
    const folder = devServerFolder(p.command);
    if (folder === undefined) return false;
    const at = folder.toLowerCase();
    if (mode === 'own') return belongs(at, own);
    if (mode === 'stale') {
      const ours = at === root || at.startsWith(`${root}/`);
      if (!ours) return false;
      // Looked for as the command spells it: lowercased, a live checkout on Linux read as gone (found by CI).
      const gone = !existsSync(folder);
      const old = Number.isFinite(p.started) && now - p.started > STALE_HOURS * 3600_000;
      return gone || old;
    }
    return false;
  });
}

function stop(pid) {
  try {
    if (process.platform === 'win32') {
      execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    } else {
      process.kill(pid, 'SIGTERM');
    }
    return true;
  } catch {
    return false;
  }
}

const isMain = Boolean(process.argv[1]) && path.resolve(process.argv[1]) === import.meta.filename;
if (isMain) {
  const mode = process.argv[2] ?? 'own';
  const input = mode === 'list' ? {} : readInput();
  const checkout = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
  const list = processes();
  if (mode === 'list') {
    for (const m of ['own', 'stale']) for (const p of selectServers(m, list, checkout)) console.log(`${m}\t${p.pid}\t${p.command}`);
  } else {
    const stopped = selectServers(mode, list, checkout).filter((p) => stop(p.pid));
    // Said to the session (stderr is shown in the transcript only on a failure; stdout of SessionStart is context).
    if (stopped.length && mode === 'stale') console.log(`Stopped ${stopped.length} dev server(s) left running by other sessions.`);
  }
  process.exit(0);
}
