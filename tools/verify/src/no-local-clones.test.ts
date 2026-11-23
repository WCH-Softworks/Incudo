// Holds the PreToolUse hook in .claude/hooks/no-local-clones.mjs to what it refuses and what it
// lets through. Sessions made short-path clones of this repository to dodge Windows' path limit
// and never removed them; the hook is the guard, and this test keeps it from quietly weakening.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const hook = path.join(root, '.claude', 'hooks', 'no-local-clones.mjs');

function run(command: string, tool = 'Bash'): { code: number | null; stderr: string } {
  const result = spawnSync(process.execPath, [hook], {
    input: JSON.stringify({ tool_name: tool, tool_input: { command }, cwd: root }),
    encoding: 'utf8',
  });
  return { code: result.status, stderr: result.stderr };
}

const remote = (() => {
  const r = spawnSync('git', ['remote', 'get-url', 'origin'], { cwd: root, encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : '';
})();

const refused = [
  'git clone . C:/ib',
  'git clone C:/somewhere/repo C:/ib',
  'git clone --depth 1 ../.. /c/ibc',
  'git clone file:///c/x/repo short',
  'cd /tmp && git clone "$PWD" ib',
  'git worktree add C:/ib main',
  'git worktree add -b x ../elsewhere',
  'subst X: C:/a/long/path',
  'New-PSDrive -Name Q -PSProvider FileSystem -Root C:/a/long/path',
  'cmd /c mklink /J C:\\ib C:\\a\\long\\path',
  'New-Item -ItemType Junction -Path C:/ib -Target .',
  'robocopy . C:\\ib /E',
  'Copy-Item -Recurse . C:/ib',
  'cp -r . /c/ib',
  `xcopy ${root} C:\\ib /E /I`,
  `robocopy /MIR ${root.replace(/\\/g, '/')} C:/ib`,
];

const allowed = [
  'git status',
  'git clone https://github.com/AuroraLegacy/elements.git .corpus',
  'git worktree add .claude/worktrees/some-name -b claude/some-name',
  'git worktree list',
  'npm run corpus:sync',
  'cp -r packages/ui/src/fixtures /tmp/scratch',
  'Copy-Item README.md C:/somewhere/README.md',
  'echo subst is a word',
];

for (const command of refused) {
  test(`refuses: ${command}`, () => {
    const { code, stderr } = run(command, 'PowerShell');
    assert.equal(code, 2, `expected exit 2, got ${code}`);
    assert.match(stderr, /^Blocked: /);
  });
}

if (remote) {
  test("refuses a clone of this repository's own remote", () => {
    assert.equal(run(`git clone ${remote} C:/ib`).code, 2);
  });
}

for (const command of allowed) {
  test(`lets through: ${command}`, () => {
    const { code, stderr } = run(command);
    assert.equal(code, 0, stderr);
  });
}

test('lets through input it cannot read', () => {
  const result = spawnSync(process.execPath, [hook], { input: 'not json', encoding: 'utf8' });
  assert.equal(result.status, 0);
});

test('the project settings run the hook on every shell command', () => {
  const settings = JSON.parse(readFileSync(path.join(root, '.claude', 'settings.json'), 'utf8'));
  const entries = settings.hooks?.PreToolUse ?? [];
  const entry = entries.find((e: { hooks: { command: string }[] }) =>
    e.hooks.some((h) => h.command.includes('no-local-clones.mjs')),
  );
  assert.ok(entry, 'no PreToolUse entry runs no-local-clones.mjs');
  assert.deepEqual(entry.matcher.split('|').sort(), ['Bash', 'PowerShell']);
});
