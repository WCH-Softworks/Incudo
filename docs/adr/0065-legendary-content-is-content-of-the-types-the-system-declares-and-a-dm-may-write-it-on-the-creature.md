# 0065 — Legendary content is content of the types the system declares, and a DM may write it on the creature

**Status:** Accepted · 2026-09-28 · answers the question [0057](./0057-a-creature-s-printed-scores-are-where-an-npc-starts-and-the-dm-may-replace-them.md)
left open · builds on [0003](./0003-system-agnostic-content-model.md), [0005](./0005-aurora-import.md),
[0008](./0008-aurora-compatibility-frozen.md), [0011](./0011-user-systems.md), [0012](./0012-self-contained-saves.md),
[0032](./0032-a-build-step-may-offer-a-set.md), [0056](./0056-an-aurora-file-the-user-adds-is-a-source-of-its-own-kept-as-a-copy.md),
[0063](./0063-a-character-may-carry-features-its-user-writes-which-add-to-a-stat-or-set-where-it-starts.md) · **format:** an
optional `type` on a custom feature, `formatVersion` **6** when present; an optional `types` on a kind's `customFeatures`
in the system format (`formatVersion` stays 1)

## Context

ROADMAP Phase 4's exit criterion is that "a DM can build a PC, an NPC and a legendary creature in one app, and the engine
has no code that names any of them". Since ADR 0009, `systems/dnd5e/system.json` has declared a `legendary` kind that
extends `npc` and adds three element types, `Legendary Action`, `Lair Action` and `Regional Effect`, with a build step
and a sheet section for each. ADR 0057 measured that nothing in the corpus declares an element of any of them, and
reworded the roadmap item: decide where legendary content comes from, before any UI for it.

### What the corpus holds

Measured by `tools/verify/src/legendary-content.test.ts` on AuroraLegacy/elements at `c28ce6c`, over the types the
legendary kind adds to the NPC's, read off the two kinds and never spelled in the test:

