/**
 * The command list — ADR 0037.
 *
 * Every test here was written to fail if the behaviour it names is removed, and the ones that
 * matter were checked by removing it (the perturbations are listed in the ADR). A green run on
 * a test that could not have failed is the failure the rest of this project keeps recording.
 *
 * What none of this can show is a menu on a screen or a key reaching a window; that is the
 * running app's job and the desktop README says what was and was not seen there.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  absentCommands,
  COMMANDS,
  COMMAND_IDS,
  MENUS,
  NO_WORKSPACE,
  describeCommand,
  formatShortcut,
  importBlock,
  isEnabled,
  keyOutcome,
  matchShortcut,
  menuModel,
  resolveCommands,
  type CommandContext,
  type CommandId,
  type Destination,
  type KeyLike,
  type Os,
} from './commands.ts';

// --- fixtures ---------------------------------------------------------------------------------

/** A workspace with a library, content, sources and a picker: nothing in the way. */
const READY: CommandContext = {
  workspace: true,
  pane: 'library',
  modal: false,
  library: 'ready',
  libraryBusy: false,
  contentBusy: false,
  hasEnabledSource: true,
  contentLoaded: true,
  pickerAvailable: true,
  importing: false,
  saving: false,
  saverAvailable: true,
  copying: false,
  exporting: false,
  pdfAvailable: true,
  formAvailable: true,
  contentUpdates: true,
  started: true,
};

function enabledIn(context: CommandContext): Set<CommandId> {
  return new Set(
    resolveCommands(context)
      .filter((command) => command.enabled)
      .map((command) => command.id),
  );
}

function key(k: string, mods: Partial<KeyLike> = {}): KeyLike {
  return { key: k, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...mods };
}

const NAVIGATION: CommandId[] = ['go-library', 'go-build', 'go-sheet', 'go-sources', 'go-browse', 'go-settings'];

// --- what is enabled --------------------------------------------------------------------------

test('on the launcher — no character open — nothing is enabled, not even navigation', () => {
  // A menu whose "Sheet" item worked with no system chosen would move a view that is not there.
  assert.deepEqual([...enabledIn(NO_WORKSPACE)], []);
  // ...and the same holds when every other fact would otherwise allow the command.
  assert.deepEqual([...enabledIn({ ...READY, workspace: false })], []);
});

test('with no library chosen, only what does not need one is enabled', () => {
  const on = enabledIn({ ...READY, library: 'no-location', hasEnabledSource: false });
  assert.deepEqual(
    [...on].sort(),
    [...NAVIGATION, 'change-system', 'choose-library-folder', 'about'].sort(),
  );
  // The three that need somewhere to put a character say no, and Save says no on any pane.
  for (const pane of ['library', 'build'] as Destination[]) {
    const there = enabledIn({ ...READY, pane, library: 'no-location' });
    assert.ok(!there.has('save-character'), `save on ${pane}`);
    assert.ok(!there.has('new-character'), `new on ${pane}`);
    assert.ok(!there.has('import-aurora'), `import on ${pane}`);
  }
});

test('a platform with no folder access cannot be asked to choose one', () => {
  const on = enabledIn({ ...READY, library: 'unavailable', pickerAvailable: false });
  assert.ok(!on.has('choose-library-folder'));
  assert.ok(!on.has('refresh-library'));
  assert.ok(on.has('go-sources'), 'sources work without a library');
});

test('on the library screen with everything loaded, the library commands are enabled', () => {
  const on = enabledIn(READY);
  for (const id of ['new-character', 'import-aurora', 'refresh-library', 'reload-sources'] as CommandId[]) {
    assert.ok(on.has(id), id);
  }
  // Its outcome is printed on the Build pane, so it is not a library-screen command.
  assert.ok(!on.has('save-character'));
});

test('mid-edit on the build pane: save and new character are live, and import is not', () => {
  const on = enabledIn({ ...READY, pane: 'build' });
  assert.ok(on.has('save-character'));
  // New character asks before it replaces unsaved changes (ADR 0120), so it is live on every pane with a library.
  // Fails if it goes back to the library screen only.
  for (const pane of ['build', 'sheet', 'sources', 'browse', 'settings'] as Destination[]) {
    assert.ok(enabledIn({ ...READY, pane }).has('new-character'), pane);
  }
  assert.ok(!on.has('import-aurora'), 'its report is shown on the library screen');
  for (const pane of ['sheet', 'sources', 'browse', 'settings'] as Destination[]) {
    assert.ok(!enabledIn({ ...READY, pane }).has('save-character'), pane);
  }
});

test('a save in flight cannot be started again', () => {
  // Two saves racing on one `readAt` is how the second reports a conflict with the first.
  assert.ok(!enabledIn({ ...READY, pane: 'build', saving: true }).has('save-character'));
});

// --- save a copy ---------------------------------------------------------------------------------

