/**
 * Say *who* is holding the dev port, before Vite refuses to start.
 *
 * `vite.config.ts` sets `strictPort`, on purpose: Tauri's `devUrl` points at exactly
 * `http://localhost:5173`, so a dev server that quietly moved to 5174 would leave the desktop
 * window blank with no error worth reading. The cost of that choice is this failure mode, and it
 * is a nasty one — the usual culprit is a *detached* dev server from an earlier session, which
 * has no console window and so appears nowhere a person thinks to look. "Port in use, but there
 * is no application to kill" is the exact report this exists to answer.
 *
 * Advisory only: it prints and exits 0, because a port that is busy for some other reason is
 * Vite's news to deliver, not this script's.
 */

import { createServer } from 'node:net';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const PORT = 5173;
const run = promisify(execFile);

/** Resolve without throwing: this script must never be the reason `npm run desktop` fails. */
async function quiet(file, args) {
  try {
    const { stdout } = await run(file, args, { windowsHide: true });
    return stdout;
  } catch {
    return '';
  }
}

/**
 * Both localhost stacks, because a server on one does not block the other.
 *
 * Measured rather than assumed: Vite binds `::1`, and a probe of `127.0.0.1` alone reports the
 * port free while Vite is sitting on it — which is this script silently doing nothing in the one
 * case it exists for. Busy on either stack is busy.
 */
const LOCALHOSTS = ['::1', '127.0.0.1'];

function bindable(port, host) {
  return new Promise((resolve) => {
    const probe = createServer();
    // EAFNOSUPPORT / EADDRNOTAVAIL on a machine with no IPv6 is "nothing is listening here",
    // not "busy" — only EADDRINUSE means someone has it.
    probe.once('error', (error) => resolve(error.code !== 'EADDRINUSE'));
    probe.once('listening', () => probe.close(() => resolve(true)));
    probe.listen(port, host);
  });
}

async function portIsFree(port) {
  const results = await Promise.all(LOCALHOSTS.map((host) => bindable(port, host)));
  return results.every(Boolean);
}

/** The pids listening on `port`, by whichever of netstat / lsof this platform has. */
async function listenerPids(port) {
  const pids = new Set();

  if (process.platform === 'win32') {
    for (const line of (await quiet('netstat', ['-ano'])).split('\n')) {
      if (!line.includes(`:${port}`) || !line.includes('LISTENING')) continue;
      const pid = line.trim().split(/\s+/).pop();
      if (pid && pid !== '0') pids.add(pid);
    }
  } else {
    for (const pid of (await quiet('lsof', ['-ti', `tcp:${port}`, '-sTCP:LISTEN'])).split('\n')) {
      if (pid.trim()) pids.add(pid.trim());
    }
  }
  return [...pids];
}

if (await portIsFree(PORT)) process.exit(0);

const pids = await listenerPids(PORT);
const kill =
  process.platform === 'win32'
    ? pids.map((pid) => `taskkill /PID ${pid} /F`).join('\n  ') || `npx kill-port ${PORT}`
    : pids.map((pid) => `kill -9 ${pid}`).join('\n  ') || `npx kill-port ${PORT}`;

process.stderr.write(
  [
    '',
    `Port ${PORT} is already in use, so Vite is about to refuse to start.`,
    '',
    pids.length
      ? `  held by pid ${pids.join(', ')}`
      : '  could not work out which process holds it',
    '',
    'This is very often a dev server left over from an earlier session. A detached one has',
    'no console window, so it shows up under Task Manager’s *Background processes* rather',
    'than under Apps — which is why it can look like there is nothing to kill.',
    '',
    `  ${kill}`,
    '',
    `The port is fixed rather than auto-selected on purpose: Tauri points its window at`,
    `http://localhost:${PORT} exactly, and a server that moved would leave it blank.`,
    '',
  ].join('\n'),
);
