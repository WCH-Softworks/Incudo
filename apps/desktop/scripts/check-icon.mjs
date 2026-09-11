/**
 * Turn a missing icon into a sentence rather than a cargo backtrace.
 *
 * `tauri build` on Windows needs `src-tauri/icons/icon.ico`, and this repository deliberately
 * does not ship one: Incudo never generates artwork, not even as a placeholder (root README).
 * Without this check the first thing a new contributor sees is a failed build script three
 * hundred lines into a Rust compile, which reads as "the checkout is broken".
 */

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const icons = join(here, '..', 'src-tauri', 'icons');

if (!existsSync(join(icons, 'icon.ico'))) {
  process.stderr.write(
    [
      '',
      'The Tauri window needs an icon, and this repository does not ship one.',
      '',
      `  missing: ${join(icons, 'icon.ico')}`,
      '',
      'That is a deliberate gap, not a broken checkout: Incudo never ships generated',
      'artwork, so the icon is left for a person to draw. See',
      '  apps/desktop/src-tauri/icons/README.md',
      '',
      'Meanwhile the whole application runs in a browser with no Rust and no icon:',
      '',
      '  npm run desktop',
      '',
    ].join('\n'),
  );
  process.exit(1);
}
