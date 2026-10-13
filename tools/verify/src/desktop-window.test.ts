/**
 * The desktop window is an application, not a browser tab: the browser's own keys are off and zoom is off.
 *
 * Measured with real keys in the Windows window (WebView2 Runtime 154), a release and a dev build: F5, Ctrl+R and
 * Ctrl+Shift+R reloaded the page, Ctrl+F, F3 and Ctrl+G opened a find bar, F7 offered caret browsing, Ctrl+J opened a
 * downloads panel, Alt+Left and the BrowserBack key went back; after `AreBrowserAcceleratorKeysEnabled` is switched off
 * none of them does anything, and every chord of `packages/ui/src/commands.ts` still reaches the page. A test in Node
 * cannot press keys, so what it holds is that the switch is made and that zoom stays off.
 *
 * Perturbation: drop the `SetAreBrowserAcceleratorKeysEnabled(false)` call or its install in setup, let F12 open DevTools
 * outside a debug build, or set `zoomHotkeysEnabled` on a window, and this fails naming which.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

const desktop = join(import.meta.dirname, '..', '..', '..', 'apps', 'desktop');
const read = (path: string): string => readFileSync(join(desktop, path), 'utf8');

test("the window switches off the browser's own keys", () => {
  const rust = read('src-tauri/src/lib.rs');
  assert.match(rust, /SetAreBrowserAcceleratorKeysEnabled\(false\)/, 'the setting is switched off');
  assert.match(rust, /browser_keys::install\(window\)/, 'setup installs it on each window');
  assert.equal(rust.match(/fn dev_tools_on_f12/g)?.length, 1, 'a dev build opens DevTools on F12');
  assert.ok(/#\[cfg\(debug_assertions\)\]\s*unsafe fn dev_tools_on_f12/.test(rust), 'and only a dev build');
  assert.ok(/#\[cfg\(debug_assertions\)\]\s*dev_tools_on_f12\(/.test(rust), 'whose call is a dev build’s too');
});

test('zoom stays off in every window', () => {
  // Tauri's default is false, and wry sets both WebView2's zoom keys and pinch from it.
  const config = JSON.parse(read('src-tauri/tauri.conf.json')) as { app: { windows: { zoomHotkeysEnabled?: boolean }[] } };
  for (const window of config.app.windows) assert.notEqual(window.zoomHotkeysEnabled, true);
});
