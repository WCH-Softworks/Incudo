# 0037 — A command is data in `packages/ui`, the page owns the keyboard, and the menu is for the mouse

**Status:** Accepted · 2026-09-19 · builds on [0001](./0001-tech-stack.md) and the layering in
[`CODE-REUSE-POLICY.md`](../CODE-REUSE-POLICY.md)

> **Amended the same day, after pressing the keys.** Decision 3 first said the opposite: that a
> native menu should own the shortcuts through its accelerators, with the page listener attached
> only where there was no menu. Real keystrokes in the Tauri window on Windows showed the menu
> never ran them. The decision below is the corrected one, and the wrong one is kept under
> "Alternatives considered" with what disproved it.

## Context

The desktop app had no menu and one real key handler (Escape, dismissing a candidate picker). The
roadmap's last unchecked desktop-shell box is "everything that makes it feel like a desktop
application rather than a page", and two constraints made "add a menu" more than a component:

- The **mobile shell inherits whatever list of commands is written now**, and its ids will end up
  in deep links, share targets and shortcuts. A list that lives in `apps/desktop` is a list the
  second shell copies and lets drift.
- A native menu and a keyboard listener are two ways to run the same command. If each has its own
  idea of what exists and when it is available, the window and the browser build disagree, and
  nobody notices because each is right about itself.

## Decision

### 1. A command is an id, a label, an optional shortcut, and a rule — in `packages/ui/src/commands.ts`

```ts
COMMANDS: { id, label, shortcut?: { key, primary, shift?, alt? }, destination? }[]
MENUS:    { label, items: (CommandId | null)[] }[]          // null is a separator
resolveCommands(context) -> (command & { enabled })[]      // the availability rules
keyOutcome(event, os, resolved) -> { id, claimed, run } | undefined
menuModel() -> what a native menu holds, entry by entry
```

The file imports nothing from a window, a `KeyboardEvent`, `react-dom` or any game. A shell hands
it plain facts (`CommandContext`) and gets plain answers back, so all of it runs under
`node --test`. **`CommandId`, the `Shortcut` shape and the fields of `CommandContext` are the
public surface**; renaming an id later means renaming it in every shell.

Availability is a `Record<CommandId, (context) => boolean>` and not a `switch`, so a command added
without deciding when it is available is a compile error rather than a menu item that is always on.

A shortcut is *described*, not spelled: `primary` is Ctrl on Windows and Linux and Cmd on macOS.
Labels (`Ctrl+Shift+L`, `⇧⌘L`) and the native accelerator (`CmdOrCtrl+Shift+L`) are derived from
that one description, which is what "platform-correct labels come from data" means here. There is
no string per shell to fall out of step.

### 2. A command is enabled where its outcome can be seen

New character, Import from Aurora and Save are live on the screen that shows what they did and
greyed elsewhere. This is narrower than a desktop app usually is, deliberately:

- **New character replaces the character being edited without asking.** The draft is autosaved,
  the file is not. A shortcut must not make that easier to do by accident than the button it
  stands for, and Build — where you are mid-edit — is exactly where the button is absent.
- Save's confirmation ("Saved to nyx.incu.") and Import's report are printed on Build and on the
  library screen respectively. A save that succeeded on the Sheet pane with nothing on screen is
  worse than a menu item that is greyed.

Nothing is enabled while a dialog is open. The rename prompt and the first-run folder question are
`<dialog>`s that make the page behind them inert to the mouse and not to a keystroke.

A guard for unsaved work would let New character be enabled everywhere. That needs a dirty flag the
app does not have, so it is left as the follow-up it is rather than approximated.

### 3. The page owns the keyboard in every shell, and a menu is for the mouse

**A `keydown` listener in the page is the only way a shortcut runs, in the browser build and the
Tauri window alike. A native menu registers no accelerator; it shows each shortcut as label text
and runs a command when clicked.** The port is

```ts
interface CommandHost { os; install(run): Promise<InstalledMenu | null> }
```

and `null` — no native menu, or building it failed — costs the menu and never the shortcuts.

This is the second design. The first gave the keys to the menu's accelerators and attached the
listener only where there was no menu, on the argument that both together might run a command
twice. **Pressing the keys in the Windows window disproved the premise, not just the design:** with
the menu's accelerators registered, the page received Ctrl+2 and Ctrl+3 as ordinary `keydown`
events, the menu item never ran, and with the listener detached nothing happened at all. WebView2
handles key input in its own process and hands the host only what the page declined, so the host's
accelerator table (which Tauri does feed to `TranslateAcceleratorW`) is never consulted while the
webview has focus. One path in also removes the double-run question wherever it does get delivered
twice: there is no second registration to run.

A shortcut is shown in a menu as text after a tab, which a Windows menu right-aligns as it would an
accelerator. macOS and Linux menus were not seen and may render that text differently.

### 4. A disabled command still claims its key

`keyOutcome` reports `claimed: true` for any match, `run: false` when the command is not available
or the key is held. In a browser, Ctrl+S that the app declines to handle is "save this web page",
which is worse than nothing happening. A held key claims and does not run: Ctrl+N held down would
otherwise be thirty characters.

### 5. Shortcuts leave text alone, by construction

- Every shortcut carries the primary modifier. A bare printable key would fire while someone types a
  name. Ctrl+A/C/V/X/Z/Y are editing and are never claimed.
- Chords are **not** withheld from text fields. Ctrl+S while a name field has focus is exactly when a
  person wants to save, and Ctrl+1 is not an editing key in any field the app has.
