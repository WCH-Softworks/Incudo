/**
 * What the app can be told to do, as data — ADR 0037.
 *
 * A menu item, a keyboard shortcut and a toolbar button are three ways to say the same
 * sentence, so the sentence is written down once, here, and every shell renders it: the desktop
 * window's native menu, the browser build's keyboard handler, and whatever the mobile shell
 * makes of it. Nothing in this file touches a window, a key event object or a menu widget; a
 * shell hands it plain facts and gets plain answers back, which is what lets all of it run under
 * `node --test` (CODE-REUSE-POLICY rule 2: if "Save is greyed out when it should not be" is a
 * bug, it is fixable here).
 *
 * Three decisions that are easy to undo by accident:
 *
 *  - **A command is enabled where its outcome can be seen.** New character, Import and Save are
 *    live on the screen that shows what they did, and greyed elsewhere. That is a deliberate
 *    narrowing, not an oversight: "New character" replaces the character being edited without
 *    asking (the draft is autosaved, the file is not), so a shortcut must not make that easier
 *    to do by accident than the button it stands for.
 *  - **A disabled command still claims its shortcut.** In a browser, Ctrl+S that the app
 *    declines to handle becomes "save this web page", which is worse than nothing happening.
 *    See `keyOutcome`.
 *  - **Every shortcut carries the primary modifier.** A bare printable key would fire while
 *    someone types a character name, and Ctrl+A/C/V/X/Z/Y are editing and are never claimed.
 *    The chords are not restricted from text fields: Ctrl+S while a name field has focus is
 *    exactly when a person wants to save.
 *
 * No game in here. "Sheet" is where a character is shown, whatever the game.
 */

import type { LibraryState } from './character-library.ts';

/** Where a shell can be looking. The desktop shell's five panes; a phone would have its own. */
export type Destination = 'library' | 'build' | 'sheet' | 'sources' | 'settings';

export const COMMAND_IDS = [
  'go-library',
  'go-build',
  'go-sheet',
  'go-sources',
  'go-settings',
  'new-character',
  'save-character',
  'import-aurora',
  'choose-library-folder',
  'refresh-library',
  'reload-sources',
  'change-system',
] as const;

export type CommandId = (typeof COMMAND_IDS)[number];

/** Only what a shortcut label and an accelerator differ on. */
export type Os = 'mac' | 'other';

/**
 * A key chord, described rather than spelled.
 *
 * `primary` is Ctrl on Windows and Linux and Cmd on macOS — the one modifier every desktop
 * convention agrees on and no two platforms spell the same. Labels and accelerators are derived
 * from this, so there is no string per shell to fall out of step.
 */
export interface Shortcut {
  /** `KeyboardEvent.key`, compared case-insensitively: `'n'`, `','`, `'1'`. */
  key: string;
  primary: boolean;
  shift?: boolean;
  alt?: boolean;
}

export interface CommandDef {
  id: CommandId;
  /** Plain text. Ends in an ellipsis when the command asks for something before it acts. */
  label: string;
  shortcut?: Shortcut;
  /** Set on the commands that only move the view; the shell moves it. */
  destination?: Destination;
}

/**
 * The commands, in the order a menu lists them within their group.
 *
 * Function keys are not used, and neither is Alt with a letter. F5 reloads a browser page and
 * WebView2 has its own opinions about it; Ctrl+Alt is how Windows reports AltGr, which on a
 * Brazilian or Portuguese layout is how you type half the punctuation. Both are tests below.
 */
