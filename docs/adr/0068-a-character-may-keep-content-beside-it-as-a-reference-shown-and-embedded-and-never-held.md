# 0068 — A character may keep content beside it as a reference, shown and embedded and never held

**Status:** Accepted · 2026-09-28 · answers the roadmap item [0057](./0057-a-creature-s-printed-scores-are-where-an-npc-starts-and-the-dm-may-replace-them.md)
reworded · builds on [0003](./0003-system-agnostic-content-model.md), [0005](./0005-aurora-import.md),
[0006](./0006-derived-character-state.md), [0012](./0012-self-contained-saves.md), [0049](./0049-a-character-records-which-publications-it-is-offered-and-it-narrows-offers-only.md),
[0053](./0053-a-content-browser-searches-everything-loaded-and-groups-by-what-the-system-declares.md),
[0063](./0063-a-character-may-carry-features-its-user-writes-which-add-to-a-stat-or-set-where-it-starts.md),
[0064](./0064-a-character-may-carry-elements-its-user-adds-from-loaded-content-and-an-unmet-prerequisite-is-a-flag.md) ·
**format:** an optional `references` on a character, `formatVersion` **7** when present; an optional `references` on a
character kind in the system format (`formatVersion` stays 1)

## Context

ADR 0057 measured the 2025 Monster Manual as two things: 32 structured creatures, usable as an NPC's creature since
then, and 45 stat blocks written only as HTML prose in element descriptions, from the Rat to the Tarrasque. It reworded
the roadmap item to "show the prose stat blocks as a reference beside an NPC", because parsing prose into elements is
the guess ADR 0005 declines and showing it is honest. Nothing was decided about how a DM reaches one, how it is tied to
an NPC, or whether that tie is recorded.

### What the corpus holds

Measured by `tools/verify/src/stat-block-references.test.ts` on AuroraLegacy/elements at `c28ce6c`, reported as `ℹ`
lines and asserting none of it (ADR 0042). A stat block is recognised there by what every one prints: the table of the
six ability scores, each a bold three-letter cell. That is a reading of prose, fine for a measurement.

| | |
|---|---|
| descriptions printing a stat block | **63**: 45 Monster Manual (2025), 16 Player's Handbook (2024), 2 Dungeon Master's Guide (2024) |
| of them printing a challenge rating as a number | 47; the 16 from the Player's Handbook print "None" (summons that scale with their caster) |
| their type | **all 63 `Information`** |
| `Information` elements in all | **116**: the 63, and **53 that are not stat blocks** (rules text, tables, lore from 18 other books) |
| books whose every `Information` element is a stat block | 2 of 20: the Monster Manual (2025) and the Dungeon Master's Guide (2024) |
| descriptions opening with an empty heading (`<h4 … />`) | 63, exactly the stat blocks: a habit of the markup, not a statement |
| carrying a setter, rule, support or requirement | **0** |
| embedding another element (`<div element="…">`) | **0** |
| embedded by another element's description | **all 63**, 82 times: 46 from magic items, 22 spells, 8 items, 3 subclasses, 3 class features (a summoning spell prints its creature's stat block) |
| granted, named by a setter or embedded by a creature an NPC starts from | **0** |
| sharing a name and a book with such a creature | 8 (the Bat, the Rat, …), which nothing in content reads |

Three things follow. **A stat block is not a thing content states**: it is an element of a type that also holds rules
text, set apart only by its prose, so recognising one in the app would be reading HTML, the same guess as parsing it.
**Nothing ties a prose block to a structured creature** but the coincidence of eight names. And **content already shows
stat blocks beside other things**, by embedding: all 63 are embedded in the descriptions of the spells, items and
features that summon them.

## Decision

### 1. A reference is a recorded input of its own, and it is never held

`Character.references` is a list of element ids, in the order chosen, absent when empty. It is an input like
`additions` (ADR 0064) and unlike it in the one way that matters: **a reference is not held.** Nothing seeds the
derivation from it, no requirement reads it, no sheet section lists it, its rules and grants reach nothing. It is text
the character keeps beside it. A stat block kept beside an NPC is not something the NPC has; the NPC is what the DM
builds from it.

**It is embedded.** `collectCharacterContent` seeds from it, so the element is in `content.json` and the character
opened with no source shows the same text (ADR 0012). What the element's own rules reach is embedded with it, as for
any seed; for the 63 that is nothing.

**Format 7, and only for the characters that record one** (`raiseFormatVersion`): a reader of 6 would drop the field
without a word. Dropping the last reference leaves the field absent and the version where it is; the validator refuses
the field below 7 and an id twice.

### 2. The kind says which types may be one

A character kind may declare `references: { types, label?, description? }` (system format, replaced along `extends`
like `additions`; the validator refuses a type the system does not declare). `label` heads the references where they
are shown; `description` says what keeping one means. 5e's `npc` keeps `Information`, under **For reference**, and the
legendary creature inherits it. The player character keeps none: a druid's beast or a summoned spirit is a plausible
use and undecided.

### 3. The offer is every element of those types; nothing recognises a stat block

Every element of the kind's types the character is offered (ADR 0049's view: a book switched off offers none), less
what it keeps, by name, searched in the same picker as everything else. That is 116 today, the 63 stat blocks among
them, and a DM who types "tarr" finds the Tarrasque. Offering the 53 that are not stat blocks is harmless: a rules
table kept beside a creature is a reference too.

