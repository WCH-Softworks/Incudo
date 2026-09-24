# 0049 — A character records which publications it is offered, and that narrows offers only

**Status:** Accepted · 2026-09-24 · builds on [0028](./0028-sources-are-a-profile-characters-carry-an-allowlist.md)
and [0012](./0012-self-contained-saves.md) · **format:** an optional `publications` on a character (`formatVersion`
stays 2) and an optional `publication` flag and `requiredWhen` setter name on an element type in the system format
(`formatVersion` stays 1)

## Context

Phase 3 lists "source enable/disable per character", and Phase 2 left it as the gap cited most often: ADR 0046
measured that Aurora's spell lists are **narrower** than Incudo's, never wider, because the Aurora user had books
and editions switched off and Incudo has nothing to switch off with. A table that plays with the Player's Handbook
and Tasha's and nothing else is offered every Unearthed Arcana race, both editions of every class and 1,079 spells.

ADR 0028 already has two lists, and neither is this one:

- **The profile** is the user's, and its unit is a **content source**: a content index, such as the AuroraLegacy
  one. Enabling one loads it. One index holds every book, so the profile cannot say "not Unearthed Arcana".
- **`Character.sources`** is provenance: what the character was built against, written on save. ADR 0028 decided it
  is a record and not a gate, and an imported character's list names only the books it *uses*, so reading it as a
  gate would forbid everything the character has not already taken.

Aurora's unit is the **book**. A book is a `type="Source"` element, and every other element names its book in its
`source` attribute, by the book's `name`. The importer already joins the two that way (`toSourceAllowlist`).

### What the corpus contains

Measured on AuroraLegacy/elements at its head on 2026-09-24:

| | |
|---|---|
| `type="Source"` elements | **138**, no two with the same name |
| distinct `source` strings on elements | 133 |
| books no element names | 9 |
| `source` strings that name no book | **4**: `Internal` (1,453 elements), `Core` (140), `Van Richten's Guide to Ravenloft` (7) and `Player's Handbook` with a straight apostrophe (1) |

`Internal` is what Aurora's app supplies and `Core` is the rules every character uses; neither is a book, and a user
cannot switch either off in Aurora. The other two are misspellings: the first differs from its book only by case
(`to` for `To`); the second has `'` where the book has `’`.

**One book is not like the others, and running the app found it.** The first version of this ADR treated all 138
alike. Driving it in the Tauri window put **Aurora Legacy Essentials** on the list of books to switch off, and the
languages the builder had been offering (Dwarvish, Elvish, Abyssal) name it as their book, not the Player's
Handbook. Measured afterwards, a Wizard offered only the 2014 Player's Handbook is offered **no skill at all**. It is
a book AuroraLegacy added to hold what both editions refer to. It holds 155 proficiencies (every skill among them), 41 languages, the
nine alignments and a handful of features, and it says of itself that its contents "are required for the proper
functionality of the Aurora Legacy repository". Seven books carry a `core` setter, and it is the only one where
it reads `true`.

## Decision

### 1. The system says which element type is a publication

An element type may declare `"publication": true`. An element of that type is a **publication**, and its `name` is
the string other elements carry in `source`. The 5e definition marks `Source`. Nothing in core names a book, and a
system with no publication type has nothing to switch off, which is correct for a system whose content is one
book.

The join ignores case, which is how Aurora matches ids (see CLAUDE.md on `canonicalizeSaveIds`); that takes the
seven Van Richten elements back to their book. An element whose `source` names no loaded publication is **always
offered**: `Internal` and `Core` must be, and the one straight-apostrophe element is better offered than hidden by
a spelling. Nothing guesses at a second spelling (ADR 0005).

The same type may name a **`requiredWhen`** setter, and a publication on which that setter reads `true` is offered
to every character whatever it records: it is listed as always on, cannot be switched off and is never written into
a character's list. 5e names `core`. It is a named setter and not a rule about books, for the reason ADR 0047 gave
for `setterTags`: one book witnesses it, and it says so of itself.

### 2. A character records the publications it is offered, as an allowlist of names

`Character.publications?: string[]` — the names of the publications this character is offered, in the order
chosen. **Absent means every publication**, which is what every character written before this has and what a new
character starts with. It is an input in ADR 0006's sense: nothing derives which books a table uses.

An allowlist and not a blocklist, for the reason the importer already gives: an exclusion list silently
*includes* everything published after it was written. A table that said "PHB and Tasha's" should not be offered the
next Unearthed Arcana the day it arrives upstream. It stores names, not ids, because the name is what elements
carry and the join is by name.

A name the character records that no loaded publication has is **kept**, and shown as not loaded. Dropping it
would lose the table's decision the first time the character is opened on a machine with less content.

