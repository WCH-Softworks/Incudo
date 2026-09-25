# 0055 — A source records the parts the user switched off, and the load skips them

**Status:** Accepted · 2026-09-25 · builds on [0028](./0028-sources-are-a-profile-characters-carry-an-allowlist.md)
(sources are a profile), [0051](./0051-lazy-loading-is-declined-and-the-index-walk-stops-waiting-on-itself.md) (a source
loads every file it lists) and [0052](./0052-a-source-that-refers-to-content-no-enabled-source-has-is-reported-and-never-blocked.md)
(what a source lacks is reported, never enforced)

## Context

ROADMAP Phase 3 carries "choose parts of a source (a tree of its indexes) before loading it". Adding one inner index as
a source already works, and ADR 0052 made it safe: a book added without the one it builds on says what it lacks. What
is missing is the other direction: taking a repository **minus** something. Today that means adding each wanted inner
index as a source of its own, which for AuroraLegacy without its Unearthed Arcana is three sources and a profile that
no longer follows upstream's grouping.

### The tree, measured

AuroraLegacy/elements at `c28ce6c`, from `.corpus/`, walking indexes only:

- **60 indexes, at most two levels below the top one**: the top index names four groups (Core, Supplements, Unearthed
  Arcana, Third Party), and the groups name books.
- **740 element files**, the same 740 a full load reads.
- **No index and no file is named by two parents**, so the tree is a tree.
- **Three indexes list files beside nested indexes.** Core lists `ALE.xml` (every skill and common language) and
  `internal.xml` itself, next to its six books; Supplements lists one file beside 48 books; Unearthed Arcana lists 64
  documents directly and one nested index.

The third point is why "a tree of its indexes" is not quite enough: the 64 Unearthed Arcana documents are the natural
unit of choice there, and they are files.

## Decision

### 1. What is recorded is what is switched off

`ConfiguredSource.excluded` is an optional list of the URLs of parts (indexes or element files) the user switched off,
absent when nothing is. It lives in the sources profile (ADR 0028), which no character reads, so no character format
changes. The profile's `formatVersion` stays 1: the field is optional and a profile without it loads everything, as
before.

An exclusion list rather than an allowlist, on purpose. The common choice is "all of it except …" (no playtest
material, no third party), and a book upstream adds later should arrive the way it does for everyone else who follows
the repository: switched on, and visible on the source's line. An allowlist would silently hold back every new book
from a user who only meant to leave out one.

### 2. The load skips a switched-off part wherever it is named

The load's existing `include` hook (`LoadOptions.include`) is handed `partsFilter(source)`: a ref whose URL is excluded
is not loaded, and an excluded index is not read, so nothing under it is either. It matches by URL, which is how the
load already decides a file was loaded, so a part named twice is off in both places. The refresh (ADR 0050) uses the
same filter, so it fetches what the load uses and, as it already does for a file upstream stopped naming, removes from
the cache what the load no longer touches.

### 3. The tree is read from the indexes alone, and shows what a load would load

`readIndexTree` in `packages/content` walks a source's indexes, level by level and six at a time, through the same
composed source a load uses (so the indexes it reads are cached for the load that follows), and lists every nested
index and every element file in the order its parent lists them. It lists exactly what the load would consider: element
files by the load's own test, the same depth limit, and a part named a second time is shown once and marked. An index
that cannot be read is shown with the reason, and can still be switched off.

### 4. The choice is a view-model, and the pane computes nothing

`packages/ui/src/source-parts.ts` turns a tree and an exclusion set into rows (on or off, reachable or under a part
that is off, how many element files each part holds and how many of those will load) and does the toggling. The
Sources pane renders it: before adding a source ("Choose parts first") and on a configured source's line ("Choose
parts"). Saving writes only exclusions the current tree still names.

### 5. Nothing is required, and nothing is added on the user's behalf

Switching off Core and keeping a book is allowed. ADR 0052's line on the source says what the book then refers to that
nothing enabled contains. Nothing in an Aurora index says what depends on what (ADR 0052), so the chooser does not
guess.

## What was measured after it was built

- **The tree is the load, request for request.** `tools/verify/src/source-parts.test.ts` reads the tree of AuroraLegacy at
  `c28ce6c` from `.corpus/` and loads the corpus with every request recorded: the top index plus every part the tree lists
  once is exactly the set of URLs the load asked for (59 nested indexes, 740 element files, none named twice). Reading the
  tree from disk takes about 20 ms.
- **Switching a book off drops exactly its files.** The same file switches off the first book of the group with the most
  books (found by shape, never by name; today Lost Mine of Phandelver): 740 files become 738, no element from its files
  is left and no element from any other file is lost.
- **The chooser's total is the load's.** `packages/ui/src/source-parts.test.ts` compares `partsView`'s count of files that
  will load with a real `ContentLibrary` load through `partsFilter`, with each part of a small tree switched off in turn,
  including a file listed first under a part that is off and again under one that is on, which the load then meets
  second and loads.
- **Perturbations**, each failing a named test: a refresh without the filter (fetches and keeps the switched-off index);
  a tree that lists refs the load skips; a level expanded in the order its reads finished (the first mention of a part two
  books name moves); an off-by-one against the load's depth limit; a repeated mention counted as never loading;
  reachability not passed down; the index's own name ignored; stale exclusions saved.
- **Driven in the browser build on Windows** with the AuroraLegacy source as configured: the tree reads the four groups
  and their books with their own names, switching off Unearthed Arcana shows 648 of 740 files and marks everything under
  it as unable to load, and saving gives a load of 12,306 elements from 648 files, 9 warnings where the full corpus has 57,
  and "1 part switched off" on the line, surviving a reload. The Unearthed Arcana index added as a new source with
  "Choose parts first" and its Plane Shift book off loads 64 of its 92 files. Switching everything back on returned the
  profile to 14,320 elements from 740 files and 57 warnings. **Not driven:** the Tauri window, macOS and Linux.

## What this does not do

- **Per-element choice.** The unit is a file or an index. Which books a character is offered is ADR 0049's, per
  character; this is what is loaded at all, per machine.
- **An update check sees excluded files until the next refresh.** The check asks every cached file (ADR 0050); a part
  switched off after it was cached is still cached until a refresh prunes it, so it can be counted as changed.
- **Switching a part back on after a refresh needs the network**, since the refresh removed it from the cache. That is
  what adding a source needs too.

## Alternatives considered

- **An allowlist of parts.** Decision 1: every book upstream adds would stay off for anyone who ever chose parts.
- **Indexes only, as the roadmap line says.** The Unearthed Arcana group is one index and 64 documents; choosing among
  them is the choice that group invites.
- **Several sources, one per wanted index.** Works today and stays possible; it loses upstream's grouping, and every
  source is a line, an order and an update check of its own.