Not a filter by prose shape (the parse ADR 0005 declines), by book (a system definition naming the Monster Manual would
name content, and misses the 18 stat blocks in two other books), or by the empty opening heading (markup, which an
upstream edit can change without meaning to).

### 4. The NPC is built beside it by hand

A reference closes no step and fills no number. The DM enters the ability scores (ADR 0057's manual budget), armour
class, hit points and speed (ADR 0059's entry), the challenge rating, and writes the traits, actions and legendary
actions as the creature's own features (ADRs 0063, 0065), reading the text beside them. An NPC built on one of the eight
structured creatures that share a name with a prose block may keep the prose too; nothing matches the two for it.

### 5. Where it is shown

On the Build pane, in the column that lists the character's parts, beside the Open decisions where those numbers are
entered: each reference's text, a Remove, and "Choose from your content". On the Sheet, after the kind's sections,
under the kind's label. The text is the element's description, sanitized as every description is. **Browse**
(ADR 0053) stays the way to read one without a character: `Information` is a type the system marks browsable, and the
search finds it.

A reference nothing loaded or embedded declares is listed with a sentence saying so, and can be removed. One of a type
the kind does not keep (a system changed since, a hand-edited file) is listed, says so, and its text is not shown: the
kind is the authority, as it is for an addition (ADR 0064) and a written feature's type (ADR 0065).

## What this does not do

- **Recognise, parse or prefill.** Decisions 3 and 4.
- **Show what a description embeds.** Found by this measurement and not fixed: every one of the 63 is embedded by
  another element's `<div element="…">`, 82 times, and Incudo shows nothing there (the sanitizer unwraps the empty div,
  as it was written to). A summoning spell's description, in Browse or a picker's preview, has a gap where its
  creature's stat block is. Resolving an embedding needs an index lookup when a description is rendered, and a save must
  then embed what a held element's description embeds or it opens with the gap back. It is its own item.
- **Give a player character references.** Decision 2.
- **Say so on a library card.** A card shows kind, progress and elements embedded.

## Alternatives considered

- **Browse only.** Costs nothing and already works. But it ties nothing to the NPC: the DM searches again every session,
  switches panes to read what they are entering, and with no source loaded Browse shows nothing, while a save must open
  with the stat block it was built from. Kept as the way to read one without a character.
- **An addition (ADR 0064) of the `Information` type.** No new field and no format bump. But an addition is *held*: it
  joins the derivation's elements (and so every derived summary and the oracle's), its requirements are asked, a sheet
  section would list it by type, and a stat block would read as something the NPC has, where it is what the NPC is
  built from.
- **A build step that is a set of `Information`** (ADR 0032). The same objection: a step's picks are choices, and
  choices seed the derivation.
- **One reference, not a list.** Simpler to show. A DM building a swarm beside its member, or a variant beside the
  original, keeps two; the list costs nothing more.
- **Copy the text into the character's `freeform` notes.** Stores content in the character (ADR 0006), follows no
  upstream fix, and loses the markup a stat block's table needs.
- **Match a prose block to a structured creature by name.** Nothing in content links them (decision 4); eight names in
  common is a coincidence of text.

## Evidence

Each test names the perturbation that fails it, and each perturbation was run.

- `packages/core/src/references.test.ts`, over a fixture with no game in it: keeping one raises to 7 and only then,
  dropping the last leaves no field and keeps the version; a kept element's rule, grant and select reach nothing; a save
  embeds every reference with its text; the kind's `references` is resolved and carried along `extends`. Perturbed: no
  raise; references seeded into the derivation; references left out of the save; `references` dropped in resolution.
- `packages/ui/src/references.test.ts`: the offer is the kind's types, by name, less what is kept, and through the
  offered view; keeping one records it, shows its text and moves nothing derived; each refusal writes nothing; a row
  nothing declares, or of a type the kind does not keep, is listed with why and not shown; removal takes any id and the
  last leaves no field. Perturbed: the offer not typed, not sorted, offering what is kept, reading everything loaded;
  `addReference` ignoring the offered view or the kind's types; the text left out; a disallowed row shown; removal
  refusing an unknown id.
- `tools/verify/src/schemas.test.ts`: format 7 with references validates, at 6 is refused, an id twice is refused, 8 is
  refused; a reference type the system does not declare is refused for the NPC and the legendary creature that inherits
  it. Perturbed: the version check, the type check, the schema field.
- `tools/verify/src/stat-block-references.test.ts`: the measurement above, as `ℹ` lines; and against whatever the
  corpus holds, an NPC and a legendary creature, from nothing and on a creature, are offered every element of their
  reference types (116), keep them all, derive exactly what they derived keeping none (`summarize`), and saved and
  reopened against only what the save embeds, show the same rows and derive the same. Perturbed: references seeded into
  the derivation; left out of the save; the NPC's `references` removed.
- The oracle's thirty-sample table is identical before and after (`INCUDO_ORACLE_SNAPSHOT` on the base,
  `INCUDO_ORACLE_BASELINE` on the change, same checkout; a baseline with one difference removed fails, so the
  comparison was live): no player character derivation moved, as expected with `pc` keeping none and a reference never
  held.