test('a copy is live on the build pane and nowhere else', () => {
  // "Saved a copy as …" is printed on Build, beside Save, so that is where it can be started.
  assert.ok(enabledIn({ ...READY, pane: 'build' }).has('save-copy'));
  for (const pane of ['library', 'sheet', 'sources', 'browse', 'settings'] as Destination[]) {
    assert.ok(!enabledIn({ ...READY, pane }).has('save-copy'), pane);
  }
});

test('a copy needs no library: it is live with none chosen, and where the library is unavailable', () => {
  // This is what separates it from Save, and it is the reason for a second command at all.
  for (const library of ['no-location', 'unavailable', 'scanning'] as const) {
    const on = enabledIn({ ...READY, pane: 'build', library });
    assert.ok(on.has('save-copy'), library);
    assert.ok(!on.has('save-character'), `save with the library ${library}`);
  }
});

test('a copy needs a save dialog to exist', () => {
  assert.ok(!enabledIn({ ...READY, pane: 'build', saverAvailable: false }).has('save-copy'));
  // ...and does not need the file picker that importing uses, which is a different capability.
  assert.ok(enabledIn({ ...READY, pane: 'build', pickerAvailable: false }).has('save-copy'));
});

test('a copy in flight blocks another copy and a save, and a save in flight blocks a copy', () => {
  // Two dialogs on one keystroke, and two "Saved …" notes racing for the same line.
  const copying = enabledIn({ ...READY, pane: 'build', copying: true });
  assert.ok(!copying.has('save-copy'));
  assert.ok(!copying.has('save-character'));
  assert.ok(!enabledIn({ ...READY, pane: 'build', saving: true }).has('save-copy'));
});

test('a copy is unavailable behind a dialog, and still claims its key', () => {
  assert.ok(!enabledIn({ ...READY, pane: 'build', modal: true }).has('save-copy'));
  // Ctrl+Shift+D on the Sheet pane must not fall through to the browser (bookmark all tabs).
  const outcome = keyOutcome(
    key('D', { ctrlKey: true, shiftKey: true }),
    'other',
    resolveCommands({ ...READY, pane: 'sheet' }),
  );
  assert.deepEqual(outcome, { id: 'save-copy', claimed: true, run: false });
  assert.equal(
    keyOutcome(key('D', { ctrlKey: true, shiftKey: true }), 'other', resolveCommands({ ...READY, pane: 'build' }))
      ?.run,
    true,
  );
});

test('a copy sits beside Save in the File menu, labelled as a question, with its own shortcut', () => {
  const file = MENUS.find((menu) => menu.label === 'File')!;
  assert.equal(file.items.indexOf('save-copy'), file.items.indexOf('save-character') + 1);
  const entry = menuModel('other')
    .flatMap((menu) => menu.entries)
    .find((e) => e.kind === 'command' && e.id === 'save-copy') as { label: string; shortcut?: string };
  assert.equal(entry.label, 'Save a copy…');
  assert.equal(entry.shortcut, 'Ctrl+Shift+D');
  assert.equal(describeCommand('save-copy', 'mac'), 'Save a copy… (⇧⌘D)');
});

// --- export the sheet as text ----------------------------------------------------------------------

test('an export is live on the sheet and nowhere else, with no library and no content', () => {
  // ADR 0075: "Exported the sheet as …" is printed on the Sheet, and what it writes is what is on screen there. Fails if
  // the rule names another pane, or asks for the library or for content.
  assert.ok(enabledIn({ ...READY, pane: 'sheet' }).has('export-sheet'));
  for (const pane of ['library', 'build', 'sources', 'browse', 'settings'] as Destination[]) {
    assert.ok(!enabledIn({ ...READY, pane }).has('export-sheet'), pane);
  }
  const bare = { ...READY, pane: 'sheet' as const, library: 'no-location' as const, contentLoaded: false, hasEnabledSource: false };
  assert.ok(enabledIn(bare).has('export-sheet'));
});

test('an export needs a save dialog, is not started twice, and waits behind a dialog', () => {
  assert.ok(!enabledIn({ ...READY, pane: 'sheet', saverAvailable: false }).has('export-sheet'));
  assert.ok(!enabledIn({ ...READY, pane: 'sheet', exporting: true }).has('export-sheet'));
  assert.ok(!enabledIn({ ...READY, pane: 'sheet', modal: true }).has('export-sheet'));
});

test('an export sits below Save a copy in the File menu, labelled as a question, on Ctrl+Shift+O', () => {
  const file = MENUS.find((menu) => menu.label === 'File')!;
  assert.equal(file.items.indexOf('export-sheet'), file.items.indexOf('save-copy') + 1);
  const entry = menuModel('other')
    .flatMap((menu) => menu.entries)
    .find((e) => e.kind === 'command' && e.id === 'export-sheet') as { label: string; shortcut?: string };
  assert.equal(entry.label, 'Export sheet as text…');
  assert.equal(entry.shortcut, 'Ctrl+Shift+O');
});