export const COMMANDS: readonly CommandDef[] = [
  { id: 'go-library', label: 'Characters', shortcut: { key: '1', primary: true }, destination: 'library' },
  { id: 'go-build', label: 'Build', shortcut: { key: '2', primary: true }, destination: 'build' },
  { id: 'go-sheet', label: 'Sheet', shortcut: { key: '3', primary: true }, destination: 'sheet' },
  { id: 'go-sources', label: 'Sources', shortcut: { key: '4', primary: true }, destination: 'sources' },
  // The comma is the macOS Preferences convention and reads as "settings" on the other two.
  { id: 'go-settings', label: 'Settings', shortcut: { key: ',', primary: true }, destination: 'settings' },
  { id: 'new-character', label: 'New character', shortcut: { key: 'n', primary: true } },
  { id: 'save-character', label: 'Save to library', shortcut: { key: 's', primary: true } },
  // No shortcut: Ctrl+I is italic in every text field and Ctrl+Shift+I is developer tools.
  { id: 'import-aurora', label: 'Import from Aurora…' },
  { id: 'choose-library-folder', label: 'Choose library folder…' },
  // Ctrl+R and F5 are the browser's page reload, and a developer using the browser build
  // needs both. Ctrl+Shift+R is a hard reload, so L for library.
  { id: 'refresh-library', label: 'Refresh library', shortcut: { key: 'l', primary: true, shift: true } },
  { id: 'reload-sources', label: 'Reload content sources' },
  { id: 'change-system', label: 'Change system' },
];

/** `null` is a separator. */
export type MenuLayout = ReadonlyArray<{ label: string; items: ReadonlyArray<CommandId | null> }>;

/**
 * Which command sits in which menu. Every command appears exactly once, which a test holds:
 * a command with a shortcut and no menu item works in the browser build and is invisible in the
 * window, which is the two shells drifting apart.
 */
export const MENUS: MenuLayout = [
  {
    label: 'File',
    items: [
      'new-character',
      'save-character',
      null,
      'import-aurora',
      null,
      'choose-library-folder',
      'refresh-library',
      'reload-sources',
      null,
      'change-system',
    ],
  },
  { label: 'View', items: ['go-library', 'go-build', 'go-sheet', 'go-sources', 'go-settings'] },
];

// --- what is possible right now -------------------------------------------------------------

/**
 * The facts a command's availability depends on. Plain values, so a shell that has them in three
 * different places can still hand over one object — and so a test can construct any situation.
 */
export interface CommandContext {
  /** A system is chosen and its workspace is on screen. False on the launcher. */
  workspace: boolean;
  pane: Destination;
  /** A dialog has the focus. Nothing behind it should react to a menu or a shortcut. */
  modal: boolean;
  library: LibraryState['status'];
  libraryBusy: boolean;
  /** Content sources are being fetched. */
  contentBusy: boolean;
  /** At least one source for this system is switched on. */
  hasEnabledSource: boolean;
  /** Content is loaded and holds something — an import resolves ids against it. */
  contentLoaded: boolean;
  /** The platform can show a file dialog. */
  pickerAvailable: boolean;
  importing: boolean;
  saving: boolean;
}

/** The launcher, or the moment before anything has loaded: every command is unavailable. */
export const NO_WORKSPACE: CommandContext = {
  workspace: false,
  pane: 'library',
  modal: false,
  library: 'no-location',
  libraryBusy: false,
  contentBusy: false,
  hasEnabledSource: false,
  contentLoaded: false,
  pickerAvailable: false,
  importing: false,
  saving: false,
};

/**
 * Why importing cannot start, as a code the shell turns into a sentence — or `undefined`.
 *
 * Kept apart from `enabled` because a greyed-out button that does not say why is the worst of
 * both, and the sentence belongs to the pane that can show it. `importing` is not here: a
 * running import is busy, not blocked, and has nothing to explain.
 */
export function importBlock(
  context: Pick<CommandContext, 'pickerAvailable' | 'library' | 'contentLoaded'>,
): 'no-picker' | 'no-library' | 'no-content' | undefined {
  if (!context.pickerAvailable) return 'no-picker';
  if (context.library !== 'ready') return 'no-library';
  if (!context.contentLoaded) return 'no-content';
  return undefined;
}

/** A library screen with its list on it: `scanning` shows the same buttons `ready` does. */
function libraryListed(context: CommandContext): boolean {
  return context.library === 'ready' || context.library === 'scanning';
}

