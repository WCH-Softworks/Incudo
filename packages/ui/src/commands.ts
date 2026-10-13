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
 *  - **A command is enabled where its outcome can be seen.** New character, Import, Save and
 *    Save a copy are live on the screen that shows what they did, and greyed elsewhere. That is a deliberate
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

/** Where a shell can be looking. The desktop shell's six panes; a phone would have its own. */
export type Destination = 'library' | 'build' | 'sheet' | 'sources' | 'browse' | 'settings';

export const COMMAND_IDS = [
  'go-library',
  'go-build',
  'go-sheet',
  'go-sources',
  'go-browse',
  'go-settings',
  'switch-build-tab',
  'new-character',
  'save-character',
  'save-copy',
  'export-sheet',
  'print-sheet',
  'export-sheet-pdf',
  'fill-official-sheet',
  'import-aurora',
  'choose-library-folder',
  'refresh-library',
  'reload-sources',
  'review-content-updates',
  'change-system',
  'about',
] as const;

export type CommandId = (typeof COMMAND_IDS)[number];

/** Only what a shortcut label differs on. */
export type Os = 'mac' | 'other';

/**
 * A key chord, described rather than spelled.
 *
 * `primary` is Ctrl on Windows and Linux and Cmd on macOS — the one modifier every desktop
 * convention agrees on and no two platforms spell the same. Labels are derived
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
  // Beside Sources, since it shows what they hold (ADR 0053).
  { id: 'go-browse', label: 'Browse', shortcut: { key: '5', primary: true }, destination: 'browse' },
  // The comma is the macOS Preferences convention and reads as "settings" on the other two.
  { id: 'go-settings', label: 'Settings', shortcut: { key: ',', primary: true }, destination: 'settings' },
  // Build's two tabs, what the character is built from and what stays open while it is played (ADR 0115). One command
  // that moves to the other, so two tabs cost one chord; Shift+H is one of those seen to reach the page in the window.
  { id: 'switch-build-tab', label: 'Switch Build tab', shortcut: { key: 'h', primary: true, shift: true } },
  { id: 'new-character', label: 'New character', shortcut: { key: 'n', primary: true } },
  { id: 'save-character', label: 'Save to library', shortcut: { key: 's', primary: true } },
  // Ctrl+Shift+D, for "duplicate". Not Ctrl+Shift+S, the Save As chord, which was the first choice:
  // pressed in the Windows window it never reaches the page (the key-down is taken by WebView2, the
  // key-up arrives), and it is not Save As here anyway, since a copy leaves the file being edited
  // where it is (ADR 0038). Measured by pressing real keys: S, E, U, M, G and X are taken before the
  // page sees them; K, O, D, H, B, Y and L arrive. `commands.test.ts` keeps the taken ones out.
  { id: 'save-copy', label: 'Save a copy…', shortcut: { key: 'd', primary: true, shift: true } },
  // The sheet on screen as text (ADR 0075). Ctrl+Shift+O, "out": one of the chords pressed with real keys in the Windows
  // window and seen to reach the page (Save a copy's list above); no free one spells "text".
  { id: 'export-sheet', label: 'Export sheet as text…', shortcut: { key: 'o', primary: true, shift: true } },
  // The sheet on paper (ADR 0077): a step of the app's own choosing what prints, then the platform's own print dialog
  // (ADR 0078). Ctrl+P is every platform's print chord, and claimed on every pane it stops the platform printing
  // whichever pane is showing; while the step is open it is claimed and runs nothing, as for any dialog.
  { id: 'print-sheet', label: 'Print sheet…', shortcut: { key: 'p', primary: true } },
  // The print written to a file with no dialog (ADR 0079): the same options step, with a paper. Below Print, since it is
  // the print. No shortcut, for the text export's reason. Only where the shell can write a PDF (`pdfAvailable`); where it
  // cannot, the menu leaves it out (`menuModel`'s `absent`) and "Print sheet…" and its dialog are the PDF.
  { id: 'export-sheet-pdf', label: 'Export sheet as PDF…' },
  // The user's own copy of a published form, filled from the sheet (ADR 0079 decision 3). No shortcut, as the exports.
  { id: 'fill-official-sheet', label: 'Fill the official sheet…' },
  // No shortcut: Ctrl+I is italic in every text field and Ctrl+Shift+I is developer tools.
  { id: 'import-aurora', label: 'Import from Aurora…' },
  { id: 'choose-library-folder', label: 'Choose library folder…' },
  // Ctrl+R and F5 are the browser's page reload, and a developer using the browser build
  // needs both. Ctrl+Shift+R is a hard reload, so L for library.
  { id: 'refresh-library', label: 'Refresh library', shortcut: { key: 'l', primary: true, shift: true } },
  { id: 'reload-sources', label: 'Reload content sources' },
  // What a refresh of the open character would change, then the refresh itself (ADR 0082). No shortcut.
  { id: 'review-content-updates', label: 'Review content updates…' },
  { id: 'change-system', label: 'Change system' },
  // The About section of Settings (about.ts). Not a destination: that would make it a tab of the header's own. No
  // shortcut, since nothing about it is done often.
  { id: 'about', label: 'About Incudo' },
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
      'save-copy',
      'export-sheet',
      'print-sheet',
      'export-sheet-pdf',
      'fill-official-sheet',
      null,
      'import-aurora',
      null,
      'choose-library-folder',
      'refresh-library',
      'reload-sources',
      'review-content-updates',
      null,
      'change-system',
    ],
  },
  { label: 'View', items: ['go-library', 'go-build', 'switch-build-tab', 'go-sheet', 'go-sources', 'go-browse', 'go-settings'] },
  { label: 'Help', items: ['about'] },
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
  /** The platform can show a save dialog. Independent of the library: a copy needs no folder. */
  saverAvailable: boolean;
  /** A copy is being written. */
  copying: boolean;
  /** A sheet is being exported. */
  exporting: boolean;
  /** The shell can write the page as a PDF with no print dialog (ADR 0079). */
  pdfAvailable: boolean;
  /** The character's system ships a form for its kind (ADR 0079): the 5e player character's 2014 sheet. */
  formAvailable: boolean;
  /** The open character's copies differ from what its sources load now (ADR 0082). */
  contentUpdates: boolean;
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
  saverAvailable: false,
  copying: false,
  exporting: false,
  pdfAvailable: false,
  formAvailable: false,
  contentUpdates: false,
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
  // Always, like the other panes: with nothing loaded it says so and points at Sources.
  'go-browse': () => true,
  'go-settings': () => true,
  // On Build, where the tabs are and where the switch is seen.
  'switch-build-tab': (c) => c.pane === 'build',
  // The button lives on the library screen, only when there is a library to put one in.
  'new-character': (c) => c.pane === 'library' && libraryListed(c),
  // The pane bar's button, and the only place its outcome ("Saved to …") is printed.
  'save-character': (c) => c.pane === 'build' && c.library === 'ready' && !c.saving && !c.copying,
  // Beside Save, and for the same reason: "Saved a copy as …" is printed there. It needs no
  // library at all — the file goes wherever the user says — so it is live with none chosen.
  'save-copy': (c) => c.pane === 'build' && c.saverAvailable && !c.saving && !c.copying,
  // On the Sheet, whose bar prints "Exported the sheet as …": what is exported is what is on screen there. Like a copy it
  // needs no library, and no content either (ADR 0075).
  'export-sheet': (c) => c.pane === 'sheet' && c.saverAvailable && !c.exporting,
  // On the Sheet, which is what prints (ADR 0077). The options step is the app's and the dialog the platform's, so it
  // needs no library, no content and no save dialog; it prints what is on screen, not a file.
  'print-sheet': (c) => c.pane === 'sheet',
  // The print as a file (ADR 0079): on the Sheet, whose bar prints "Exported the sheet as …", where the shell can write a
  // PDF and show a save dialog, and not while an export is in flight.
  'export-sheet-pdf': (c) => c.pane === 'sheet' && c.pdfAvailable && c.saverAvailable && !c.exporting,
  // On the Sheet, whose bar prints what was filled and left off, for a character whose kind has a form, where a filled
  // copy can be saved; not while an export is in flight. Choosing the copy is inside the step, which says when it cannot.
  'fill-official-sheet': (c) => c.pane === 'sheet' && c.formAvailable && c.saverAvailable && !c.exporting,
  // Its report is printed on the library screen, so that is where it can be started.
  'import-aurora': (c) => c.pane === 'library' && !c.importing && importBlock(c) === undefined,
  // Settings holds this one, but the first-run dialog and the library screen do too.
  'choose-library-folder': (c) => c.library !== 'unavailable',
  'refresh-library': (c) => c.library === 'ready' && !c.libraryBusy,
  'reload-sources': (c) => c.hasEnabledSource && !c.contentBusy,
  // Where the line offering it is shown, Build and the Sheet, and only while there is something to refresh (ADR 0082).
  'review-content-updates': (c) => (c.pane === 'build' || c.pane === 'sheet') && c.contentUpdates && !c.contentBusy,
  'change-system': () => true,
  'about': () => true,
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
 * Modifiers are compared for **equality**, not inclusion: Ctrl+Shift+L is not Ctrl+L, and Ctrl+Alt
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

