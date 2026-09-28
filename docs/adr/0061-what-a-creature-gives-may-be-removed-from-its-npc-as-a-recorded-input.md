# 0061 — What a creature gives may be removed from its NPC, as a recorded input

**Status:** Accepted · 2026-09-25 · closes [0058](./0058-a-setter-may-name-elements-its-holder-has-and-the-kind-says-which.md)'s
first gap · builds on [0006](./0006-derived-character-state.md), [0012](./0012-self-contained-saves.md),
[0033](./0033-declining-a-decision-is-its-own-input.md), [0060](./0060-a-character-may-leave-its-progression-to-what-it-chose-and-that-is-format-3.md)
· **format:** an optional `removedGrants` on a character, `formatVersion` **3** (ADR 0060's number) when present ·
**amended** by [0067](./0067-what-a-creature-grants-may-be-removed-like-what-it-names-and-only-a-holder-s-gifts-are.md):
a holder's own `<grant>`s may be removed too, and only a holder's gifts may be

## Context

ADR 0058 gave an NPC what its creature names in its `traits`, `actions` and `reactions` setters, granted as a
`<grant>` would be. It left one gap: **a DM who wants a Triceratops without Stomp has no way to say so.** A granted
element has no control; the builder's Traits and Actions steps are sets of what the DM adds, and what the creature
gives was on the sheet and nowhere in the builder.

ROADMAP Phase 2 already carries "one grant cannot cancel another", which is about content: a rule in one element
suppressing what another grants. This is not that. Nothing in the corpus says a Triceratops may lack Stomp; the
DM does, for this NPC, which makes it an input the way declining a decision is (ADR 0033).

### What the corpus holds

Measured on AuroraLegacy/elements at `c28ce6c`, 141 `Companion` elements, with a throwaway script (not committed):

| | |
|---|---|
| distinct ids named by creatures' `traits`, `actions`, `reactions` | 350 (373 namings resolve, ADR 0058) |
| ids named by more than one creature | **10**: the four sizes of the Dancing Item and the six levels of the Drake Companion share theirs |
| `<grant>` rules on creatures | **12**, on 7 creatures (the Wildfire Spirit, the Ancient Companion, the Primal Companions of Tasha's and the 2024 Player's Handbook), every one naming an id the same creature's setter also names, with no level or requirement |
| named ids that any element other than a creature grants | **0** |

So a removal that only stopped the setter would leave those twelve held: the creature gives them twice.

## Decision

### 1. A character records what it had taken away, and it cancels only what the holder gives

`Character.removedGrants` is a list of element ids, absent when empty. When the character holds an element whose
declared setter (`setterGrants`, ADR 0058) names a removed id, that holder does not give it: neither by the setter
nor by its own `<grant>` of the same id. The same element **chosen**, or granted by anything else, is still held; a
removal is "the creature does not give this", not "this character may never have it". What a kind's `setterGrants`
does not name cannot be removed: a class feature is content's, and repairing content is what `overrides` is for.

One question, asked in one place each: `setterGrantIds(defs, element, removed)` leaves removed ids out of what a
setter names, and `withdrawnGrantIds(defs, element, removed)` says which of the element's own grants to skip. The
engine's expansion uses both; `collectCharacterContent` skips the withdrawn ids from the holder's references, so a
removed trait is not embedded on the creature's account and the save derives what the builder did.

### 2. It is format 3

A reader of format 2 would give the trait back without a word, which is ADR 0024's test for moving the number, and
ADR 0060 has already defined 3 as "may use what a reader of 2 would get wrong". `setGrantRemoved` raises a character
to 3 when it records a removal; giving the last one back leaves the field absent and the version where it is. A
character that removes nothing is not raised. The validator refuses `removedGrants` below 3.

### 3. The builder lists what a creature gives, and each can be removed and given back

`BuilderState.holderGrants` lists every id a held element's setters name, once, with the element that names it, the
build step whose types include it (for grouping), whether it is removed, and whether the character still holds it.
`removeGranted` refuses an id no held element names; `restoreGranted` gives one back. The desktop pane shows them in
the settled column under the creature's name, grouped by step, each with Remove or Give back. A removed element is no
longer held, so the set it belongs to offers it again, and picking it there is choosing it.

When the creature changes, a removal nothing held names any more is forgotten: a trait taken from a Wolf means nothing
on a Bear, and a record no screen shows is one nobody can undo. One the new creature also names is kept, because the
DM said this NPC does not have it.

## What this does not do

- **Content still cannot cancel content.** Phase 2's "one grant cannot cancel another" is unchanged; this is the user's
  input, scoped to what a kind's setters give.
- **A removal is keyed by the element, not by the holder.** One holder names an id once, and an NPC holds one creature;
  a kind whose character held two elements naming the same id would have both stop giving it.
- **The player character removes nothing.** `pc` declares no `setterGrants`, so nothing a PC holds is listed.
- **A removal is not undone by picking another creature that also names it.** Kept on purpose (decision 3); the DM gives
  it back where it is listed.

## Alternatives considered

- **Stop only the setter.** The twelve creatures that also grant what they name would keep it, and the control would do
  nothing for them.
- **A removal means "never hold this".** It would take away a trait the DM had also chosen by hand, and one another
  element grants; the DM removed it from the creature, not from the character.
- **Reuse `declinedDecisions`.** A decision is something asked; a granted trait was never asked, and its id is an element
  id, not a decision id. Two meanings in one list is the sentinel ADR 0033 declined.
- **Record the creature's traits as choices and let the DM unchoose them.** Content copied into the character (ADR 0006),
  the alternative ADR 0058 already declined.
- **`overrides`.** It sets stats, and is a repair tool for content that is wrong; a DM's stat block is not wrong content.

## Evidence

- `packages/core`: `removed-grants.test.ts` — a removed name is not held and its rules do not apply; the holder's own grant
  of it is cancelled too; chosen or granted by something else it is held; the save does not embed it and derives the
  same; recording one is format 3, giving the last back leaves no field, and removing nothing raises nothing. Checked by
  perturbation: skipping only the setter, keeping the holder's grant, withdrawing every removed id from every element,
  embedding the holder's references, and not raising the version each fail at least one.
- `packages/ui`: `holder-grants.test.ts` — what the creature names is listed with its giver and step; removing takes it
  off and keeps it listed, and the set offers it again; only a named id can be removed; a removal nothing names is
  forgotten when the creature changes and one still named is kept. Each fails with the line it guards removed.
- `tools/verify`: `npc-creatures.test.ts` — for every creature in the current corpus, every resolving id it names is
  removed (373, 12 of them also granted by the creature's own rule): none is held, none is embedded, and the save derives
  what the builder did. Fails with the engine's or the collector's withdrawal removed. `schemas.test.ts` — a removal is
  recorded only from format 3.

No derivation moves for a character that removes nothing: every creature's NPC and all thirty samples derive identically,
and the oracle's tables are unchanged by snapshot and baseline.

**Driven in the browser build only**, not the Tauri window, macOS or Linux, with an origin-private folder standing in for the native folder picker. The Triceratops NPC listed Trampling Charge under Traits and Gore and Stomp under Actions, "From Triceratops"; removing Stomp struck it through with Give back and took it off the sheet; saved, the card said 3 elements embedded (Stomp was not); reopened with the content source switched off, the sheet had Trampling Charge and Gore only; with the source back on, Give back restored Stomp. Running it found that the save opened with no source listed the removed trait by its raw id, because a removed element is not saved; it now says one more was removed and that its content is needed to see or give it back.