/**
 * One predicate per command, and a `Record` rather than a switch so that adding a command
 * without deciding when it is available is a compile error instead of a menu item that is
 * always on.
 */
const ENABLED: Record<CommandId, (context: CommandContext) => boolean> = {
  'go-library': () => true,
  'go-build': () => true,
  'go-sheet': () => true,
  'go-sources': () => true,
  'go-settings': () => true,
  // The button lives on the library screen, only when there is a library to put one in.
  'new-character': (c) => c.pane === 'library' && libraryListed(c),
  // The pane bar's button, and the only place its outcome ("Saved to …") is printed.
  'save-character': (c) => c.pane === 'build' && c.library === 'ready' && !c.saving,
  // Its report is printed on the library screen, so that is where it can be started.
  'import-aurora': (c) => c.pane === 'library' && !c.importing && importBlock(c) === undefined,
  // Settings holds this one, but the first-run dialog and the library screen do too.
  'choose-library-folder': (c) => c.library !== 'unavailable',
  'refresh-library': (c) => c.library === 'ready' && !c.libraryBusy,
  'reload-sources': (c) => c.hasEnabledSource && !c.contentBusy,
  'change-system': () => true,
};

export interface ResolvedCommand extends CommandDef {
  enabled: boolean;
}

/** Every command, with whether it can run right now. Order is `COMMANDS`'. */
export function resolveCommands(context: CommandContext): ResolvedCommand[] {
  const open = context.workspace && !context.modal;
  return COMMANDS.map((command) => ({ ...command, enabled: open && ENABLED[command.id](context) }));
}

export function isEnabled(resolved: readonly ResolvedCommand[], id: CommandId): boolean {
  return resolved.find((command) => command.id === id)?.enabled === true;
}

// --- keys -----------------------------------------------------------------------------------

/** The part of a `KeyboardEvent` this file reads, so a test needs no DOM. */
export interface KeyLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  repeat?: boolean;
  isComposing?: boolean;
}

/**
 * Which command a key event is, ignoring whether it may run.
 *
 * Modifiers are compared for **equality**, not inclusion: Ctrl+Shift+S is not Ctrl+S, and Ctrl+Alt
 * +anything is never a shortcut because that is how Windows reports AltGr. On macOS Ctrl is not
 * the primary modifier and is ignored as one; on the others Cmd/Windows is not either.
 */
export function matchShortcut(event: KeyLike, os: Os): CommandId | undefined {
  const primary = os === 'mac' ? event.metaKey : event.ctrlKey;
  const strayPrimary = os === 'mac' ? event.ctrlKey : event.metaKey;
  if (strayPrimary) return undefined;
  const key = event.key.toLowerCase();
  for (const command of COMMANDS) {
    const shortcut = command.shortcut;
    if (!shortcut) continue;
    if (shortcut.key.toLowerCase() !== key) continue;
    if (shortcut.primary !== primary) continue;
    if ((shortcut.shift ?? false) !== event.shiftKey) continue;
    if ((shortcut.alt ?? false) !== event.altKey) continue;
    return command.id;
  }
  return undefined;
}

export interface KeyOutcome {
  id: CommandId;
  /** The keystroke is the app's: stop the browser doing whatever it would have done. */
  claimed: true;
  /** Run the command. False for a repeat, and for a command that is not available. */
  run: boolean;
}

/**
 * What to do with a key event, or `undefined` to leave it entirely alone.
 *
 * A match is **claimed even when the command is unavailable**: Ctrl+S on the Sheet pane must not
 * open the browser's "save page" dialog. A held key claims and does not run — Ctrl+N held down
 * would otherwise be thirty new characters. An event during IME composition is not a shortcut
 * at all: composition uses keys the app has no business reading.
 */
export function keyOutcome(
  event: KeyLike,
  os: Os,
  resolved: readonly ResolvedCommand[],
): KeyOutcome | undefined {
  if (event.isComposing) return undefined;
  const id = matchShortcut(event, os);
  if (!id) return undefined;
  return { id, claimed: true, run: !event.repeat && isEnabled(resolved, id) };
}