// --- labels and the native menu --------------------------------------------------------------

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

export type MenuEntry =
  | { kind: 'separator' }
  /** `shortcut` is text to print beside the item (`Ctrl+N`, `⌘N`), never a key binding. */
  | { kind: 'command'; id: CommandId; label: string; shortcut?: string };

export interface MenuModel {
  label: string;
  entries: MenuEntry[];
}

/**
 * The native menu, ready to be turned into widgets one for one.
 *
 * Built here so that what the window's menu contains is testable without a window: the desktop
 * shell's only job is to map each entry to a menu widget and call `run(id)` when one is clicked.
 *
 * **An entry carries a shortcut to *show*, and no accelerator to *register*.** The first version
 * registered one, and in the Tauri window on Windows it never ran: WebView2 gives the page the
 * key and the host's accelerator table never sees it, so Ctrl+2 reached the page, matched nothing
 * there and did nothing. See ADR 0037.
 *
 * `absent` names commands this shell does not have at all, which are left out rather than greyed: "Export sheet as PDF…"
 * where no PDF writer exists (ADR 0079 decision 2). A separator left with nothing on one side goes too.
 */
export function menuModel(os: Os, absent: readonly CommandId[] = []): MenuModel[] {
  return MENUS.map((menu) => ({
    label: menu.label,
    entries: tidySeparators(menu.items.filter((item) => item === null || !absent.includes(item))).map((item): MenuEntry => {
      if (item === null) return { kind: 'separator' };
      const command = COMMANDS.find((candidate) => candidate.id === item)!;
      return {
        kind: 'command',
        id: command.id,
        label: command.label,
        shortcut: command.shortcut ? formatShortcut(command.shortcut, os) : undefined,
      };
    }),
  }));
}