### 3. It narrows what is offered, never what the character is

The builder offers from a **view** of the index whose enumeration (`all`, `byType`, `bySupport`) leaves out every
element from a publication outside the list, and whose `get` answers for everything. The derivation only ever asks
`get`: the one enumeration in the engine is `candidatesFor` building a pool, and in `packages/ui` the others build
a race or class list and the multiclass options. So:

- **no derived number moves** because a book was switched off. An element the character already holds from that
  book stays, grants what it grants, and shows as the answer to its decision; only the alternatives offered
  beside it narrow.
- a save opens as it did. The list is not a derivation input, is not in `summarize()`, and embeds nothing.
- switching a book back on offers it again. Nothing was deleted.

Removing a held element because its book was switched off would be the silent change to a character ADR 0028
refuses. A character holding something from a book it is not offered is legal and says nothing; it is the state
every imported character with a book switched off afterwards is in.

### 4. The profile and the list stay separate

The profile decides what is **loaded**, for the user, by content index. `publications` decides what is **offered**,
for one character, by book. The list is not copied from the profile or into it, and it is not written into
`Character.sources`.

## What was measured after it was built

- **On the official corpus** (`tools/verify/src/publications.test.ts`): 138 publications, 129 holding content, one
  required. A level 1 wizard is offered 452 things with every book and **88** with the 2014 Player's Handbook: races
  139 to 9 (the book's nine), spellbook 87 to 30, and still every skill and language, from the required book. Nothing
  from another book is offered, everything that names no book still is, and the derivation is identical. Printed,
  not pinned (ADR 0042).
- **On the thirty samples**: each imported, then offered no book at all. **All thirty derive identically**
  (`summarize()`), and none is offered anything from a book that is not required. An index view whose `get` also
  filtered fails both tests; taking `requiredWhen` out of the 5e definition fails the first, on the wizard's skills.
- **In the running app, the Tauri window on Windows**: the Wizard 4 saved in an earlier session, switched to the
  2014 Player's Handbook with "Offer none" and one switch, was offered the book's eight Arcane Traditions, 16
  cantrips and 62 spellbook entries (203 before), and its four remaining skills; campaign options narrowed to the
  one that names no book. Saved with Ctrl+S, the list was in `character.json`; with every source disabled and the
  app restarted, the character reopened with its picks and the list showed the book as not loaded; with the source
  back, "2 of 138 books offered", the required one locked on. macOS and Linux were not driven.
- **A defect it exposed, and fixed with it.** A settled top-level pick promised its `candidates` would include what
  it holds, and only kept that promise because a chosen element was always among what the step offered. A
  switched-off book breaks that, and so could an element whose own requirements stopped holding; the pick now adds
  its answer back, as a set already did.

## What this does not do

- **The Aurora importer does not fill it.** A save's `<restricted>` list could be inverted into `publications`,
  which would make an imported character's pools match Aurora's. The importer is frozen to bugfixes (ADR 0008) and
  a new field is not a bugfix; the sample saves had their restricted lists removed when they were cleaned, so
  nothing committed could witness it either. Left visible.
- **No edition switch.** The 2014 and 2024 Player's Handbooks are two publications, so a table can drop either;
  nothing groups books into editions.
- **No list of what each book is.** A 5e `Source` element carries an abbreviation, a release date and an
  `official` flag; the list shows the name and how many loaded elements it holds, and nothing else yet.

## Consequences

- A table can say which books it uses, and the builder offers from those and from nothing else.
- `packages/core` gains one optional field on `Character` and two on `ElementTypeDef`, and no behaviour. The view
  and the list's view-model live in `packages/ui` under `node --test`.
- A table that uses only one book is still offered Aurora Legacy Essentials. That is what the book is for, and it
  is shown as always on, so the user can see why a language from no book they ticked is on offer.
- An element held from a book the character is not offered is not flagged. That is deliberate (decision 3) and
  may deserve a quiet note on the sheet one day.

## Alternatives considered

- **Gate on `Character.sources`.** It is provenance, and an imported character's list names only what it uses
  (ADR 0028). Rejected.
- **Per-user book switches in the profile, as Aurora has.** A user with two tables would switch books every time
  they changed character, and a save handed to someone else would be offered their books, not its table's.
  Rejected; a per-user default for *new* characters may still be worth adding on top.
- **A blocklist.** Rots in the direction that matters (decision 2). Rejected.
- **Every distinct `source` string is a book.** Offers `Internal` as something to switch off, and switching it off
  takes every ability score improvement option with it. Rejected for decision 1.
- **Filter inside `candidatesFor`.** Reaches the engine's pools but not a race list, a class list or the
  multiclass options, which enumerate in `packages/ui`; a view of the index reaches all of them through the one
  thing they share.
