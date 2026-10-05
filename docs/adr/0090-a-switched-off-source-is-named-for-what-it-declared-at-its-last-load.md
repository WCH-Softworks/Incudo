# 0090 — A switched-off source is named for what it declared at its last load

**Status:** Accepted · 2026-10-05 · answers the ADR 0052 item at the end of ROADMAP Phase 3 · builds on
[0005](./0005-aurora-import.md) (diagnostics over guessing), [0028](./0028-sources-are-a-profile-characters-carry-an-allowlist.md),
[0042](./0042-the-tests-read-the-current-official-corpus-and-a-moving-corpus-fails-only-what-must-hold-against-any-corpus.md),
[0052](./0052-a-source-that-refers-to-content-no-enabled-source-has-is-reported-and-never-blocked.md),
[0055](./0055-a-source-records-the-parts-switched-off-and-the-load-skips-them.md) and
[0085](./0085-a-source-is-kept-converted-into-incudo-s-own-form-and-loaded-from-that.md) · **format:** none for characters,
systems or the source profile; two keys of the app's own storage per source

## Context

Since ADR 0052 a source's line on the Sources pane says how many things it refers to that no enabled source contains. It
never says that a source the user configured and switched off has them, which is the one answer that is not a guess:
the user added that source, and its files said what they declare. ADR 0052 left it out because a switched-off source is
not loaded, so nothing in a load knows what it holds.

### Measured

