/**
 * The desktop shell never calls the page's own dialogs: `confirm`, `alert` or `prompt`.
 *
 * In the Tauri window `tauri-plugin-dialog` replaces them with async functions. `window.confirm(…)` there returns a
 * promise, which is truthy whatever the user would answer, so `if (!window.confirm(…)) return` asked nothing and went
 * ahead: "Remove from library" removed the feature at once, and a rest was taken on the first click. Found by driving
 * the Tauri window; the browser build, where they block and return a boolean, never showed it. An action that asks
 * first uses `ArmedButton` (`apps/desktop/src/panes/ArmedButton.tsx`), a second click on a button that says what it does.
 *
 * Perturbation: put `if (!window.confirm('Remove?')) return;` back into `removeFromLibrary` in
 * `apps/desktop/src/panes/CustomFeatures.tsx`, or `if (confirm(question))` into `PlayPanel.tsx`, and this fails naming
 * the file and line.
 */

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { test } from 'node:test';

const src = join(import.meta.dirname, '..', '..', '..', 'apps', 'desktop', 'src');

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.tsx?$/.test(entry.name) && !entry.name.endsWith('.test.ts') ? [path] : [];
  });
}

/** A call, with or without `window.`, and not a method of something else (`builder.confirm(`) or a longer name. */
const PAGE_DIALOG = /(?:\bwindow\.|(?<![.\w$]))(confirm|alert|prompt)\s*\(/;

test("the desktop shell calls none of the page's own dialogs, which the Tauri window makes async", () => {
  const calls: string[] = [];
  for (const file of sources(src)) {
    readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .forEach((line, at) => {
        // Calls, not mentions: a comment may name one, as this file's do.
        const code = line.trimStart();
        if (code.startsWith('//') || code.startsWith('*') || code.startsWith('/*')) return;
        const match = PAGE_DIALOG.exec(code.replace(/\/\/.*$/, ''));
        if (match) calls.push(`${relative(src, file).replace(/\\/g, '/')}:${at + 1}: ${match[1]}()`);
      });
  }
  assert.ok(sources(src).length > 20, 'the desktop sources were not found');
  assert.deepEqual(calls, []);
});