// --- print the sheet -------------------------------------------------------------------------------

test('printing is live on the sheet and nowhere else, needing no library, content or save dialog', () => {
  // ADR 0077: what prints is the Sheet on screen. Fails if the rule names another pane, or asks for anything else.
  assert.ok(enabledIn({ ...READY, pane: 'sheet' }).has('print-sheet'));
  for (const pane of ['library', 'build', 'sources', 'browse', 'settings'] as Destination[]) {
    assert.ok(!enabledIn({ ...READY, pane }).has('print-sheet'), pane);
  }
  const bare = { ...NO_WORKSPACE, workspace: true, started: true, pane: 'sheet' as const };
  assert.ok(enabledIn(bare).has('print-sheet'), 'no library, no content, no pickers');
  assert.ok(enabledIn({ ...READY, pane: 'sheet', exporting: true }).has('print-sheet'), 'an export in flight does not stop a print');
  assert.ok(!enabledIn({ ...READY, pane: 'sheet', modal: true }).has('print-sheet'));
});

test('printing sits below the text export in the File menu, labelled as a question, on Ctrl+P', () => {
  const file = MENUS.find((menu) => menu.label === 'File')!;
  assert.equal(file.items.indexOf('print-sheet'), file.items.indexOf('export-sheet') + 1);
  const entry = menuModel('other')
    .flatMap((menu) => menu.entries)
    .find((e) => e.kind === 'command' && e.id === 'print-sheet') as { label: string; shortcut?: string };
  assert.equal(entry.label, 'Print sheet…');
  assert.equal(entry.shortcut, 'Ctrl+P');
  assert.equal(describeCommand('print-sheet', 'mac'), 'Print sheet… (⌘P)');
});

test('Ctrl+P is claimed on every pane and prints only on the sheet', () => {
  // Fails if Ctrl+P is left to the platform off the Sheet: it would print whichever pane is showing.
  for (const pane of ['library', 'build', 'sheet', 'sources', 'browse', 'settings'] as Destination[]) {
    const outcome = keyOutcome(key('p', { ctrlKey: true }), 'other', resolveCommands({ ...READY, pane }));
    assert.deepEqual(outcome, { id: 'print-sheet', claimed: true, run: pane === 'sheet' }, pane);
  }
  assert.equal(matchShortcut(key('p', { metaKey: true }), 'mac'), 'print-sheet');
  assert.equal(matchShortcut(key('P', { ctrlKey: true, shiftKey: true }), 'other'), undefined, 'Ctrl+Shift+P is not print');
});

test('while the print options step is open, Ctrl+P is claimed and runs nothing (ADR 0078)', () => {
  // The step is a modal dialog: a second Ctrl+P must neither open the platform's dialog behind it nor a second step.
  // Fails if the modal flag stops claiming the key (the platform would print the page with the step on it).
  const outcome = keyOutcome(key('p', { ctrlKey: true }), 'other', resolveCommands({ ...READY, pane: 'sheet', modal: true }));
  assert.deepEqual(outcome, { id: 'print-sheet', claimed: true, run: false });
  // The label still ends in an ellipsis: the command asks something before it prints.
  assert.ok(COMMANDS.find((c) => c.id === 'print-sheet')!.label.endsWith('…'));
});

test('while the library scans: new character stays, refresh and save do not', () => {
  const scanning = enabledIn({ ...READY, library: 'scanning', libraryBusy: true });
  assert.ok(scanning.has('new-character'), 'the screen shows its button while scanning');
  assert.ok(!scanning.has('refresh-library'));
  assert.ok(!enabledIn({ ...READY, pane: 'build', library: 'scanning' }).has('save-character'));
  assert.ok(!enabledIn({ ...READY, libraryBusy: true }).has('refresh-library'));
});

test('a modal dialog disables every command, including navigation behind it', () => {
  assert.deepEqual([...enabledIn({ ...READY, modal: true })], []);
  assert.deepEqual([...enabledIn({ ...READY, pane: 'build', modal: true })], []);
});

test('importing: not while one runs, and the reason is a code the pane can explain', () => {
  assert.ok(!enabledIn({ ...READY, importing: true }).has('import-aurora'));
  assert.equal(importBlock(READY), undefined);
  assert.equal(importBlock({ ...READY, pickerAvailable: false }), 'no-picker');
  assert.equal(importBlock({ ...READY, library: 'no-location' }), 'no-library');
  assert.equal(importBlock({ ...READY, library: 'scanning' }), 'no-library');
  assert.equal(importBlock({ ...READY, contentLoaded: false }), 'no-content');
  // The most fundamental reason wins: no picker beats everything, no library beats no content.
  assert.equal(
    importBlock({ pickerAvailable: false, library: 'no-location', contentLoaded: false }),
    'no-picker',
  );
  assert.equal(
    importBlock({ pickerAvailable: true, library: 'no-location', contentLoaded: false }),
    'no-library',
  );
  assert.ok(!enabledIn({ ...READY, contentLoaded: false }).has('import-aurora'));
});

