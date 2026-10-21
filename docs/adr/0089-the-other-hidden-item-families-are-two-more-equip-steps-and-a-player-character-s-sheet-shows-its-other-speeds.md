# 0089 — The other hidden item families are two more equip steps, the mounts are goods, and a player character's sheet shows its other speeds

**Status:** Accepted · 2026-10-05 · implemented the same day · **the equip steps are superseded by [0129](./0129-optional-class-features-and-additional-features-are-options-a-character-chooses-not-items.md)** (2026-10-21: the families are options of their own types, taken through ordinary sets; the mounts stay goods) (see the note at the end) · answers ROADMAP Phase 3's "Take the other hidden item families", which
[0072](./0072-a-build-step-may-offer-items-a-character-equips-and-what-it-takes-is-a-bag-entry.md) decision 6 left open ·
builds on [0024](./0024-inventory-is-a-list-of-instances.md), [0036](./0036-a-level-is-spent-on-a-class-by-writing-two-records.md),
[0042](./0042-the-tests-read-the-current-official-corpus-and-a-moving-corpus-fails-only-what-must-hold-against-any-corpus.md),
[0043](./0043-speed-is-the-race-base-plus-what-content-adds-to-it.md), [0045](./0045-a-class-split-is-one-input-and-an-unmet-ability-score-minimum-is-a-flag.md),
[0062](./0062-an-npc-s-other-speeds-saves-and-skills-are-its-creature-s-rules-and-its-senses-are-what-it-prints.md),
[0073](./0073-a-creature-a-character-holds-is-derived-one-at-a-time-in-its-holder-s-namespace-and-shown-as-its-own-stat-block.md),
[0081](./0081-an-equip-step-may-offer-only-what-is-gated-on-what-the-character-has.md),
[0087](./0087-starting-equipment-is-a-data-file-beside-the-system-and-money-is-counted-in-the-units-the-system-declares.md) ·
**format:** none. Two build steps and four stats in `systems/dnd5e/system.json`, in fields the system format already has;
`character.json` and `.incu` unchanged

## Context

Aurora switches some things on by an item the user equips and the sheet never lists (`inventory-hidden`). ADR 0072 offered
one family that way, Tasha's optional class features, as an `equip` build step, and left the rest for a look of their own:
they mix speeds, unlockers, a curse and the Companion and Familiar Selection items, and 8 of the 91 hidden items are 2024
mounts with no rules, so "hidden" is not "a switch". Nothing in either app could take any of them: an equip step is the only
way the app puts an item on a character, and the inventory editor ADR 0087 plans is not built.

### What the corpus and the samples hold

Measured by `tools/verify/src/hidden-items.test.ts` on AuroraLegacy/elements at `c28ce6c`, report-only (ADR 0042), each item
equipped on a fresh 2014 Human Fighter 4 through the builder.

| | |
|---|---|
| hidden items outside the optional class features | **55**, all `Item`, none with requirements or support tags of its own; nothing grants, selects or names one (the corpus has **0** `select`s of type `Item`) |
| "Additional Feature" | **35**, every item of the category, every one saying it is equipped to enable it. Every grant is unconditional |
| — speeds | 11: climb, swim and fly equal to walking, +5 or +10 (`innate speed:<mode>`), and walking +5 or +10 (`innate speed`) |
| — senses | 8: darkvision, blindsight, tremorsense and truesight +5 or +10 (a `Vision` grant and its `:range`) |
| — feat unlockers | 9, one per book. Each grants a marker that **feats' own requirements read** (`… \|\| ID_…_GRANTS_FEAT_UNLOCKER`): 1 to 75 feats per book; a Fighter 1 qualifies for 8 of the 2024 book's 75 before and all 75 after |
| — the multiclass unlocker | 1. Its marker is read in **28 of the 29 classes' `<multiclass>` blocks** (`([str:13], !(the other edition)) \|\| marker`), which an element's own requirements do not show. A Fighter with every score 3 has 26 classes flagged without it and **none** with it, and the other edition's Fighter stops being excluded |
| — weapon mastery | 2: the 2024 feature for a class without it, and one more mastery for a class with it (a select over 46) |
| — the rest | the Companion Selection (a select over 117 creatures) and Familiar Selection (44), each closed while the other is held; Lycanthropy (an optional select over 7 racial traits); Dragonlance's bonus feats (two selects) |
| "Additional Ability Score Improvement" | **12**, every item of the category, all `Internal`: six grant the overlay's `ID_INTERNAL_ASI_<ABILITY>` (+1), six write −1 to the score |
| "Mounts & Vehicles" | **8** of the category's 77 items, all from the 2024 Player's Handbook, with a cost and a weight and **no rules**; none says to equip it |
| the thirty samples | **0** bag entries of any of these families |

