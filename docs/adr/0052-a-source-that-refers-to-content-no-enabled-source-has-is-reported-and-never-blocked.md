# 0052 — A source that refers to content no enabled source has is reported, and never blocked

**Status:** Accepted · 2026-09-25 · builds on [0005](./0005-aurora-import.md) (diagnostics over guessing),
[0028](./0028-sources-are-a-profile-characters-carry-an-allowlist.md) (sources are a profile) and
[0051](./0051-lazy-loading-is-declined-and-the-index-walk-stops-waiting-on-itself.md) · constrains the content format
[0007](./0007-native-formats.md) names (`.incuset`) and does not yet specify

## Context

Any index can be added as a source, not only a repository's top one. Aurora allows it, AuroraLegacy's README lists its
group indexes one by one, and Incudo loads them: all 60 of AuroraLegacy's indexes load on their own with no error
(measured for ADR 0051's follow-up, `.corpus/` at `c28ce6c`). What they do not do is stand on their own.

### Content depends on other content, and nothing says so

AuroraLegacy's `core.index` is six books (the 2014 and 2024 Player's Handbook, Dungeon Master's Guide and Monster
Manual) and two files no book lists: `core/ALE.xml`, "Aurora Legacy Essentials" (every skill, 155 proficiencies, 41
languages, the 9 alignments), and `core/internal.xml` (the ability score improvement options and 116 of Aurora's
internal grants). Every other index leans on those. Of the 60, **2 can build a character alone** (the top index and
`core.index`); **58 grant ids that only another index declares**. Upstream says so in prose: its README marks Core
"(Required by following Indexes)" and the others "(Requires Core Index)". The index format has no field for it, and
ADR 0008 freezes Aurora compatibility, so nothing machine-readable will ever say it.

Loaded as a user would add them, with each reference attributed to the source whose element makes it:

| enabled sources | grants to ids no enabled source declares | additions (`<append>`) with no target |
|---|---|---|
| AuroraLegacy (the top index) | 1 (the upstream typo `…VULNERAILITY…`) | 0 |
| Core | 1 (the same typo) | 0 |
| Core + Tasha's | 1 (the same typo) | 0 |
| the 2014 Player's Handbook alone | 110, e.g. `ID_LANGUAGE_COMMON` | 2 |
| the 2024 Player's Handbook alone | 101 | 1 |
| Tasha's alone | 156, e.g. `ID_PHB_SPELL_MISTY_STEP` | 51 |
| the 2014 Player's Handbook + Xanathar's | 110 and 57 | 2 and 0 |
| Supplements (the group index) alone | 376 | 64 |
| Unearthed Arcana (the group index) alone | 287 | 88 |