// --- labels and native accelerators ----------------------------------------------------------

/**
 * A shortcut as a person reads it: `Ctrl+Shift+L` on Windows and Linux, `⇧⌘L` on macOS.
 *
 * This comes from the `Shortcut` above and not from a string per shell, which is why a
 * platform-correct label needs no second list to keep in step.
 */
export function formatShortcut(shortcut: Shortcut, os: Os): string {
  const key = shortcut.key.length === 1 ? shortcut.key.toUpperCase() : shortcut.key;
  if (os === 'mac') {
    // The order macOS documents: Control, Option, Shift, Command.
    return `${shortcut.alt ? '⌥' : ''}${shortcut.shift ? '⇧' : ''}${shortcut.primary ? '⌘' : ''}${key}`;
  }
  return [shortcut.primary ? 'Ctrl' : '', shortcut.alt ? 'Alt' : '', shortcut.shift ? 'Shift' : '', key]
    .filter(Boolean)
    .join('+');
}

/** `Build (Ctrl+2)` — for a tooltip. Just the label when the command has no shortcut. */
export function describeCommand(id: CommandId, os: Os): string {
  const command = COMMANDS.find((candidate) => candidate.id === id)!;
  return command.shortcut ? `${command.label} (${formatShortcut(command.shortcut, os)})` : command.label;
}

/**
 * The notation a native menu takes — `CmdOrCtrl+Shift+L` — which Tauri's menu library and
 * Electron's both read. It is data about a shortcut and is here for that reason only: this file
 * still imports nothing from either.
 */
export function acceleratorOf(shortcut: Shortcut): string {
  return [
    shortcut.primary ? 'CmdOrCtrl' : '',
    shortcut.alt ? 'Alt' : '',
    shortcut.shift ? 'Shift' : '',
    shortcut.key.length === 1 ? shortcut.key.toUpperCase() : shortcut.key,
  ]
    .filter(Boolean)
    .join('+');
}

export type MenuEntry =
  | { kind: 'separator' }
  | { kind: 'command'; id: CommandId; label: string; accelerator?: string };

export interface MenuModel {
  label: string;
  entries: MenuEntry[];
}

/**
 * The native menu, ready to be turned into widgets one for one.
 *
 * Built here so that what the window's menu contains is testable without a window: the desktop
 * shell's only job is to map each entry to a menu widget and call `run(id)` when one fires.
 */
export function menuModel(): MenuModel[] {
  return MENUS.map((menu) => ({
    label: menu.label,
    entries: menu.items.map((item): MenuEntry => {
      if (item === null) return { kind: 'separator' };
      const command = COMMANDS.find((candidate) => candidate.id === item)!;
      return {
        kind: 'command',
        id: command.id,
        label: command.label,
        accelerator: command.shortcut ? acceleratorOf(command.shortcut) : undefined,
      };
    }),
  }));
}

// --- the port -------------------------------------------------------------------------------

/** What an installed native menu can be told afterwards. */
export interface InstalledMenu {
  /**
   * Bring the menu's enabled flags in line with `resolved`. Called on every change, so an
   * implementation sends only the differences.
   */
  sync(resolved: readonly ResolvedCommand[]): void;
}

/**
 * A shell's way to show the menu, if it has one.
 *
 * `install` resolves to `null` when there is no native menu — a browser tab, a phone — or when
 * building it failed. That answer is also the answer to "who handles the keyboard?": **a shell
 * that installed a menu owns its shortcuts through the menu's accelerators, and a shell that did
 * not handles them from key events. Never both**, because the two paths would each run the
 * command once per keystroke and a native accelerator does not promise to swallow the key
 * event before the page sees it. See ADR 0037.
 */
export interface CommandHost {
  readonly os: Os;
  install(run: (id: CommandId) => void): Promise<InstalledMenu | null>;
}