- Modifiers compare for equality. **Ctrl+Alt is how Windows reports AltGr**, which on a Brazilian
  or Portuguese layout types half the punctuation, so no shortcut uses Alt and no Ctrl+Alt event
  can match one. Function keys are not used either: F5 is a browser reload and WebView2 has its own
  opinions about it, and Ctrl+R is a developer's reload in the browser build, so Refresh is
  Ctrl+Shift+L.
- Events during IME composition are not shortcuts.

### 6. The native menu is built from JavaScript, from `menuModel()`

`TauriCommandHost` in `platform.ts` maps each entry to a menu widget with `@tauri-apps/api/menu`
and calls `run(id)` when one is clicked. No Rust, and no capability change: `core:default` already
carries the menu permissions. The alternative, a menu written in Rust, is a second copy of the list
and the project's second piece of application-shaped Rust in a file ADR 0001 wants to stay small.

- **`enabled` stays in step** by `Shell` handing over a freshly resolved list on every render and
  the host sending only the flags that changed. The bridge is asynchronous, so the hook's `run`
  re-checks the *latest* list before calling a handler: an item clicked in the gap between a
  state change and its sync finds the command already disabled.
- **Windows and Linux get no Edit menu.** muda draws Copy, Paste and Select All there and
  implements none of them, so they would be entries that do nothing. **macOS gets an
  application menu and an Edit menu**, because replacing Tauri's default menu there removes Quit and
  makes Cmd+C/V/A stop working in every text field.

## Consequences

- The window's menu and the browser build's shortcuts are one list, and a test holds it: every
  command is in exactly one menu, every shortcut has a menu item, the id a menu item fires is
  the id its shortcut fires, and the menu model carries a shortcut to print and nothing that could
  be registered as a key binding.
- The browser build has **no menu**. It has the shortcuts, and the nav and Save buttons carry them
  as tooltips (`Build (Ctrl+2)`). An in-page menu bar was not built: it would duplicate the header
  and nobody asked what it would hold that the header does not. `Import`, `Choose library folder`,
  `Reload content sources` and `Change system` have no shortcut and are therefore reachable in the
  browser build only through the buttons they already had.
- **Chromium reserves Ctrl+N (and Ctrl+T/W) in a real tab**: the page never sees it. New character's
  shortcut therefore works in the window and not in a browser tab. Whether Ctrl+1–4 reach a page
  there was not established — injected key events never pass through the browser's own shortcut
  layer, so the test that could show it cannot.
- `importBlock` moved the rule for "why importing cannot start" into the package, so the button and
  the menu item cannot disagree; the sentences stayed in the pane that shows them.
- **Not seen, and the desktop README says so:** the macOS application and Edit menus, which were
  written against muda's documented behaviour and have never run; how a macOS or GTK menu renders
  tab-separated shortcut text; and whether WebView2 on macOS-less platforms behaves the same way
  (only Windows was tried).
- **Found only by running it.** The first design passed every test and every check that needed no
  keyboard — the menu existed, its flags followed state, its items drove the app — and did nothing
  when a key was pressed. No test could have shown it: what failed is what a platform does with a
  keystroke.

## Evidence

Thirty-one tests in `commands.test.ts`. Each was checked by breaking the behaviour it names — 34
perturbations of `commands.ts`, none survived:

| perturbation | caught by |
|---|---|
| workspace gate removed / modal gate removed | launcher and modal tests, separately |
| Save live on every pane; in-flight save ignored | pane test; "a save in flight" |
| New character live on every pane, or with no library | "mid-edit" test; "no library chosen" |
| Import live on every pane; a running import ignored; reasons reordered | "mid-edit"; "importing" |
| Choose-folder live where the platform has no folder access; Refresh live while busy; Reload with no source | one test each |
| a disabled command releases its key (browser would save the page) | "unavailable still claims its key" |
| a held key repeats; `run` ignores `enabled`; IME composition read | held-key, unavailable, composing tests |
| Alt not compared (AltGr matches); Shift not compared; Ctrl+Cmd accepted; primary not required; case-sensitive keys | AltGr, modifier, primary-modifier and bare-key tests |
| Save moved to Ctrl+A; Save loses its modifier; Refresh collides with New; Refresh on F5 | "leaves text editing alone"; "no two share" |
| a command dropped from, or listed twice in, the menus; a menu ends on a separator | placement and separator tests |
| the menu shortcut text drops its Shift or is spelled for the wrong platform; the model grows an accelerator field; an ADR number in a label | model, "binds none" and plain-text tests |

What the tests cannot show was checked in the running app, and is recorded in
`apps/desktop/README.md` with what was and was not seen.

## Alternatives considered

- **A menu written in Rust.** A second list. Rejected above.
- **The menu owns the keys through registered accelerators, and the page listens only where there
  is no menu** — this ADR's first decision. Disproved on Windows by pressing the keys: the page got
  the keystroke and the accelerator never ran. It might work on macOS, where AppKit takes a key
  equivalent before the view sees it, but a rule that differs by platform and has been seen on one
  is worse than one path that has been seen on two (the browser build and the Windows window).
- **Both, de-duplicated.** Two paths to one command, to defend against a delivery the first path
  was never going to make on the platform where it was tried.
- **An in-page menu bar for the browser build.** Duplicates the header; not built.
- **Enable New character everywhere.** Makes losing an unsaved character one keystroke; waits for a
  dirty flag.
- **Hold chords back while a text field has focus.** Would make Ctrl+S dead exactly while a name is
  being typed, and protects nothing: no shortcut here is an editing key.
