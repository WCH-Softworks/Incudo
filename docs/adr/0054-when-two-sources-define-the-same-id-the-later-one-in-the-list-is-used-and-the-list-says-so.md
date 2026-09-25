# 0054 — When two sources define the same id, the later one in the list is used, and the list says so

**Status:** Proposed · 2026-09-25 · builds on [0005](./0005-aurora-import.md) (diagnostics over guessing),
[0012](./0012-self-contained-characters.md) (a save embeds what it uses), [0028](./0028-sources-are-a-profile-characters-carry-an-allowlist.md)
(sources are a profile) and [0052](./0052-a-source-that-refers-to-content-no-enabled-source-has-is-reported-and-never-blocked.md)
(reported per source, never blocked)

## Context

The app loads a system's enabled sources into one library, one after another, in the order the profile lists them,
which is the order they were added. When a file defines an id something already loaded holds, the new definition
replaces the old one and the library pushes a warning: `"ID_X" is defined in more than one file; using <url>`. The
comment beside it has said since Phase 1 that this was temporary: "Phase 2 turns this into a user-visible conflict
resolution step".

### How often, measured

Loaded offline with the library as the app uses it, AuroraLegacy/elements at `c28ce6c` from `.corpus/`, and the
original Aurora repository, aurorabuilder/elements, at `299ab0e` (its last commit, 2020-10-16), whose four group
indexes are the content Aurora Builder shipped with and what someone coming from Aurora may still have:

| enabled sources | ids defined twice | in one file | in two files of one source | across sources | of those, the two definitions differ |
|---|---|---|---|---|---|
| AuroraLegacy alone | 4 | 3 | 1 | 0 | — |
| AuroraLegacy, then the original's four indexes | 7,274 | 6 | 6 | **7,262** | **1,978** |
| the original's four, then AuroraLegacy | 7,274 | 6 | 6 | **7,262** | **1,978** |

Across sources, per pair: 2,747 with the original's Core (910 differ), 3,123 with its Supplements (656), 1,392 with its
Unearthed Arcana (412), and none with its Third Party index, which AuroraLegacy does not carry. "Differ" compares the
two definitions as their files declared them, parsed, with their origin left out, which is what decision 3 reports.

What differs is not cosmetic. By type: 622 subclass features, 450 spells, 274 class features, 84 feats, 73 subraces,
37 of the books themselves. By what differs: the description in 870, the rules (what a character is granted, offered or
given) in 382, the requirements in 533, the support tags that put a spell on a class list in 379; the Eladrin subrace
and every Expertise skill are among the rules. Which of the two a character is offered depends on nothing but which
source the user happened to add first, and nothing on screen says so. The evidence is 7,262 lines in a warning list the
Sources pane shows fifty of.

A first measurement read 3,544 differing, from a checkout of the original made with line endings converted to CRLF: the
parser keeps a carriage return inside text, so every multi-line description read as different. Fetched over the network,
as the app does, the bytes are the repository's and the figure is the one above. The parser's missing end-of-line
normalization is a separate fix to the importer, not part of this.

### What the one-source figures are

Within AuroraLegacy, one id is defined in two of its files (a Xanathar's staff that the 2024 Dungeon Master's Guide
redefines), which is the one warning the corpus budget counts, and three are defined twice in the same file (two
identically), which the library has never reported, because it only compares file addresses. Neither is a choice a user
can make: they are upstream's, and they stay what they are.

### What cannot decide it

- **The index version.** AuroraLegacy's top index says 0.0.1 and has since 2023; the 2020 original's Core says 0.2.5.
  "The newer version wins" would give everyone the five-year-old content.
- **The file's date, or which repository is "official".** Nothing in an Aurora index carries either, and a homebrew
  source that redefines an id on purpose (a house-ruled spell) has to be able to win.
- **Choosing per id.** 1,978 differing ids is not a list anyone works through.

## Decision

### 1. The later source in the list is used, as it always was, and that is now the rule

Precedence is the order of the system's enabled sources in the profile: when two define the same id, the one lower in
the list is used. That is what the loader has always done, so no profile loads differently the day this ships. Within
one source nothing changes: the later file wins and it stays a warning, since the source's author made it and the user
cannot.

The Aurora overlay (the elements Aurora's app generates at runtime) is not a source for this: a file that defines one
of its ids replaces it and says so through the warning, as the library's own comment already promised.

### 2. The user can change the order

Each source on the Sources pane gets **Move up** and **Move down**. The order is the profile's list order, which is
already stored, so there is no new field and no format change. Moving a source reorders it only among its own system's
sources; the others keep their places. A move reloads the enabled sources, as enabling one does.

The pane says the rule above the list once there are two sources: "When two sources define the same thing, the one
lower in this list is used."

### 3. Each source says what it shares with the others and whose version is used

Once every enabled source has loaded, the library works out, for every id more than one source defines, which source's
definition is used, and whether each replaced definition is the same as it or different, comparing the definitions as
their files declared them (before any `<append>` is folded in). Each source's line then says, per other source it
shares ids with (AuroraLegacy's line, added after the original's Core):

> Also defines 2,747 things Core (original) defines, 910 of them differently. This source's version is used.

and on the other line, "…910 of them differently. AuroraLegacy's version is used." The differing ids are one click
away. Ids both define the same way are counted in the total and never listed, because which one is used changes
nothing.

A replaced definition that a third source replaced too is reported only against the one that is used: with three
sources defining an id, the first two each say the third's version is used, and neither mentions the other.

Across-source redefinitions **leave the warnings list**. They are on the line of the source they concern, in a
sentence, which is where ADR 0052 put missing references for the same reason: a count on the source is what a person
reads, and 7,262 warnings is not.

### 4. Nothing is blocked, chosen per id, or guessed

Both sources stay enabled and loaded, nothing is disabled on the user's behalf, and nothing says which version is
right. A source that duplicates another entirely is shown as doing so, and removing it is the user's decision.

### 5. Characters

A saved character is not affected: its save embeds every element it uses (ADR 0012), and when it is open that copy is
in front of what is loaded. Reordering changes what is offered, and what a character that is not yet saved derives
from, which is what the user asked for by reordering.

## What this does not do

- **No per-id choice.** An override list ("for this id, use that source") could sit on top of this later; the order is
  the default it would override, and 1,978 ids show the default has to be good on its own.
- **It does not report a redefinition within one source** beyond the one warning that exists, and it does not start
  reporting the three same-file ones. Both are upstream's, and the second would move the corpus warning budget.
- **The Browse pane shows the definition that is used**, not the other. Showing "also defined by" there is a separate
  change.
- **No drag and drop.** Two buttons are enough for a list that is rarely longer than a handful.

## Alternatives considered

- **First one wins.** Reads naturally as "priority from the top", and would silently change which definitions every
  existing profile with a conflict loads.
- **The newer index version wins.** Would pick the 2020 content over AuroraLegacy (above).
- **Refuse, or disable, a source that conflicts.** Enforcement the data cannot justify; a homebrew source redefines ids
  on purpose, and ADR 0052 already declined enforcement for the neighbouring case.
- **Keep the warnings.** The state this replaces.
