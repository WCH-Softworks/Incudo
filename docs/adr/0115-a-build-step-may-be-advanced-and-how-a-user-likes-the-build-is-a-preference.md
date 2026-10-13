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
  on the phone or in the Tauri window.

## Consequences

- A character imported or built elsewhere that holds one of these items shows it; nothing is lost by the default.
- A system author can hide any optional step the same way. A step that must be answered cannot be hidden.
