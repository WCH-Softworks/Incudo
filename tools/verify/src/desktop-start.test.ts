/**
 * The desktop window starts in the colour the page draws, never white in the dark scheme.
 *
 * A window and its webview start white, and stayed white until the bundle brought `styles.css`: measured on a release
 * build on Windows, 0.5 s warm and 0.7 s cold. Two things close it, and each repeats the page's background, so the three
 * copies are held to each other here: `index.html` gives the page its background before the bundle loads, and
 * `src-tauri/src/lib.rs` shows the window, which `tauri.conf.json` creates hidden, once it has the system scheme's colour.
 * After it, no frame of a release build sampled white, cold or warm.
 *
 * The dev server's port is held here too, at the end.
 *
 * Perturbation: change `--bg` in the dark block of `styles.css`, or either colour in `index.html` or `lib.rs`, or drop
 * `"visible": false`, and this fails naming which.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

const desktop = join(import.meta.dirname, '..', '..', '..', 'apps', 'desktop');
const read = (path: string): string => readFileSync(join(desktop, path), 'utf8');

/** The colour after `name:` in the first `:root` block and in the one under `prefers-color-scheme: dark`. */
function schemes(css: string, name: string): { light: string; dark: string } {
  const dark = css.indexOf('prefers-color-scheme: dark');
  assert.ok(dark >= 0, 'a dark scheme is declared');
  const value = (from: number): string => {
    const match = new RegExp(`${name}\\s*:\\s*(#[0-9a-f]{6})`, 'i').exec(css.slice(from));
    assert.ok(match, `${name} is set`);
    return match[1]!.toLowerCase();
  };
  const light = value(css.indexOf(':root'));
  assert.ok(css.indexOf(':root') < dark, 'the light colours come first');
  return { light, dark: value(dark) };
}

function rustColour(source: string, name: string): string {
  const match = new RegExp(`const ${name}: tauri::window::Color = tauri::window::Color\\(0x(\\w\\w), 0x(\\w\\w), 0x(\\w\\w), 0xff\\)`).exec(source);
  assert.ok(match, `lib.rs declares ${name}`);
  return `#${match[1]}${match[2]}${match[3]}`.toLowerCase();
}

test("the page's background before its styles load is styles.css's", () => {
  const page = schemes(read('src/styles.css'), '--bg');
  const style = /<style>([\s\S]*?)<\/style>/.exec(read('index.html'));
  assert.ok(style, 'index.html has an inline style');
  assert.deepEqual(schemes(style[1]!, 'background'), page);
});

test('the window is created hidden and shown in the same colours', () => {
  const page = schemes(read('src/styles.css'), '--bg');
  const rust = read('src-tauri/src/lib.rs');
  assert.deepEqual({ light: rustColour(rust, 'LIGHT_BACKGROUND'), dark: rustColour(rust, 'DARK_BACKGROUND') }, page);
  assert.match(rust, /show_in_its_colour\(window\)/, 'setup shows each window');
  const config = JSON.parse(read('src-tauri/tauri.conf.json')) as { app: { windows: { visible?: boolean }[] } };
  for (const window of config.app.windows) assert.equal(window.visible, false, 'a configured window starts hidden');
});

/**
 * The dev server's port is `dev-port.json`'s, which `vite.config.ts` and `scripts/check-port.mjs` read; `tauri.conf.json`
 * cannot read a file, so its `devUrl` repeats it, and is held to it here. Not Vite's own 5173, which every other Vite
 * project on the machine wants. Perturbation: change either number and this fails.
 */
test("the window's dev address is the dev server's port", () => {
  const { port } = JSON.parse(read('dev-port.json')) as { port: number };
  const config = JSON.parse(read('src-tauri/tauri.conf.json')) as { build: { devUrl: string } };
  assert.equal(new URL(config.build.devUrl).port, String(port));
  assert.notEqual(port, 5173, "not Vite's default");
  assert.match(read('vite.config.ts'), /readFileSync\(resolve\(here, 'dev-port\.json'\)/, 'vite.config.ts reads it');
  assert.match(read('scripts/check-port.mjs'), /dev-port\.json/, 'check-port.mjs reads it');
});