| | |
|---|---|
| elements declared of the three types | **0, 0 and 0** |
| ids of those types named by any setter (a creature's `traits`, `actions`, … — ADR 0058) | **0** |
| `<grant>`s of those types | **0** |
| descriptions carrying a **Legendary Actions** heading | **7**, all `Information` (the 2025 Monster Manual's prose stat blocks) |
| descriptions carrying a **Lair Actions** or **Regional Effects** heading | **0** and **0** |
| of the seven, printing a cost ("Costs 2 Actions") | **0** |
| uses the seven print | **3** in six; **3 (4 in Lair)** in one |

Two things follow from the prose that are not in ADR 0057:

- **The 2025 rules have no lair actions or regional effects in a stat block.** A lair shows up as a rider on a number
  ("4 in Lair", "XP … or … in lair"), and as lore, not as a list of actions. The two types are the 2014 books' shape,
  and a user's content in that shape is still the content they would come from.
- **A legendary action has no cost in the 2025 rules**, and in the 2014 books the cost is printed in its name:
  "Wing Attack (Costs 2 Actions)". Nothing in a derivation reads a cost; a DM reads it.

So there is nothing to import, and the question is where a DM's legendary actions come from instead. Four homes were
available, each already built for something else: an Aurora file the user adds (ADR 0056), a feature the DM writes on the
character (ADR 0063), an element the DM adds from loaded content (ADR 0064), or a format of Incudo's own.

## Decision

### 1. A legendary action is an element of the type the system declares, and needs no format of its own

The system already says what the three are: element types, declared in `system.json` (ADR 0003), offered by the kind's
steps and listed by its sheet sections. That is the whole format. An element of one, from any source, is offered, held,
listed, granted by a creature's `<grant>` like anything else, and embedded in a save (ADR 0012), with no engine and no
importer change. Aurora's element format carries a name, a type, a description and rules, which is everything a
legendary action is; what the corpus lacks is content, not a shape to hold it.

No new element format. Incudo's own content format, for content a user authors and reuses, is Phase 8's; a format built
here for three types would be the first piece of it designed around the smallest case.

### 2. Content comes from a user's file; a DM who has none writes it on the creature

Two ways in, both already built, and which one a DM uses depends on whether the content is meant for one creature:

- **A user's own Aurora file (ADR 0056)** that declares elements of the three types. It can be used by any creature, and
  a creature in the same file names its own with `<grant>`, so a homebrew legendary creature arrives with its legendary
  actions, lair actions and regional effects, and a legendary creature built on it has them without a pick. The shape,
  in Aurora's own terms:

  ```xml
  <element name="Tail Sweep" type="Legendary Action" source="…" id="ID_…_TAIL_SWEEP">
    <description><p>The creature makes one Tail attack.</p></description>
  </element>
  <element name="Old Drake" type="Companion" source="…" id="ID_…_OLD_DRAKE">
    … <rules><grant type="Legendary Action" id="ID_…_TAIL_SWEEP" /></rules>
  </element>
  ```

  Nothing reads a setter naming them: no content writes one (0 measured), a `<grant>` already says it, and declaring a
  setter nothing writes would be speculative support for a frozen format (ADR 0008).

- **A feature the DM writes (ADR 0063), held as the type it is.** Decision 3. "Storm Bolt: The kraken uses Lightning
  Strike" written on one NPC, listed under Legendary Actions.

Not ADR 0064's additions: they put *loaded* elements on a character whatever their prerequisites, and the kind's steps
already offer every loaded element of the three types, where a DM building a legendary creature looks for them.

### 3. A written feature may be held as any type its kind lists

`customFeatures.types` on a kind (system format; replaced along `extends` with the rest of `customFeatures`): every
element type a feature may be held as, in the order a picker offers them, `type` among them. `type` stays the default,
and a kind that declares no `types` holds every feature as its `type`, as before. The validator refuses a `types` entry
the system does not declare, and a `type` that `types` leaves out.

5e's `npc` lists `Companion Trait` (the default), `Companion Action` and `Companion Reaction`, so a DM's own bite is
listed with the creature's actions and not its traits; `legendary` adds `Legendary Action`, `Lair Action` and
`Regional Effect`. The player character still declares none.

`CustomFeature.type` (character format) records the type a feature is held as, **only when it is not the kind's
default**: absent means the default. A character that records one is **`formatVersion` 6** (`raiseFormatVersion`), and
only such a character: a reader of 5 would hold a legendary action as a trait. Choosing the default again removes the
field and leaves the version where it is. The validator refuses `type` below 6.

A recorded type the kind does not list (a system updated since, a hand-edited file) is reported
(`custom-feature-type`) and the feature is **not held**: no element, no line applies. That is ADR 0064's rule for an
addition of a type the kind does not list, and ADR 0063's for a feature on a kind that carries none: the kind is the
authority, and holding it as some other type is a guess.

### 4. No cost; the name carries it as printed

A written legendary action is a name and a description. A cost is text the DM reads, the 2025 rules print none, and a
2014 one is written in the name as the book prints it. A field for it would be a number nothing derives from.

### 5. How many legendary actions a creature takes is a number on its stat block

The `legendary` kind declares `legendary actions`, labelled **Legendary Action Uses**, default **3** (all seven stat
blocks print 3), shown in the sheet's Legendary Actions section. It is a number like armour class: a feature may add to
it or set it, and the kind's `customFeatures.sections` includes that section, so the Kraken's "4 in Lair" is a feature,
"Lair", adding 1. It is not on the entry step: a default is not something content supplied, so an entry target would
be open on every legendary creature until typed. A system definition change with no engine one.

### 6. The steps are sets, as traits and actions are

The `legendary` kind's **Legendary Actions** and **Lair Actions and Regional Effects** steps become sets (`multiple:
true`, ADR 0032): a creature takes any number of each, and what it holds is not offered again. With nothing of the
types loaded a set opens no decision, which is what a step with nothing to offer should do; the kind's description
says where they come from instead, and the written features' heading picker offers the three headings. Before, the two
steps were optional single picks, which the builder offers nowhere: not an empty picker, nothing at all.

## What this does not do

- **Parse the 2025 prose.** Seven stat blocks have legendary actions as text, and splitting HTML into elements is the
  guess ADR 0005 declines. Showing them beside an NPC is its own Phase 4 item.
- **Show a creature's legendary content on a plain NPC.** An NPC built on a homebrew legendary creature holds its
  legendary actions (they are granted), and the NPC's sheet has no section for them; the legendary kind is for that
  creature. `tools/verify/src/legendary-content.test.ts` measures it.
- **Reuse a written legendary action.** It is one character's, as every written feature is; a library of the user's own
  is Phase 8, and a user's file is the way to reuse one today.
- **Track uses in play.** 3 is what the stat block prints; spending them is a play-time tracker, which Incudo is not yet.

## Alternatives considered

- **A new element format, or new setters, for legendary content.** Nothing needs one (decision 1), and Incudo's own
  format is Phase 8's.
- **Only a user's file.** A DM building one villain would have to write an Aurora XML file, add it as a source and
  keep it, for three sentences. A written feature is how ADR 0063 already answers "this creature has something no
  source gives it".
- **Only a written feature, held as a `Companion Trait` with a name like "Legendary: Tail Sweep".** No format change,
  and every legendary action under Traits on the sheet, with the Legendary Actions section always empty: the kind would
  still have nowhere for its own types to come from.
- **A cost field.** Decision 4.
- **Additions (ADR 0064) of the three types.** Decision 2.
- **Drop the `legendary` kind and make legendary actions an NPC step.** The kind is what ADR 0009 declared to prove a
  kind can be a delta on another; it now differs from the NPC by three types, two steps, two sheet sections, a stat and
  three headings a feature may be listed under, and none of it names anything in the engine.

## Evidence

Each test names the perturbation that fails it, and each perturbation was run.

- `tools/verify/src/legendary-content.test.ts`. Over the current corpus, the table above as `ℹ` lines (ADR 0042: it
  moves with the corpus and fails nothing). Over no corpus at all, the real `systems/dnd5e/system.json` and a generic
  homebrew file written for the test (`tools/verify/fixtures/legendary/`, added and loaded as ADR 0056 adds one): a
  legendary creature built on the file's creature holds the legendary action, lair action and regional effect the
  creature grants, each listed in its sheet section; the Legendary Actions set offers the file's other legendary action
  and not the granted one, and holds it once taken; a DM's written legendary action, lair action and regional effect
  are each listed under their own heading, and a written "Lair" adding 1 reads 4 uses; the character is format 6; and
  saved and reopened with no source, every section reads the same. Fails with the two steps back to single optional
  picks (the spare legendary action is offered nowhere), with the uses stat removed, with the legendary types left out
  of the kind's `customFeatures.types`, and with its `customFeatures.sections` without the legendary section. An NPC
  built on the same creature holds its three legendary elements and lists none, reported.
- `packages/core/src/custom-features.test.ts`, over a fixture with no game in it: a feature recording a listed type is
  held as it and one recording none as the default; one recording an unlisted type is reported and not held, and its
  lines do nothing; the types are the kind's; only a typed feature raises to 6. Perturbed: the recorded type ignored,
  an unlisted type held as the default, `types` ignored, the version always 4, always 6.
- `packages/ui/src/custom-features.test.ts`: the state names the types as the sheet heads them; the builder writes a
  chosen type, forgets the default, keeps the type across other edits, and refuses an unlisted one; a feature recorded
  with one has a note and its lines read `not-held`. Perturbed: the default recorded, the refusal removed, labels by
  element name, the note removed, the chosen type not written.
- `tools/verify/src/schemas.test.ts`: format 6 with a typed feature validates, the type at 5 is refused, 7 is refused;
  a `types` entry the system does not declare, and a default the list leaves out, are refused. Perturbed: each check
  removed.
- The oracle's thirty-sample table is identical before and after (`INCUDO_ORACLE_SNAPSHOT` on the base,
  `INCUDO_ORACLE_BASELINE` on the change, same checkout; a baseline with one difference removed fails, so the
  comparison was live): no player character derivation moved, as expected with `pc` declaring no custom features.
- **Driven in the browser build** (not the Tauri window, macOS or Linux), with an origin-private folder standing in for
  the native folder picker, and the homebrew file added by a dispatched drop event on the Sources pane. The Legendary
  Creature started from the file's creature arrived with its legendary action, lair action and regional effect; its
  Legendary Actions set offered one option, the file's other one, and took it; no lair decision opened, since the
  creature held all there was. A feature named for a legendary action, listed under Legendary Actions from the six
  headings offered, and a "Lair" feature whose line was offered "Legendary Action Uses" and added 1, gave a sheet
  reading Legendary Action Uses 4 above the granted, taken and written legendary actions. Saved to the library, every
  source switched off and the page reloaded, its card read "Legendary Creature · Challenge Rating 10 · 7 elements
  embedded", and it opened to the same sheet and the same two features. **Not driven:** an NPC's written action or
  reaction, a feature recorded with an unlisted type (tests only), and the kind's description, which is the new
  character chooser's tooltip.