And whenever Core is missing, the elements Incudo generates for Aurora content (ADR 0035's overlay) grant 2 languages
no enabled source declares.

Today none of this reaches the user. A grant to nothing is dropped in silence: the Player's Handbook alone builds a
character with no skill to choose and no sentence anywhere saying why. An addition with no target is one line in a list
of warnings that can run to fifty. The corpus test measures the first kind (`corpus.test.ts` budgets it), and the app
never has.

It is cheap to know. Walking every element's grants over the whole corpus takes **15 ms**; over one book, 1 ms.

### What must not be counted

A **requirement** that names an id nothing declares is how the corpus says "unless the 2024 version is in play"
(`!ID_X` against an id that will never exist): 23 in the full corpus, deliberately, and more when a source is partial
(133 for the 2014 Player's Handbook alone). Counting them would put a permanent, meaningless number beside every source,
so they are not part of this, as they are not part of the corpus budget.

## Decision

### 1. After every load, each source is asked what it refers to that nothing enabled has

Two things, attributed to the source whose file they come from:

- **a grant, or a select's default, naming an id no enabled source declares.** The same references the corpus budget
  counts (`referencedElementIds` without requirements), per element instead of over the whole index;
- **an addition that found nothing to add to**, which is an `<append>` still waiting when the last source has loaded
  (after the fix that lets one wait across sources).

Requirement-only references are not counted (above). A reference the generated Aurora elements make is attributed to
the first Aurora source loaded, because loading it is what brought them in.

It is computed in `packages/content`, from the library the load produced, and published beside each source's file and
element counts. It depends only on what is enabled; nothing is stored.

### 2. It is reported, and nothing is blocked, added or guessed

The Sources pane says it on the source's own line, in plain words, with the list of ids one click away:

> Refers to 156 things none of your enabled sources contain, and 51 of its additions to other content have nothing to
> add to.

The first draft of this ADR ended the sentence with "It may need another source enabled." Running it removed that:
on AuroraLegacy's own line, whose one missing thing is an upstream misspelling no source will ever supply, the advice
was wrong, and it was a guess of exactly the kind the next point rules out.

- **Nothing is enforced.** The source stays enabled and loaded, a character can still be built from it, and nothing is
  enabled on the user's behalf. Adding a supplement without its core book is a thing a user may mean to do.
- **Nothing is guessed.** It says what is missing, never which source would supply it. "Usually Core" is true of
  AuroraLegacy's content today and is the kind of rule ADR 0005 keeps out of the code: nothing in the data says it, and
  a homebrew index would get the wrong advice.
- **A small number is said as a small number.** The full corpus always has 1, the upstream typo, and that is a real
  thing a character silently loses. It is shown the same way, not hidden under a threshold and not dressed as an
  alarm.

### 3. Incudo's own content format declares what it depends on

For content written in Incudo's format (`.incuset`, named by ADR 0007 and not yet specified), a dependency is part of
the data, not of a README:

- a bundle **names the bundles it requires**, by a stable identifier and optionally a minimum version, so a picker can
  show "needs Core" before anything is downloaded and select it along with what the user chose;
- a reference should be **traceable to the declaration that covers it**, so that "this refers to something none of the
  bundles it requires declares" is a check an author can run. Ids that carry the namespace of the bundle that declares
  them are the likely shape; the choice is made when the format is specified, not here.

The after-load report of decision 1 still runs over Incudo content, because a declaration can be wrong or incomplete.
Whether a declared dependency may be deselected is left to that format's ADR; this one records that it is known before
download, which Aurora content can never be.

### 4. A conversion never invents one

An Aurora index converted to Incudo's format carries no dependency it did not state, which is none. A user or author
may add one by hand. Deriving one from what a load happened to find missing would turn "Core was not enabled when this
was converted" into a rule.

## What was measured after it was built

`ContentLibrary.missingContent()` returns, per source id, the ids its grants and select defaults name that nothing
loaded declares, and the target of each of its appends still waiting. `loadSources` in the desktop app attaches it to
each loaded source once every enabled source is in, and the Sources pane renders it on that source's line, the
sentence as the summary of a list of the ids.

- In the browser build on Windows (2026-09-25), with the one AuroraLegacy source as configured: "Refers to 1 thing none
  of your enabled sources contain", and the list holds the upstream typo. With it disabled and the 2014 Player's
  Handbook index added on its own: 110 things and 2 additions, the figures measured offline above. (The overlay's two
  languages are among the 110, since the book's own races grant them too.) The profile was put back afterwards.
- `packages/content/src/missing.test.ts`: a book alone reports against itself and not a requirement; adding what it
  builds on clears the report in either load order, leaving only what an append of its own granted, reported against
  the book although it now sits on the other source's element; a later definition is judged, not the replaced one;
  the overlay's references go to the first Aurora source, never to an id of their own. Five perturbations (count
  requirements, read a folded element whole, drop appended rules, key the overlay by its own id, drop waiting appends)
  each fail a test.
- `tools/verify/src/missing-content.test.ts` compares two computations on the real corpus: the per-source report,
  taken together, must equal `analyseCorpus`'s whole-load count of grants to nothing, and its waiting additions the
  append warnings, for the whole index, its groups as four sources loaded backwards, and one group alone (Unearthed
  Arcana: 289 and 88). It catches three of the five perturbations; the two about which source an appended rule is
  reported against do not change the union, and no appended rule in the corpus grants anything missing today.
- **Not driven:** the Tauri window (the note is the same component there; only the transport differs); macOS and Linux.

## What this does not do

- **It does not name a source that would supply what is missing**, not even one the user has configured and disabled.
  That is not a guess, and it is the obvious next step, but a disabled source is not loaded, so it needs a record of
  what each source declared, kept from its last load. Left until the report has been used.
- **It does not report unmet requirements.** Decision 1's reason.
- **Nothing appears on the Build or Sheet panes.** The full corpus always has its one typo, so a notice there would be
  on for everyone. The Sources pane is where a source is added, and where the answer belongs.
- **No tree picker.** Choosing parts of a source is its own decision (which parts, stored where, and what comes along
  with a book, such as the files its parent index lists). This report is what would make such a picker safe to use,
  and it is useful without one: adding a single inner index already works today.
- **Characters are untouched.** A save embeds what it used (ADR 0012) and opens with no source; an import already
  reports ids its corpus lacks as `content-missing`.

## Consequences

- Adding the Player's Handbook index alone stops being a silent loss of every skill: the source says what it lacks.
- The dangling-grant count the corpus test has budgeted since Phase 1 is, for the first time, something a user sees.
- A source's line in the Sources pane carries one more sentence when something is missing, and the load report one
  more field per source.
- The day upstream fixes its typo, AuroraLegacy's line says nothing at all.

## Alternatives considered

- **Require Core before any other AuroraLegacy index.** Enforcement the data cannot justify, and specific to one
  repository's layout.
- **Enable what is missing automatically.** Nothing can say which source that is (decision 2), and a source the user
  did not add appearing in their profile is the silent change ADR 0012 and ADR 0029 keep refusing.
- **Keep it in the warnings list.** It is there for additions already, fifty lines deep, and grants to nothing are not
  there at all. A count on the source is what a person reads.
- **Count requirements too.** A permanent, meaningless number on every source (above).
- **Report on the Build pane.** Always on, because of one upstream typo (above).