**Every one of the 47 switches already derives through the bag**: equipped, each adds what it says, opens what it says and
brings no problem. Two things do not show:

- **The climb, swim and fly items move a stat the player character's sheet does not show.** `innate speed:climb` reads 30
  with "Climb Equals Walking" equipped, and the sheet is unchanged. That is not the items' gap: content writes a player
  character's other movement modes in 49 rules on 48 elements as `innate speed:<mode>` (races, racial traits, a few items:
  the Tabaxi, the Lizardfolk, the Sea Elf, the Aarakocra, the 2024 Thief), adds to them in 22 rules as
  `innate speed:<mode>:misc` (a Barbarian's and a Monk's movement and a 2014 feat, each gated on the mode being there), and in 48 rules as `speed:<mode>` (28 of them magic items, `bonus="base"`, "a climbing speed equal to your walking
  speed"), and the sheet shows none of it. ADR 0043 named it: "Not modelled: the other movement modes, which a sheet does not
  show". The NPC shows its other speeds since ADR 0062.
- **What a feat or multiclass unlocker unlocks is not on the sheet**, and should not be: it is what a picker offers, and
  the measurement shows the offer moves.

## Decision

### 1. 5e declares an "Additional features" step for the "Additional Feature" family

```jsonc
{ "id": "additional-features", "label": "Additional features", "types": ["Item"],
  "equip": { "setter": "category", "values": ["Additional Feature"] }, "description": "…" }
```

An equip step as ADR 0072 defines it, with no new field: zero or more items, never blocking, recorded as equipped bag
entries. **Not `gatedOnHeld`** (ADR 0081): no grant of the family is gated on anything, so the rule would offer nothing.
Every player character is offered all 35, as Aurora offers them: each is something a table allows (a speed, a sense, a
waived prerequisite, a creature), and the step's description says so. Content decides what each does:

- **The unlockers work as content wrote them.** A feat unlocker's marker makes its book's feats' own requirements hold, so
  a feat select offers them. The multiclass unlocker's marker makes every multiclass block it is written in hold, so the
  class control (ADR 0036, ADR 0045) takes a class with no score flag; that it also lifts the other edition's exclusion is
  content's `||`, not a reading here. It does not switch multiclassing on: ADR 0088's option still gates the control.
- **A creature from the Companion or Familiar Selection is held and shown as its own stat block** (ADR 0073). That the two
  exclude each other is their selects' own requirements.

### 2. 5e declares an "Ability score adjustments" step for the "Additional Ability Score Improvement" family

The same shape with that category: twelve items, a +1 or a −1 to one score, on top of whatever method set the scores, for
a table that grants one. Each is taken once at most, as any equip step's offer leaves out what the character holds, so two
+1s to the same score are not available here; they are not in the family either (one item per score and direction).

Two steps rather than one with both values: the categories are content's own names for two families, and a step headed
"Additional features" offering "Additional Ability Score Diminishment, Strength" among the climb speeds reads as noise.

### 3. The 2024 mounts are offered by no step: they are goods

They have a price, a weight and no rules, and none says to equip it. A step would put a horse in the bag as an equipped
switch that does nothing. They are things a character buys, which is the inventory editor's (ADR 0087's second part).
**That editor cannot leave out "hidden" items as such**, as ADR 0072 assumed it would ("hidden items would still be left
out of it"): it would leave out the mounts. Whether it offers a family's items by its category, and leaves the families
two steps already offer to them, is that editor's ADR to decide; this records the measurement it starts from.

### 4. A player character's sheet shows its other speeds

The player character kind declares `speed:burrow`, `speed:climb`, `speed:fly` and `speed:swim`, each derived as walking
speed is (ADR 0043): `innate speed:<mode> + innate speed:<mode>:misc + speed:<mode>:misc`, what content contributes to
`speed:<mode>` itself landing on top. An "Other Speeds" section after Combat lists them with `showWhen`, so a character with
none shows no section, as the NPC's does. No engine change and no new field.

**Not refereed.** No sample records a movement mode and Aurora's save does not write one. Read from content, as the walking
formula was before the samples' readout confirmed it. One combination reads high and is left as content writes it: a
character with an innate mode (a Tabaxi's climb equal to walking) and a magic item that gives the same one
(`speed:climb` equal to walking, `bonus="base"`) reads twice the speed, where the book says the two do not stack. They are
two stats, so no bucket can separate them, and taking the larger would be a rule content does not state (ADR 0005).

## Consequences

- A player character can take a climb speed, a sense, a feat or multiclass unlocker, weapon mastery, Lycanthropy, Dragonlance's
  bonus feats, a companion or a familiar, and a +1 or −1 to a score, from Build; each is one equipped bag entry, the record an
  import makes, and the sheet does not list the item (ADR 0072 decision 4).
- Every player character with an innate other speed shows it, which none did. No derived stat moves for a character that
  shows none; the oracle compares no movement mode.
- Two more sets on Build, both skippable and never blocking.

## What this does not do

- **Say which items give this character anything**, or which unlock something for it (still ADR 0072's open item).
- **Offer an NPC any of it**: 5e's NPC declares no inventory, so an equipped item derives nothing there.
- **Take one item twice**: an equip step offers what the character does not hold.
- **The inventory editor**, and with it the mounts (decision 3).

## Alternatives considered

- **Offer every hidden item in one step.** The mounts would be switches that switch nothing, and the optional class
  features would lose ADR 0081's narrowing.
- **One step for both families.** Decision 2.
- **`gatedOnHeld` on the new steps.** It reads gated grants; these have none, so it would offer nothing.
- **Leave the speed items out until the sheet shows speeds.** They would still be invisible on every Tabaxi, and the sheet
  section is a declaration.
- **The larger of the innate and the item's speed for each mode.** A rule content does not state; recorded as a reading
  to make if a referee ever disagrees.

## Evidence (for the implementation)

- `hidden-items.test.ts` gains assertions that hold against any corpus, through the builder: the two steps offer exactly the
  family's items a fresh character does not hold, the mounts are offered by no step, and taking an item writes one equipped
  bag entry and no choice; a speed item taken shows its speed in "Other Speeds"; the Companion Selection taken opens its
  creature select and, answered, holds a creature that is shown. Each fails with its declaration removed.
- The oracle: `INCUDO_ORACLE_SNAPSHOT` on the base and `INCUDO_ORACLE_BASELINE` on the change, same checkout.
- Driven in the browser build.

## Note, 2026-10-05 — built, and what it measured

Implemented as decided, after the measurement and this ADR: the four speed stats and the Other Speeds section, then the two
steps with their assertions in `hidden-items.test.ts`. No engine, `packages/ui` or format change.

**The oracle is identical.** `INCUDO_ORACLE_SNAPSHOT` on this ADR's commit and `INCUDO_ORACLE_BASELINE` on the change, same
checkout (AuroraLegacy/elements at `c28ce6c`): no row moved on any of the thirty samples and `oracleViolations` stays
empty. The full suite passes.

**One sample shows another speed**: sample 28, a 2024 Rogue 3 (Thief), climbs 30, its Second-Story Work as the book gives it.
No other sample has one.

**Held** by four assertions in `hidden-items.test.ts`, each failing under the perturbation it names: either step's family
changed to nothing (its items are not offered), a step widened to "Mounts & Vehicles" (a hidden item without rules is
offered), the climb term taken out of `speed:climb`'s derivation or the Other Speeds section removed (the climbing speed
does not show), and the Additional Feature step removed (the Companion Selection is not offered).

**Driven** in the browser build (DOM clicks on the dev server, an existing draft, an Aarakocra Fighter 2): both steps listed
as optional sets, 35 and 12 items; "Speed: Climb Equals Walking" taken, and the Sheet's Other Speeds read Climb 30 beside the
Aarakocra's own Fly 30, with no item listed; the Companion Selection taken opened a select of 117, an Ape chosen was shown as
its own stat block "From Companion Selection"; removing the item removed the Ape and its answer; a Strength +1 read 11 on the
Sheet; all taken back. No console error. Not in the Tauri window, not on the phone.