test('reloading sources needs one enabled and nothing already loading', () => {
  assert.ok(!enabledIn({ ...READY, hasEnabledSource: false }).has('reload-sources'));
  assert.ok(!enabledIn({ ...READY, contentBusy: true }).has('reload-sources'));
});

test('every command is resolved, in the list order', () => {
  assert.deepEqual(
    resolveCommands(READY).map((command) => command.id),
    COMMANDS.map((command) => command.id),
  );
  assert.equal(isEnabled(resolveCommands(READY), 'go-build'), true);
  assert.equal(isEnabled(resolveCommands(NO_WORKSPACE), 'go-build'), false);
});

// --- the list is well formed ------------------------------------------------------------------

test('the id list and the command list are the same set, once each', () => {
  assert.deepEqual([...COMMANDS.map((c) => c.id)].sort(), [...COMMAND_IDS].sort());
  assert.equal(new Set(COMMAND_IDS).size, COMMAND_IDS.length);
});

test('no two commands share a shortcut', () => {
  const seen = new Map<string, CommandId>();
  for (const command of COMMANDS) {
    if (!command.shortcut) continue;
    const s = command.shortcut;
    const chord = `${s.primary}|${s.shift ?? false}|${s.alt ?? false}|${s.key.toLowerCase()}`;
    assert.equal(seen.get(chord), undefined, `${command.id} collides with ${seen.get(chord)}`);
    seen.set(chord, command.id);
  }
  assert.ok(seen.size >= 8, 'the table is not accidentally empty');
});

test('every shortcut is a chord that leaves text editing alone', () => {
  // The editing keys of a text field. Ctrl+A/C/V/X/Z/Y, and the arrows and Backspace/Delete
  // that a chord with Shift or Ctrl would turn into word- and line-selection.
  const editing = new Set(['a', 'c', 'v', 'x', 'z', 'y', 'backspace', 'delete', 'enter', 'tab',
    'arrowleft', 'arrowright', 'arrowup', 'arrowdown', 'home', 'end', ' ']);
  for (const command of COMMANDS) {
    const s = command.shortcut;
    if (!s) continue;
    assert.equal(s.primary, true, `${command.id} would fire while typing a plain character`);
    assert.ok(!editing.has(s.key.toLowerCase()), `${command.id} takes ${s.key}, an editing key`);
    // Ctrl+Alt is AltGr, which is how a Brazilian keyboard types punctuation; F-keys are the
    // browser's. Neither is used, so neither can be the reason a key stops working.
    assert.ok(!s.alt, `${command.id} uses Alt`);
    assert.ok(!/^f\d+$/i.test(s.key), `${command.id} uses a function key`);
  }
});

test('no shortcut takes a chord the Windows window never delivers to the page', () => {
  // Found by pressing real keys in the Tauri window (WebView2): for these Ctrl+Shift chords the
  // key-down is taken before the page, and only the key-up arrives, so a command on one is a
  // shortcut that works in a browser tab, shows in the menu, and does nothing in the window.
  // Injected key events cannot show this: they never pass through that layer.
  const swallowed = ['s', 'e', 'u', 'm', 'g', 'x'];
  for (const command of COMMANDS) {
    const s = command.shortcut;
    if (!s?.shift) continue;
    assert.ok(!swallowed.includes(s.key.toLowerCase()), `${command.id} is on Ctrl+Shift+${s.key}`);
  }
});

test('every Ctrl+Shift shortcut is a chord seen to reach the page in the Windows window', () => {
  // The other half of the list above: pressed with real keys, K, O, D, H, B, Y and L arrived (ADR 0038). A chord nobody
  // pressed there may be one WebView2 takes. Fails if a command is put on one before it has been pressed in the window.
  const arrives = ['k', 'o', 'd', 'h', 'b', 'y', 'l'];
  for (const command of COMMANDS) {
    const s = command.shortcut;
    if (!s?.shift) continue;
    assert.ok(arrives.includes(s.key.toLowerCase()), `${command.id} is on Ctrl+Shift+${s.key}, never pressed in the window`);
  }
});

test('the navigation commands reach every destination exactly once', () => {
  const destinations = COMMANDS.flatMap((c) => (c.destination ? [c.destination] : []));
  assert.deepEqual(destinations.sort(), ['browse', 'build', 'library', 'settings', 'sheet', 'sources']);
});

// --- keys -------------------------------------------------------------------------------------

test('the primary modifier is Ctrl on Windows and Linux and Cmd on macOS, never both', () => {
  assert.equal(matchShortcut(key('s', { ctrlKey: true }), 'other'), 'save-character');
  assert.equal(matchShortcut(key('s', { metaKey: true }), 'mac'), 'save-character');
  assert.equal(matchShortcut(key('s', { metaKey: true }), 'other'), undefined);
  // Ctrl+S on a Mac is not Save, and Ctrl+Cmd+S is not either.
  assert.equal(matchShortcut(key('s', { ctrlKey: true }), 'mac'), undefined);
  assert.equal(matchShortcut(key('s', { ctrlKey: true, metaKey: true }), 'mac'), undefined);
  assert.equal(matchShortcut(key('s', { ctrlKey: true, metaKey: true }), 'other'), undefined);
});