`tools/verify/src/switched-off-sources.test.ts`, AuroraLegacy/elements at `c28ce6c`, five of its indexes added as sources
of their own (Core, the 2014 Player's Handbook index Core lists, Tasha's, Xanathar's and the Supplements group), each
loaded once and then switched off in turn:

| enabled | what its line misses (ids, references and addition targets together) | switched-off sources that declared them |
|---|---|---|
| the 2014 Player's Handbook alone | 110 | Core has all 110 |
| Tasha's alone | 181 | Core has all 181; the Player's Handbook index 123 of them (Core lists it) |
| the Player's Handbook and Tasha's | 110 and 58 | Core has all of each |
| the Supplements group alone | 390 | Core has all 390; the Player's Handbook index 206 |
| Core alone | 1, the upstream typo `…VULNERAILITY…` | none, and the line says nothing more |

So for AuroraLegacy split into its parts, every missing thing but the typo is in a source the user would already have
configured, and an id is often in two of them because one index lists another.

What a record costs: the ids a source declares as JSON, 323,000 characters for Core, 297,000 for the Supplements group,
about 740,000 for the whole of AuroraLegacy. Working out the names is a set lookup per missing id; each whole load above,
records read included, took 21 to 157 ms in Node from a warm in-memory cache.

And one thing the first version would have got wrong: **a source loaded after one holding the same files reads none of
them.** Core lists the Player's Handbook index, so with both enabled the book's own line reads "0 elements from 0 files"
(the library loads each URL once, ADR 0051). A record made from what the load read would say the book declares nothing,
and the book would be named for nothing the day Core is switched off. Seen in the app as well: Core added behind
AuroraLegacy read 0 files and its record still names it for all 110.

## Decision

1. **After each load that succeeds, a source's record is kept: the ids its files declare, and the parts it had switched
   off.** The ids are those of every element file its indexes reach, by the load's own `include` (ADR 0055) and depth,
   **whichever source's load read the file**: `ContentLibrary` keeps each loaded index's list and each file's ids, and
   `LoadReport.declared` walks them again from the source's root without the "already loaded" check. The elements Incudo
   generates for Aurora content (ADR 0035's overlay) come from no file and are not in it.

2. **Stored beside the profile, not in the cache:** `sources/declared/<source id>` as `{ formatVersion: 1, excluded, ids }`,
   and a short signature of that text under `sources/declared-signature/<source id>`. Not under `content/<source>/`, where
   ADR 0085 asked whether it should sit beside the conversion: a refresh prunes every key there it did not touch and an
   eviction removes all of them, and neither changes what the source declared at its last load. A source kept as files
   (ADR 0085) and a file the user added (ADR 0056) get a record the same way. The signature is compared before writing, so
   a load whose record has not changed writes nothing: a phone's storage measured slow with large values (ADR 0085's 20 s
   read of one 21 MB value). `removeSource` removes both keys.

3. **A record is read only when it can be trusted, and only when it can matter.** Only when some enabled source misses
   something, and only for the sources the caller says are switched off (`loadSources`' new `switchedOff` option; the
   desktop passes the current system's, never another system's). A record made with other parts switched off than the
   source has now is not read: it would name a part no longer loaded, or miss one switched back on. A source never loaded
   has no record and is named for nothing.

4. **The line names each switched-off source that has some of it, with how much, and says it is the last load being
   described:** "Core, which is switched off, had all of them when it was last loaded." In the profile's order, each
   expandable to its ids. An id two of them declare is under both, because both do; which to switch on is the user's
   decision. Nothing is switched on, nothing is blocked, and an id no record holds is under no name. The words are
   `missingNote` in `packages/ui/src/source-notes.ts`; the pane computes nothing.

## What this does not do

- **It does not name a source the user has not configured**, or one of another system. A record is of a source in this
  profile.
- **It does not say a record is out of date.** Upstream may have changed a switched-off source since it was last loaded;
  the sentence says which load it describes, and loading the source makes a new record.
- **The phone does not pass `switchedOff`**, because it shows no missing content yet; its loads write records like the
  desktop's.
- **A part another source's load skipped is not in a record.** If two enabled sources reach one nested index with different
  parts switched off, the second's record holds only the files the first loaded. Not seen in any configuration measured.
- **Requirements are still not counted** (ADR 0052 decision 1).

## Evidence

- `packages/content/src/declared.test.ts`: a switched-off source named for what it declares; one loaded after Core still
  recording its files; an id under two sources in profile order and a source declaring none left out; an addition's
  target named and an id nothing declares under no name; a source never loaded, or recorded with other parts, named for
  nothing; nothing read without `switchedOff`; a record written once and not again until it changes; removal. Seven
  perturbations (no record written, a record from what the load read, stopping at the first source, additions left out,
  the parts not compared, no signature check, removal not removing) each fail a named case.
- `packages/ui/src/source-notes.test.ts`: the wording, and an id that is both a reference and an addition's target counted
  and listed once.
- `tools/verify/src/switched-off-sources.test.ts`: asserts, against any corpus, that each record is what its source
  declares loaded alone, and that a line names under each switched-off source exactly what that source declares of what
  the line misses; reports the table above.
- **Driven in the browser build** (2026-10-05): AuroraLegacy, Core and the 2014 Player's Handbook index as three sources,
  the first two switched off: the book's line reads "Refers to 110 things none of your enabled sources contain, and 2 of
  its additions to other content have nothing to add to", then "AuroraLegacy, which is switched off, had all of them when
  it was last loaded" and the same for Core, whose record was made while it read 0 files behind AuroraLegacy. The profile
  was put back afterwards. Running it found one thing: the 2014 Player's Handbook grants the two armour proficiencies it
  also appends to, so the combined list repeated them (React's duplicate-key error); each id is listed once now. Not driven
  in the Tauri window (the pane is the same component), on the phone, or on macOS or Linux.
- Seen while driving and **not** changed here: switching two sources off in quick succession starts two loads, and the
  slower first one can finish last and leave the pane showing its result (a switched-off source "loaded") until the next
  reload. That is the desktop's `reload` in `App.tsx`, older than this.

## Consequences

- A user who added AuroraLegacy's books one by one and switched Core off is told, on the book's line, that Core has what it
  misses.
- Each source costs one more stored value the size of its id list, written once per change.
- The day a switched-off source's upstream changes, its line may name it for a load that no longer matches upstream, and
  says so in "when it was last loaded".

## Alternatives considered

- **Read the switched-off source's conversion** (ADR 0085) instead of a record. 20 MB for AuroraLegacy, read on every load,
  and nothing at all for a source kept as files.
- **Load switched-off sources quietly.** Their content would reach the builder's offers, which is what switching off is for.
- **Keep the record under the cache prefix.** A refresh's prune and an eviction would remove it (decision 2).
- **Store the ids in the profile.** One small document everyone reads at boot would grow by megabytes.
- **Name only the first source that has an id.** Picks for the user between two sources that both have it.