/** Separators with a command on both sides: none leading, trailing or doubled. */
function tidySeparators(items: ReadonlyArray<CommandId | null>): Array<CommandId | null> {
  const out: Array<CommandId | null> = [];
  for (const item of items) {
    if (item === null && (out.length === 0 || out[out.length - 1] === null)) continue;
    out.push(item);
  }
  if (out[out.length - 1] === null) out.pop();
  return out;
}

/** The commands a shell does not have: what `menuModel` leaves out. */
export function absentCommands(capabilities: { pdfAvailable: boolean }): CommandId[] {
  return capabilities.pdfAvailable ? [] : ['export-sheet-pdf'];
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
 * A shell's way to show a menu, if it has one.
 *
 * `install` resolves to `null` when there is no native menu — a browser tab, a phone — or when
 * building it failed. **A menu is for the mouse and nothing else: the page listens for the
 * keyboard in every shell, a menu registers no key binding, and so a shortcut has one path in.**
 * Both paths were the first design; the key reaches the page whether or not a menu also claims
 * it, which is what made registering one pointless and, on a platform that did deliver it twice,
 * a command that would run twice. See ADR 0037.
 */
export interface CommandHost {
  readonly os: Os;
  install(run: (id: CommandId) => void): Promise<InstalledMenu | null>;
}