test('modifiers are compared exactly, and case does not matter', () => {
  // Ctrl+S is Save and Ctrl+Shift+D is a copy: Shift is compared, so neither answers for the other.
  assert.equal(matchShortcut(key('D', { ctrlKey: true, shiftKey: true }), 'other'), 'save-copy');
  assert.equal(matchShortcut(key('d', { ctrlKey: true, shiftKey: true }), 'other'), 'save-copy');
  assert.equal(matchShortcut(key('d', { ctrlKey: true }), 'other'), undefined, 'without shift it is no shortcut');
  assert.equal(matchShortcut(key('S', { ctrlKey: true }), 'other'), 'save-character', 'caps lock');
  assert.equal(matchShortcut(key('S', { ctrlKey: true, shiftKey: true }), 'other'), undefined, 'not a Save As');
  assert.equal(matchShortcut(key('d', { metaKey: true, shiftKey: true }), 'mac'), 'save-copy');
  assert.equal(matchShortcut(key('d', { ctrlKey: true, shiftKey: true, altKey: true }), 'other'), undefined);
  assert.equal(matchShortcut(key('L', { ctrlKey: true, shiftKey: true }), 'other'), 'refresh-library');
  assert.equal(matchShortcut(key('l', { ctrlKey: true }), 'other'), undefined, 'without shift it is no shortcut');
  assert.equal(matchShortcut(key(',', { ctrlKey: true }), 'other'), 'go-settings');
});

test('a printable key alone, or with Shift alone, is never a shortcut', () => {
  // Typing "n", "s", "1" or ",", in a name field or a search box.
  for (const k of ['n', 's', 'l', '1', '2', '3', '4', ',', 'N', 'S', 'L', '!', '?']) {
    assert.equal(matchShortcut(key(k), 'other'), undefined, k);
    assert.equal(matchShortcut(key(k, { shiftKey: true }), 'other'), undefined, `shift+${k}`);
    assert.equal(matchShortcut(key(k), 'mac'), undefined, `mac ${k}`);
  }
});

test('Ctrl+A, C, V, X, Z and Y are text editing and are never claimed', () => {
  for (const k of ['a', 'c', 'v', 'x', 'z', 'y']) {
    for (const os of ['mac', 'other'] as Os[]) {
      const mods = os === 'mac' ? { metaKey: true } : { ctrlKey: true };
      assert.equal(keyOutcome(key(k, mods), os, resolveCommands(READY)), undefined, `${os} ${k}`);
      assert.equal(
        keyOutcome(key(k, { ...mods, shiftKey: true }), os, resolveCommands(READY)),
        undefined,
        `${os} shift+${k}`,
      );
    }
  }
});

test('AltGr, which Windows reports as Ctrl+Alt, does not trigger a shortcut', () => {
  // On a Brazilian layout AltGr+1 is a character. Alt is compared exactly, so it stays one.
  for (const k of ['1', '2', '3', '4', ',', 'n', 's', 'l']) {
    assert.equal(matchShortcut(key(k, { ctrlKey: true, altKey: true }), 'other'), undefined, k);
    assert.equal(
      matchShortcut(key(k, { ctrlKey: true, altKey: true, shiftKey: true }), 'other'),
      undefined,
      `shift+${k}`,
    );
  }
});

test('a matching key is claimed and runs when the command is available', () => {
  const resolved = resolveCommands({ ...READY, pane: 'build' });
  assert.deepEqual(keyOutcome(key('s', { ctrlKey: true }), 'other', resolved), {
    id: 'save-character',
    claimed: true,
    run: true,
  });
});

test('an unavailable command still claims its key, so the browser does not act on it', () => {
  // Ctrl+S on the Sheet pane is "save this web page" if it is let through.
  const resolved = resolveCommands({ ...READY, pane: 'sheet' });
  assert.deepEqual(keyOutcome(key('s', { ctrlKey: true }), 'other', resolved), {
    id: 'save-character',
    claimed: true,
    run: false,
  });
  // ...and on the launcher, where nothing is available at all.
  const idle = resolveCommands(NO_WORKSPACE);
  assert.deepEqual(keyOutcome(key('2', { ctrlKey: true }), 'other', idle), {
    id: 'go-build',
    claimed: true,
    run: false,
  });
});

test('a held key claims once per press and runs once', () => {
  const resolved = resolveCommands(READY);
  const held = keyOutcome(key('n', { ctrlKey: true, repeat: true }), 'other', resolved);
  assert.deepEqual(held, { id: 'new-character', claimed: true, run: false });
  assert.equal(keyOutcome(key('n', { ctrlKey: true }), 'other', resolved)?.run, true);
});

