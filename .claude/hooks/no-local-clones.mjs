#!/usr/bin/env node
// PreToolUse hook for Bash and PowerShell: refuses a command that would put a second copy of
// this repository on the disk, or a drive letter in front of it.
//
// Why: sessions kept making short-path clones (C:\ib, C:\ibc) to dodge Windows' 260-character
// limit in the phone build, and nobody ever deleted them. The repository is already checked
// out, once per worktree, by the app; nothing here needs another copy. The phone build's long
// path is answered by `android.cmakeVersion` (a newer CMake whose Ninja handles long paths),
// and CI builds it on Linux.
//
// What it refuses, read from the command text (no shell parsing, so it errs towards refusing):
//   - `git clone` of anything local (a path, `.`, `..`, file://, a drive letter, a UNC path) or
//     of this repository's own remote;
//   - `git worktree add` anywhere but under `.claude/worktrees/`;
//   - `subst` with a drive letter, `New-PSDrive`, and a junction or directory link
//     (`mklink /J|/D`, `New-Item -ItemType Junction|SymbolicLink`);
//   - a recursive copy (`robocopy`, `xcopy`, `Copy-Item -Recurse`, `cp -r|-a|-R`) whose source
//     is the repository root, a worktree root, `.` or `..`.
//
// Exit 2 with a reason on stderr blocks the call and tells the model why. Anything that cannot
// be read (no JSON, no command) is let through: a broken hook must not stop every command.

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

function readInput() {
  try {
    return JSON.parse(readFileSync(0, 'utf8'));
  } catch {
    return null;
  }
}

function git(args, cwd) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

const norm = (p) => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();

function projectFacts(cwd) {
  const roots = new Set();
  const remotes = new Set();
  const common = git(['rev-parse', '--path-format=absolute', '--git-common-dir'], cwd);
  if (common) roots.add(norm(path.dirname(common)));
  const top = git(['rev-parse', '--show-toplevel'], cwd);
  if (top) roots.add(norm(top));
  for (const line of git(['worktree', 'list', '--porcelain'], cwd).split('\n')) {
    if (line.startsWith('worktree ')) roots.add(norm(line.slice(9)));
  }
  for (const line of git(['remote', '-v'], cwd).split('\n')) {
    const url = line.split(/\s+/)[1];
    if (url) remotes.add(url.replace(/\.git$/, '').toLowerCase());
  }
  return { roots, remotes };
}

// Splits a command into words, keeping quoted runs together. Good enough to find arguments;
// it does not pretend to be a shell.
function words(text) {
  const out = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(text))) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

// Each simple command in a line joined by ;, &&, ||, | or a newline.
function segments(command) {
  return command.split(/\r?\n|;|&&|\|\||\|/).map((s) => s.trim()).filter(Boolean);
}

const isLocalSource = (s) =>
  /^(\.{1,2})([\\/].*)?$/.test(s) ||
  /^file:/i.test(s) ||
  /^[a-z]:/i.test(s) ||
  /^[\\/]{2}/.test(s) ||
  /^[\\/]/.test(s) ||
  /^~/.test(s) ||
  /^\$/.test(s); // $PWD, $env:..., a variable naming a path

function cloneProblem(seg, facts) {
  const w = words(seg);
  const i = w.findIndex((x, k) => /(^|[\\/])git(\.exe)?$/i.test(x) && /^clone$/i.test(w[k + 1] ?? ''));
  if (i < 0) return null;
  // Options that take the next word as their value, so that word is not the source.
  const takesValue = /^(-[bcjou]|--(branch|config|depth|jobs|origin|upload-pack|reference|reference-if-able|separate-git-dir|template|shallow-since|shallow-exclude|server-option|filter|bundle-uri|ref-format))$/;
  const rest = w.slice(i + 2);
  const args = rest.filter((a, k) => !a.startsWith('-') && !takesValue.test(rest[k - 1] ?? ''));
  const source = args[0] ?? '';
  const remote = source.replace(/\.git$/, '').toLowerCase();
  if (isLocalSource(source)) return `it clones a local repository (${source})`;
  if (facts.remotes.has(remote)) return 'it clones this repository from its own remote';
  return null;
}

function worktreeProblem(seg) {
  const w = words(seg);
  const i = w.findIndex((x, k) => /(^|[\\/])git(\.exe)?$/i.test(x) && /^worktree$/i.test(w[k + 1] ?? '') && /^add$/i.test(w[k + 2] ?? ''));
  if (i < 0) return null;
  const rest = w.slice(i + 3);
  const target = rest.find((a, k) => !a.startsWith('-') && !/^-(b|B)$/.test(rest[k - 1] ?? ''));
  if (target && /(^|[\\/])\.claude[\\/]worktrees[\\/]/.test(norm(target).replace(/^/, '/'))) return null;
  return `it adds a worktree outside .claude/worktrees (${target ?? 'no path given'})`;
}

function aliasProblem(seg) {
  if (/(^|[\s(])subst(\.exe)?\s+[a-z]:/i.test(seg)) return 'it maps a drive letter onto a folder (subst)';
  if (/\bNew-PSDrive\b/i.test(seg)) return 'it maps a drive onto a folder (New-PSDrive)';
  if (/\bmklink\b[^\n]*\/[jd]\b/i.test(seg)) return 'it makes a junction or directory link (mklink)';
  if (/\bNew-Item\b[^\n]*-ItemType\s+['"]?(Junction|SymbolicLink)\b/i.test(seg)) return 'it makes a junction or link to a folder';
  return null;
}

function copyProblem(seg, facts, cwd) {
  const w = words(seg);
  const verb = (w[0] ?? '').toLowerCase().replace(/\.exe$/, '');
  const recursive =
    verb === 'robocopy' ||
    verb === 'xcopy' ||
    (/^(copy-item|cpi|copy)$/.test(verb) && w.some((a) => /^-r(ecurse)?$/i.test(a))) ||
    (verb === 'cp' && w.some((a) => /^-[a-z]*[raR][a-z]*$/.test(a)));
  if (!recursive) return null;
  for (const a of w.slice(1)) {
    // A Windows switch is a slash and a short word (/E, /MIR, /R:3); a path has more slashes.
    if (a.startsWith('-') || (verb !== 'cp' && /^\/[a-z]{1,8}(:\S*)?$/i.test(a))) continue;
    const resolved = norm(path.resolve(cwd, a));
    if (facts.roots.has(resolved)) return `it copies the whole repository (${a})`;
    break; // only the first operand is the source
  }
  return null;
}

const input = readInput();
const command = input?.tool_input?.command;
if (typeof command !== 'string' || !command.trim()) process.exit(0);

const cwd = input.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd();
const facts = projectFacts(cwd);

for (const seg of segments(command)) {
  const problem = cloneProblem(seg, facts) ?? worktreeProblem(seg) ?? aliasProblem(seg) ?? copyProblem(seg, facts, cwd);
  if (problem) {
    process.stderr.write(
      `Blocked: ${problem}. This project never gets a second local copy (a clone, a copied tree, a ` +
        `short-path drive or junction): they are never cleaned up and nothing needs one. Work in this ` +
        `checkout. For the phone build's long paths, set the Gradle property android.cmakeVersion to a ` +
        `newer CMake from the SDK Manager, or leave the build to CI (Linux). If the user explicitly ` +
        `asks for a copy, tell them this hook refused it and let them run the command themselves.\n`,
    );
    process.exit(2);
  }
}
process.exit(0);
