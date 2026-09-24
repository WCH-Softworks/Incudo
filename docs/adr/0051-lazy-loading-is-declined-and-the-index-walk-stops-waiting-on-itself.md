# 0051 — Lazy per-file loading is declined, and the index walk stops waiting on itself

**Status:** Proposed · 2026-09-24 · closes the gap [0029](./0029-a-cache-is-keyed-by-source-and-evicted-by-version.md)
named · amends [0004](./0004-live-vs-downloaded-content.md) ("lazy per-file") · builds on
[0050](./0050-an-update-check-asks-every-cached-file-and-a-refresh-keeps-what-it-cannot-reach.md)

## Context

The last unticked "live mode hardening" line in ROADMAP Phase 3 is partial index loading: ADR 0004's `stream`, "a
character that uses two of forty files pays for two". ADR 0029 named the gap: `ContentLibrary` builds a whole
`ElementIndex` up front because the builder asks for candidate lists by type (`byType`, `bySupport`, `all`), and lazy
loading needs an index that can miss and a builder that can wait. ADR 0050 then made the transport fast. This
measures whether lazy loading can still pay for itself before anything is designed.

Everything here was measured on 2026-09-24, on one Windows machine and one network, against AuroraLegacy/elements
(offline counts at `c28ce6c`, timings against the live host).

### What a cold first load costs, and where it goes

The corpus is **740 element files, 15.3 MB**, and **60 indexes, 171 KB**.

In the Tauri window, with a fresh WebView2 profile (no cache, no library), choosing 5e and clicking Add on the
suggested AuroraLegacy source:

| | |
|---|---|
| Add to "14,320 elements from 740 files" | **36.7 s** |
| first 104 items of the progress count | 13.4 s |
| each further 100 items | 3.3 to 3.6 s, about 30 files a second |

Then, in the same window, with the host warm:

| | |
|---|---|
| a full load through `composeSource` into an empty in-memory cache, three runs | **4.8, 5.1, 5.2 s** |
| the transport alone: 800 files, six at a time, nothing stored | 4.35 s |
| writing 200 files and their ETags to the app's storage | 0.66 s |
| a reload from the cache the cold load wrote | **0.83 s** |

And from Node over the same host (connections reused, no CORS), the first run of the day and a warm one:

| | first | warm |
|---|---|---|
| the 60 indexes alone | 10.1 s | 1.0 s |
| everything | 23.0 s | 3.5 s |

The host sends `Cache-Control: max-age=300`: its edge keeps a file five minutes. A person adding the source for the
first time usually finds it cold, so the 36.7 s is the ordinary first load, and ADR 0050's 10.8 s was a warm one.

**Sixty of the first sixty-three requests of a load are indexes, and they are made one at a time.** `loadSource`
reads a nested index when the queue reaches it and before anything else, because the files it names are the next
batch. That is right about the dependency and wrong about the cost: every index waits for the one before it, even
when both were named by the same parent long ago. Cold, that is about 170 ms sixty times over, which is most of the
13.4 s before the first hundred items; warm, it is a second of every load.

### Which files a character's build needs

Over the thirty sample saves (docs/SAMPLE-SAVES.md), each imported, derived, and asked what it holds and what it was
offered:

| | files | size |
|---|---|---|
| **held**: files declaring an element the character has, or an item it carries | 7 to 18, median 12 | 0.4 to 1.3 MB |
| **offered**: every candidate of every open or answered choice, plus the level 1 steps | 277 to 347, median 300 | 4.6 to 7.9 MB |
| held, all thirty together | 103 | |
| offered, all thirty together | 572 | |

The gap between the two rows is the builder. A character holds a dozen files; to *choose* it, the builder has to
show every race, every class and every background, and those are everywhere:

| type a level 1 step lists | files declaring one |
|---|---|
| `Race` | 123 |
| `Background` | 98 |
| `Class` | 29 |
| `Option` (campaign options) | 4 |
| **the four together** | **251 files, 4.1 MB** |

That is before anything else the first screen reads. The Books list (ADR 0049) lists every `Source` element, which
133 files declare, 112 of them outside those 251. And **31 files carry 171 `<append>` blocks, 170 of which extend an
element in a different file**, so an element is not final until every file that might append to it is in, and 13 of
those files are outside the set too. The honest first screen of a lazy loader is **373 files, 6.4 MB: half the
corpus.** Every later decision (spells, languages, feats, a second class) would then wait on the network.

### Nothing can know what a file holds without fetching it

An Aurora index names a file and a URL. Nothing else: no type, no support tags, no ids. What might stand in:

- **The file name.** Of the 123 files declaring a `Race`, 16 have no "race" in their name or folder. 14 of the 30
  files declaring a `Spell` are not named for spells. A guess that misses a race hides it from the builder with
  nothing on screen to say so.
- **One type per file.** 555 of the 737 files that declare anything declare more than one type.
- **A manifest.** No Aurora source publishes one and the format is not Incudo's (ADR 0008). Incudo could write one
  after a full load, but a full load is the only load lazy loading would make cheaper: after it, everything is in
  the cache and a reload is 0.83 s.

And three things the engine already relies on assume every file is in: the ability score improvement options are
derived from every loaded `Class` (ADR 0035), a duplicate id is settled by load order, and appends reach across
files. An index that can miss would turn each into a question with a changing answer, and a candidate list that is
short because a file has not arrived yet looks exactly like content that does not exist. CLAUDE.md already records
what that kind of bug costs to find: no count sees it.

### So

Lazy loading would save, at most, about half of one first load per source, and only the first: a cold load's 373
files and 60 indexes are still most of its 36.7 s, and a warm one saves perhaps two seconds of five. For that it needs
an index that can miss, a builder that can wait at every decision, a first screen that guesses from file names or
waits for half the corpus anyway, and three engine rules that assume completeness. It does not pay for itself.

What does cost time and is Incudo's own is the walk: sixty requests made one after another that did not need to be.

## Decision

### 1. Partial (lazy per-file) loading is not built

The ROADMAP line is closed as measured and declined, and replaced by decision 3. `ContentLibrary` keeps building
one whole index per load. Nothing in the builder waits on content, and nothing in the engine sees an index that can
miss. ADR 0004's "a character that uses two of forty files pays for two" is withdrawn: a *save* pays for nothing (ADR
0012), and a *build* needs half of what is there.

### 2. `stream` and `download` keep meaning "when"

As ADR 0029 described them: `download` fetches when the source is added, `stream` when it is first used, and both
write through to the same cache. The Sources pane stops promising the lazy loading "that would make the difference
bigger", and says what the two settings do.

### 3. A nested index is fetched as soon as it is named

When an index is read, every index it names starts fetching at once, and so does every index those name, without
waiting for the queue to reach them. When the queue does reach one, it takes the answer already on its way. Element
files are fetched in batches as before.

**Six requests at a time is still the limit, for indexes and files together** (ADR 0029's measured politeness).
Indexes go first when a slot frees up, because each one unlocks more work and the files never do.

### 4. Nothing about the result changes

The queue is walked in the same order, so indexes, elements, appends and diagnostics are applied in the order they
were before, and which file wins a duplicate id is unchanged. An index is fetched early only if the walk would have
loaded it: the same depth limit, the same `include`, the same "already loaded" check. The set of URLs a load fetches
is the same set; only when each is asked changes. A failed index is reported where it was, when the walk reaches it.

## What this does not do

- **No lazy loading, no manifest, no guessing from file names.** Decision 1.
- **The element files are not made faster.** Six at a time, about 30 a second against a cold host; that is the host.
- **Writing to the cache is not batched.** About 0.66 s per 200 files in the window, perhaps 2.6 s of a warm load.
  Worth measuring on its own if a warm load ever matters; it is not what makes a first load slow.
- **Nothing changes for a reload.** It reads the cache, and was 0.83 s.

## Consequences

- A cold first load should lose most of its first 13 seconds; a warm one about a second. Measured after it is built,
  below.
- `ContentLibrary.loadSource` holds a small limiter and a map of index fetches in flight. It is still one method, and
  the queue is still the one place order is decided.
- A request can now be in flight for an index the queue has not reached. A load that fails partway leaves those
  unread, which costs a request and nothing else.
- Phase 3's "live mode hardening" has nothing left in it.

## Alternatives considered

- **Build lazy loading anyway.** Declined above, with the numbers.
- **Guess the first screen's files from their names, load those first, the rest behind.** 16 of 123 race files would
  arrive late with nothing saying the list was incomplete; the rest are needed within minutes anyway; and a builder
  that can wait is still needed for the ones that arrive late.
- **Ship a manifest of the AuroraLegacy corpus with the app.** It would be stale the day upstream changes, which is
  what ADR 0042's moving corpus exists to live with, and it would cover one source out of any number.
- **Fetch every index before any file.** Simpler, and it leaves the files waiting on the slowest index chain; fetching
  indexes as they are named overlaps the two.
- **More than six at a time.** ADR 0029 measured twelve as two tenths of a second faster warm, and politeness to a
  host doing this for free is the reason for six.