test('a key pressed while composing text is not a shortcut', () => {
  const resolved = resolveCommands(READY);
  assert.equal(keyOutcome(key('n', { ctrlKey: true, isComposing: true }), 'other', resolved), undefined);
});

// --- the two shells share one list ------------------------------------------------------------

test('every command is in exactly one menu, and every menu item is a command', () => {
  const placed = MENUS.flatMap((menu) => menu.items).filter((item): item is CommandId => item !== null);
  assert.deepEqual([...placed].sort(), [...COMMAND_IDS].sort());
  assert.equal(new Set(placed).size, placed.length, 'a command listed twice');
});

test('no menu opens or closes on a separator or holds two in a row', () => {
  for (const menu of MENUS) {
    assert.notEqual(menu.items[0], null, `${menu.label} opens with a separator`);
    assert.notEqual(menu.items.at(-1), null, `${menu.label} ends with a separator`);
    menu.items.forEach((item, index) => {
      if (item === null) assert.notEqual(menu.items[index - 1], null, `${menu.label} doubles a separator`);
    });
  }
});

test('the id a menu item fires is the id its shortcut fires', () => {
  // The native window and the browser build are two front doors to one list. Drive each door
  // with a fake host: menu entries call `run(entry.id)`; the keyboard calls it via keyOutcome.
  const fromMenu: CommandId[] = [];
  const fromKeyboard: CommandId[] = [];
  const everything = resolveCommands(READY);

  for (const menu of menuModel('other')) {
    for (const entry of menu.entries) if (entry.kind === 'command') fromMenu.push(entry.id);
  }
  for (const command of COMMANDS) {
    if (!command.shortcut) continue;
    const event = key(command.shortcut.key, {
      ctrlKey: command.shortcut.primary,
      shiftKey: command.shortcut.shift ?? false,
    });
    const outcome = keyOutcome(event, 'other', everything);
    assert.equal(outcome?.id, command.id, `${command.id}'s own shortcut reaches ${outcome?.id}`);
    if (outcome) fromKeyboard.push(outcome.id);
  }

  assert.deepEqual([...fromMenu].sort(), [...COMMAND_IDS].sort(), 'the menu reaches every command');
  for (const id of fromKeyboard) assert.ok(fromMenu.includes(id), `${id} has a shortcut and no menu item`);
});

test('the native menu model carries each command\'s label and the shortcut to print, per platform', () => {
  for (const os of ['other', 'mac'] as Os[]) {
    const entries = menuModel(os).flatMap((menu) => menu.entries);
    const byId = new Map(
      entries.flatMap((entry) => (entry.kind === 'command' ? [[entry.id, entry] as const] : [])),
    );
    for (const command of COMMANDS) {
      const entry = byId.get(command.id)!;
      assert.equal(entry.label, command.label);
      assert.equal(
        entry.shortcut,
        command.shortcut ? formatShortcut(command.shortcut, os) : undefined,
        `${os} ${command.id}`,
      );
    }
    assert.equal(entries.filter((e) => e.kind === 'separator').length, 3);
  }
  const other = menuModel('other').flatMap((menu) => menu.entries);
  const find = (id: CommandId) => other.find((e) => e.kind === 'command' && e.id === id);
  assert.equal((find('save-character') as { shortcut?: string }).shortcut, 'Ctrl+S');
  assert.equal((find('go-settings') as { shortcut?: string }).shortcut, 'Ctrl+,');
  assert.equal((find('import-aurora') as { shortcut?: string }).shortcut, undefined);
  const mac = menuModel('mac').flatMap((menu) => menu.entries);
  assert.equal(
    (mac.find((e) => e.kind === 'command' && e.id === 'refresh-library') as { shortcut?: string }).shortcut,
    '⇧⌘L',
  );
});

test('a menu entry prints a shortcut and binds none: the model has no accelerator to register', () => {
  // Registering one is what failed in the Windows window (ADR 0037). Nothing in the model may
  // look like a key binding a shell could hand to a native menu.
  for (const os of ['other', 'mac'] as Os[]) {
    for (const menu of menuModel(os)) {
      for (const entry of menu.entries) {
        assert.deepEqual(
          Object.keys(entry).filter((k) => /accel|binding|hotkey/i.test(k)),
          [],
          `${menu.label}: ${JSON.stringify(entry)}`,
        );
      }
    }
  }
});

// --- labels -----------------------------------------------------------------------------------

