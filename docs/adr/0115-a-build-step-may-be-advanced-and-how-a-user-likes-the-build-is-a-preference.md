# 0115 — A build step may be advanced, and how a user likes the Build pane is a preference

**Status:** Accepted · 2026-10-13 · answers the maintainer's report on the Build pane · builds on
[0017](./0017-open-decisions-not-steps.md), [0032](./0032-a-build-step-may-offer-a-set.md),
[0033](./0033-declining-a-decision-is-its-own-input.md), [0072](./0072-a-build-step-may-offer-items-a-character-equips-and-what-it-takes-is-a-bag-entry.md),
[0078](./0078-a-print-is-chosen-in-a-step-of-the-app-s-own-and-no-edge-of-the-page-is-left-to-the-dialog.md),
[0089](./0089-the-other-hidden-item-families-are-two-more-equip-steps-and-a-player-character-s-sheet-shows-its-other-speeds.md) ·
**format:** system format `advanced` on a build step (`formatVersion` stays 1); no character format change

## Context

After using the Build pane, the maintainer reported that "Additional features" (ADR 0089: another speed or sense, a feat
or multiclass prerequisite waived, weapon mastery, a companion of one's choice, lycanthropy) was offered in Open
decisions on every new player character, though almost no character takes any of it. "Ability score adjustments" (a
score raised or lowered by one, for a table that imposes it) is the same kind of thing. Both are equip steps: never
blocking, skippable, and Skip records the skip on the character (ADR 0033), so a user who skips them has written
something into every character to say "my table does not do this".

Asked, the maintainer chose to hide both by default and to leave Tasha's "Optional class features" offered: those are
part of the books' class rules, and the step already offers nothing until a class is chosen (ADR 0081's `gatedOnHeld`).

## Decision

1. **A build step may declare `advanced: true`** (system format, optional). It is offered only when the user switches
   on "Show advanced options" on Build. While it is off, the step opens no decision and has no line among the
   character's parts, unless the character already took something through it: what was taken stays a settled pick,
   listed and changeable, whatever the switch says. Validation refuses `advanced` on a step a character must answer:
   it is allowed only on a set (`multiple`), a step that equips, or a pick that is not required. 5e marks
   `additional-features` and `ability-adjustments`. No step id is named in code.
2. **Hiding is not declining.** Nothing is written to the character: `declinedDecisions` is untouched and a hidden
   decision is not listed under Skipped. The switch is a view.
3. **The switch is the user's, never the character's.** `CharacterBuilder` takes `showAdvanced` (default off) and
   `setShowAdvanced`, and publishes `BuilderState.advanced` (`steps`, the hidden steps' labels; `shown`). The shells keep
   the preference in `Storage` under `build/view` (`packages/ui/src/build-preferences.ts`), read once at start and
   written on every change, falling back field by field as the print options do (ADR 0078). The same record holds how
   the rest of the pane is laid out, which is the same kind of thing.
4. **The phone gets the same switch**, on its Build screen above Open decisions, reading and writing the same record
   through its own storage. It builds with the same builder, so without one it would have lost both steps.
5. **The option preview folds to its title line.** The maintainer reported that the hover preview (a fixed-height dock
   at the top of the settled column, `min(45vh, 420px)`: 387 of 860 pixels at 1280×860) left too little room to see the
   choices already made. Three layouts were tried in the running app at 1280×860 and shown to the maintainer: a fourth
   column for the preview (every column narrower, the left one scrolling sideways), the preview pinned under Open
   decisions (it covered the list being pointed at), and the dock kept where it is with a Hide description / Show
   description control. The maintainer chose the last. Folded, the dock is the option's name and the control, about 40
   to 60 pixels; the choice is `previewCollapsed` in the same record. At the window's minimum, 880×600, nothing
   changes: below 1001 pixels the columns stack and the dock is not drawn, each picker floating its own preview, as
   before.
6. **Build has two tabs: Build, and Equipment & notes.** The maintainer reported that what is never finished (the bag,
   the purse, the play of a character) read as among the choices already made, which are the character's progression.
   Agreed with the maintainer: Build keeps the parts, the level and classes, Open decisions, the choices made, the scores
   and hit points, a cantrip's dice and damage type (the maintainer's call: a fixed choice, so a build one), what was
   skipped, not held or not counting, what a creature gives, written features and additions. Equipment & notes holds the
   starting packages once taken, the inventory and money, the prepared spells, the text written about the character, what
   it keeps for reference, and the books it is offered. A starting package still to take stays an open decision on Build.
   The tabs are inside the Build pane, not a pane of their own: Ctrl+2 still opens Build, no chord moves, and the last tab
   is remembered (`tab` in the same record). One command, **Switch Build tab** (View menu, live on Build only), moves to
   the other on **Ctrl+Shift+H**, one of the chords ADR 0038 saw reach the page with real keys in the Windows window;
   this command's own press with real keys there has not been seen. The wording is `BUILD_TABS`. **The phone does not
   get the tabs yet**: its Build screen is one scrolling list, in the order it had.

A reader that does not know the key offers the step as before, so `formatVersion` did not move.

## Evidence

- `packages/ui/src/advanced-steps.test.ts`: hidden by default with no step line and nothing declined; shown by the
  switch with nothing written to the character; a taken element stays settled and changeable once the switch is off.
  Each fails under the change it names.
- `tools/verify/src/schemas.test.ts`: `advanced` on a set validates; on a required pick it is refused.
- `packages/ui/src/build-preferences.test.ts`: defaults, field-by-field fallback, round trip, a storage that fails.
- `tools/verify/src/hidden-items.test.ts` asks for advanced options: it measures what those steps offer.
- `docs/SYSTEM-GUIDE.md` shows the key in a `json $defs/buildStep` fence, which `system-guide.test.ts` validates.
- Driven in the browser build: a new 5e character offers neither step; the switch offers both and lists them; a Bonus
  Feats taken and the switch turned off leaves it listed with Change and Remove; the switch survives a reload. Not driven
  on the phone. (Since ADR 0123 5e has no advanced step; its two steps are offered by a campaign option, driven in the
  Tauri window on 2026-10-20.)
- The preview, driven in the browser build at 1280×860: open 387 pixels tall, folded 39 with nothing pointed at and 60
  naming a long option, and open again on Show description; at 880×600 no dock is drawn. The screenshot tool could not
  draw the window while it was behind others, so the folded dock was measured, not photographed.
- The tabs, driven in the browser build at 1280×860: Build lists the parts, Level and classes, Open decisions, Choices
  already made, the user's own features and additions; Equipment & notes the inventory, About the character, For
  reference and Books; a dispatched Ctrl+Shift+H moves between them. `commands.test.ts` holds the command to Build and
  its chord to every pane. In the Tauri window on Windows (2026-10-15, real keys and mouse, a fresh profile and a
  scratch folder): real Ctrl+Shift+H arrives as a key-down and switches both ways, the native menu item does too and is
  greyed off Build, the switch and the fold were clicked for real, and after the window was closed and started again it
  opened on the tab, fold and switch it was left with. The saved file names no preference. Not on macOS, Linux or the phone.

## Consequences

- A character imported or built elsewhere that holds one of these items shows it; nothing is lost by the default.
- A system author can hide any optional step the same way. A step that must be answered cannot be hidden.