test('a shortcut is labelled for the platform it is shown on, from the same data', () => {
  const refresh = COMMANDS.find((c) => c.id === 'refresh-library')!.shortcut!;
  const save = COMMANDS.find((c) => c.id === 'save-character')!.shortcut!;
  assert.equal(formatShortcut(save, 'other'), 'Ctrl+S');
  assert.equal(formatShortcut(save, 'mac'), '⌘S');
  assert.equal(formatShortcut(refresh, 'other'), 'Ctrl+Shift+L');
  assert.equal(formatShortcut(refresh, 'mac'), '⇧⌘L');
  assert.equal(describeCommand('go-build', 'other'), 'Build (Ctrl+2)');
  assert.equal(describeCommand('go-build', 'mac'), 'Build (⌘2)');
  assert.equal(describeCommand('import-aurora', 'other'), 'Import from Aurora…');
});

test('labels are plain text: no ADR numbers, no internal names', () => {
  for (const command of COMMANDS) {
    assert.doesNotMatch(command.label, /\badr\b|\d{4}|_|\bui\b|\bcore\b/i, command.label);
    assert.doesNotMatch(command.label, /[a-z][A-Z]/, `${command.label} reads like an identifier`);
  }
  for (const menu of MENUS) assert.match(menu.label, /^[A-Z][a-z]+$/);
});

// --- the sheet as a PDF (ADR 0079) ------------------------------------------------------------------

test('a PDF export is live on the sheet only, where the shell writes PDFs and saves files, and not twice at once', () => {
  // Fails if the rule ignores the writer (the browser build would offer it), the save dialog, an export in flight or a
  // dialog in front, or names another pane.
  assert.ok(enabledIn({ ...READY, pane: 'sheet' }).has('export-sheet-pdf'));
  for (const pane of ['library', 'build', 'sources', 'browse', 'settings'] as Destination[]) {
    assert.ok(!enabledIn({ ...READY, pane }).has('export-sheet-pdf'), pane);
  }
  assert.ok(!enabledIn({ ...READY, pane: 'sheet', pdfAvailable: false }).has('export-sheet-pdf'));
  assert.ok(!enabledIn({ ...READY, pane: 'sheet', saverAvailable: false }).has('export-sheet-pdf'));
  assert.ok(!enabledIn({ ...READY, pane: 'sheet', exporting: true }).has('export-sheet-pdf'));
  assert.ok(!enabledIn({ ...READY, pane: 'sheet', modal: true }).has('export-sheet-pdf'));
  // Like the text export it needs no library and no content.
  const bare = { ...READY, pane: 'sheet' as const, library: 'no-location' as const, contentLoaded: false, hasEnabledSource: false };
  assert.ok(enabledIn(bare).has('export-sheet-pdf'));
});

test('a PDF export sits below Print in the File menu, with no shortcut, and a shell with no PDF writer has no such item', () => {
  const file = MENUS.find((menu) => menu.label === 'File')!;
  assert.equal(file.items.indexOf('export-sheet-pdf'), file.items.indexOf('print-sheet') + 1);
  const entries = menuModel('other').flatMap((menu) => menu.entries);
  const entry = entries.find((e) => e.kind === 'command' && e.id === 'export-sheet-pdf') as { label: string; shortcut?: string };
  assert.equal(entry.label, 'Export sheet as PDF…');
  assert.equal(entry.shortcut, undefined);
  // Fails if an absent command is greyed rather than left out, or if leaving one out leaves the rest of the menu changed.
  assert.deepEqual(absentCommands({ pdfAvailable: true }), []);
  assert.deepEqual(absentCommands({ pdfAvailable: false }), ['export-sheet-pdf']);
  const without = menuModel('other', absentCommands({ pdfAvailable: false })).flatMap((menu) => menu.entries);
  assert.equal(without.some((e) => e.kind === 'command' && e.id === 'export-sheet-pdf'), false);
  assert.deepEqual(without, entries.filter((e) => !(e.kind === 'command' && e.id === 'export-sheet-pdf')));
});

test('a menu leaving commands out keeps no separator at an edge or beside another', () => {
  // Fails if separators are not tidied: leaving out every command of a group would leave two in a row.
  const group = ['import-aurora'] as CommandId[];
  const file = menuModel('other', group).find((menu) => menu.label === 'File')!.entries;
  file.forEach((entry, index) => {
    if (entry.kind === 'separator') {
      assert.ok(index > 0 && index < file.length - 1, 'not at an edge');
      assert.notEqual(file[index - 1]!.kind, 'separator', 'not doubled');
    }
  });
  assert.equal(file.filter((e) => e.kind === 'separator').length, 2);
});

// --- the official sheet (ADR 0079) ----------------------------------------------------------------------

test('filling the official sheet is live on the sheet of a kind with a form, where a copy can be saved', () => {
  // Fails if the rule ignores the form (an NPC would be offered it), the save dialog, an export in flight or a dialog in
  // front, or names another pane. It needs no PDF writer: the browser build fills too.
  assert.ok(enabledIn({ ...READY, pane: 'sheet' }).has('fill-official-sheet'));
  assert.ok(enabledIn({ ...READY, pane: 'sheet', pdfAvailable: false }).has('fill-official-sheet'));
  for (const pane of ['library', 'build', 'sources', 'browse', 'settings'] as Destination[]) {
    assert.ok(!enabledIn({ ...READY, pane }).has('fill-official-sheet'), pane);
  }
  assert.ok(!enabledIn({ ...READY, pane: 'sheet', formAvailable: false }).has('fill-official-sheet'));
  assert.ok(!enabledIn({ ...READY, pane: 'sheet', saverAvailable: false }).has('fill-official-sheet'));
  assert.ok(!enabledIn({ ...READY, pane: 'sheet', exporting: true }).has('fill-official-sheet'));
  assert.ok(!enabledIn({ ...READY, pane: 'sheet', modal: true }).has('fill-official-sheet'));
});

test('filling the official sheet sits below the PDF export in the File menu, with no shortcut', () => {
  const file = MENUS.find((menu) => menu.label === 'File')!;
  assert.equal(file.items.indexOf('fill-official-sheet'), file.items.indexOf('export-sheet-pdf') + 1);
  const entry = menuModel('other')
    .flatMap((menu) => menu.entries)
    .find((e) => e.kind === 'command' && e.id === 'fill-official-sheet') as { label: string; shortcut?: string };
  assert.equal(entry.label, 'Fill the official sheet…');
  assert.equal(entry.shortcut, undefined);
});

// --- content updates (ADR 0082) ----------------------------------------------------------------------------

test('reviewing content updates is live on Build and the Sheet while the open character has some', () => {
  // Fails if the rule ignores whether there is anything to refresh, a load in flight, or a dialog in front, or names
  // another pane.
  for (const pane of ['build', 'sheet'] as Destination[]) assert.ok(enabledIn({ ...READY, pane }).has('review-content-updates'), pane);
  for (const pane of ['library', 'sources', 'browse', 'settings'] as Destination[]) {
    assert.ok(!enabledIn({ ...READY, pane }).has('review-content-updates'), pane);
  }
  assert.ok(!enabledIn({ ...READY, pane: 'build', contentUpdates: false }).has('review-content-updates'));
  assert.ok(!enabledIn({ ...READY, pane: 'build', contentBusy: true }).has('review-content-updates'));
  assert.ok(!enabledIn({ ...READY, pane: 'build', modal: true }).has('review-content-updates'));
  const file = MENUS.find((menu) => menu.label === 'File')!;
  assert.equal(file.items.indexOf('review-content-updates'), file.items.indexOf('reload-sources') + 1);
});

// --- about ---------------------------------------------------------------------------------------------------

test('About Incudo is the Help menu, live on every pane and on none behind a dialog, with no shortcut and no tab', () => {
  // Fails if it is gated on a pane, reacts behind a dialog, takes a key, or becomes a destination (a header tab).
  for (const pane of ['library', 'build', 'sheet', 'sources', 'browse', 'settings'] as Destination[]) {
    assert.ok(enabledIn({ ...READY, pane }).has('about'), pane);
  }
  assert.ok(!enabledIn({ ...READY, modal: true }).has('about'));
  assert.deepEqual(MENUS.at(-1), { label: 'Help', items: ['about'] });
  const command = COMMANDS.find((candidate) => candidate.id === 'about')!;
  assert.equal(command.label, 'About Incudo');
  assert.equal(command.shortcut, undefined);
  assert.equal(command.destination, undefined);
});

test('Switch Build tab is live on Build only, and its chord is claimed everywhere — ADR 0115', () => {
  // Fails if the command is enabled where its tabs are not on screen, or if its chord falls through to the browser.
  for (const pane of ['library', 'build', 'sheet', 'sources', 'browse', 'settings'] as const) {
    assert.equal(isEnabled(resolveCommands({ ...READY, pane }), 'switch-build-tab'), pane === 'build', pane);
    const outcome = keyOutcome(key('H', { ctrlKey: true, shiftKey: true }), 'other', resolveCommands({ ...READY, pane }));
    assert.equal(outcome?.id, 'switch-build-tab', pane);
  }
});

test('before a character is started, nothing acts on the blank one behind Build and the Sheet — ADR 0120', () => {
  // Fails if a command stops reading `started`: Ctrl+S on Build's "No character yet" would save a blank character.
  const acting: CommandId[] = [
    'switch-build-tab',
    'save-character',
    'save-copy',
    'export-sheet',
    'print-sheet',
    'export-sheet-pdf',
    'fill-official-sheet',
    'review-content-updates',
  ];
  for (const pane of ['build', 'sheet'] as Destination[]) {
    const on = enabledIn({ ...READY, pane, started: false });
    for (const id of acting) assert.ok(!on.has(id), `${id} on ${pane}`);
    assert.ok(on.has('new-character'), 'starting one is what is offered there');
  }
  // Each of them is live somewhere once one is started, so each case above failed on `started`.
  const somewhere = new Set([...enabledIn({ ...READY, pane: 'build' }), ...enabledIn({ ...READY, pane: 'sheet' })]);
  for (const id of acting) assert.ok(somewhere.has(id), id);
});
