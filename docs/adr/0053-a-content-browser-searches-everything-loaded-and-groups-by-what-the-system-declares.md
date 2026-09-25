# 0053 — A content browser searches everything loaded, and groups it by what the system declares

**Status:** Accepted · 2026-09-25 · builds on [0003](./0003-system-agnostic-content-model.md) (types are the
system's), [0012](./0012-self-contained-saves.md), [0049](./0049-a-character-records-which-publications-it-is-offered-and-it-narrows-offers-only.md)
(books) and [0052](./0052-a-source-that-refers-to-content-no-enabled-source-has-is-reported-and-never-blocked.md) ·
**format:** none. It reads `browsable` on an element type, which the system format has carried since Phase 0 and
nothing has read

## Context

Phase 3 lists a content browser. Today a user sees content in two places: the builder's candidate lists, which show
only what one decision may hold, and the sheet, which shows what one character has. Nothing lets a user look through
what their enabled sources contain: whether a spell exists, which book a race is in, what a feature says before a
class reaches it.

### What there is to browse

Measured on AuroraLegacy/elements at `c28ce6c`, loaded as one source (`.corpus/`, the same content the Tauri window
downloads):

| | |
|---|---|
| elements | **14,545**: 14,316 from 740 files, 229 generated for Aurora content (ADR 0035's overlay) |
| element types | **42**: 40 the 5e definition declares, and 2 it does not (`List`, 2,258; `Level`, 20) |
| in the 14 types 5e marks `browsable` | **5,132** (Magic Item 1,841, Spell 1,079, Item 916, Feat 320, Deity 296, …) |
| in declared types not marked browsable | **7,135** (Archetype Feature 1,916, Class Feature 1,161, Grants 1,082, Racial Trait 998, …) |
| distinct names | 9,829; **2,787 names are used by more than one element** (a class in both editions, Aasimar four times) |
| with a description | 10,954; 7.2 MB of HTML, median 351 characters, 95th percentile 2,187, largest 16,021 |
| description as plain text | 5.8 MB; the only entity in the corpus is `&amp;` (198 times, in 110 descriptions) |
| descriptions holding Aurora's `<div element="ID_…">` | 1,278, rendered today as an empty gap (see `sanitize-html.ts`) |
| support tags | 10,595 on elements, 834 distinct |
| elements with no file of their own | the 229 generated ones (`origin.fileUrl` absent) |

`browsable` has been in `ElementTypeDef` and `schemas/system.schema.json` since the format was written ("shown in the
content browser as a browsable category"), and both shipped systems set it. Nothing has ever read it.

**The inline list items.** 2,258 elements are minted by the importer from a background's `<select type="List">` rows
(`<owner id>/list:<select name>/<item id>`): the personality traits, ideals, bonds, flaws and similar tables. Their
`name` is the row's sentence, they have no description, and the system does not declare their type. Whether they
belong in a browser depends on whether their text can be found any other way, so that was measured: **only 244 of
the 2,258 appear in their owner's description**, or in any other description. The other 2,014 are text a user can
read nowhere else in the app.

Each was minted with one support tag scoped to its owner and select, and the owner's select filters on exactly that
tag. So "which select offers this" can be answered from the rules alone, without reading the shape of an id:
indexing every select whose filter is one plain tag (1,404 of the corpus's 3,041 selects) takes **18 ms**, and gives
**every one of the 2,258 exactly one owner**. The same lookup answers for 1,934 other elements: 3,425 elements in all
are offered by exactly one such select, 505 by two to twenty, and 262 by more (up to 133).

### How fast a search is

A plain scan over every element, per keystroke, with the lowercased names and plain text built once:

| | Node 24 | the Tauri window (WebView2, Windows) |
|---|---|---|
| build lowercased names and ids | — | 5 ms |
| build plain lowercased description text | 84 ms | 72 ms |
| sort every element by name | 10 ms | 16 ms |
| query over names | 0.4–0.8 ms | 0.5–0.9 ms |
| query over names and descriptions | 0.5–7.0 ms | 0.6–7.0 ms |
| query over the raw HTML, lowercased per query | 10–18 ms, **and misses "shield master"**, which a tag splits | 10–17 ms |

The worst case is a short common query ("elf": 147 names, 1,346 with descriptions). An inverted index would turn
single-digit milliseconds into fewer single-digit milliseconds, and would have to be rebuilt on every load. Cold,
loading the corpus in that window took 40.5 s; the browser adds its 80 ms once per load.

## Decision

### 1. It reads everything the enabled sources loaded, and nothing a character holds

The browser is handed the index the load produced, the one the Sources pane counts. Not the character's offered view
(ADR 0049), and not the layered index a builder reads, which puts an open save's embedded content in front:

- **not per character**, because what a table switched off for one character is exactly what someone may want to look
  through before switching it back on, and because the answer to "what do my sources hold" should not change with
  which character happens to be open;
- **not a save's own content**, because that is a frozen copy of what one character used (ADR 0012), not something a
  source holds. With no source enabled the browser says there is nothing loaded, even while a character opened from a
  file is on screen.

It is read only. It takes no character and no builder, writes nothing, and never reorders what the index hands back:
the builder's lists come from the same index, in its order.

### 2. It searches names, the start of ids, and description text, by a plain scan

A query is split into words, and an element matches when every word is in the field. Results rank by where they
matched, and alphabetically by name within a rank:

1. the name is the query;
2. the name starts with it;
3. a word in the name starts with it;
4. the name holds every word;
5. the id starts with it (an id is found by typing it from its start, so "fire" does not find every `…_FIREBALL`);
6. the description holds every word, when the user has not turned descriptions off.

Within a rank, elements of the system's `browsable` types come first, then other declared types, then undeclared
ones, and each group alphabetically. The first version ordered a rank by name alone, and running it listed a
background's table row called "Elf" above the Elf races.

Description text is the HTML with its tags removed and `&amp;`-style entities decoded, built once per load, and the
row of a description match carries a short excerpt around the first word. Support tags, setters and `sheet` text are
not searched. No index: the scan is single-digit milliseconds in the window (above).

### 3. It groups by what the system declares, and types it does not declare are still found

- With no query and no type chosen, the browser offers the system's **`browsable` types** as its categories, with
  how many loaded elements each holds. That is what the field was written for.
- Any type can be chosen as a filter. The filter lists the browsable types, then every other declared type, then
  **types the system does not declare**, by the name content gives them, each with a count among the current matches.
- A type's label is the system's `plural`, falling back to its name. Nothing in the code names a 5e type.

So a search covers every loaded element, which is what the roadmap asks, and browsing without one starts from what the
system author said is worth browsing. Declaring a type `browsable` is how a system changes that; no format change.

### 4. The inline list items are in it, and say which select offers them

They are searched like anything else (2,014 of them can be read nowhere else), and their type is shown as content
wrote it. What makes one make sense is where it is offered, so an element shows **the selects that offer it** by
filtering on exactly one plain tag it carries: "Offered by Acolyte (Personality Trait)". That is read from the
rules, for any element, and never from the shape of an id. A select whose filter is anything else (an `and`, an `or`,
a `$(…)`, a negation) is not followed, and an element offered by many selects shows the first few and how many more.

### 5. Books are a filter, joined as ADR 0049 joins them

A result can be narrowed to one book. A book is a publication element (ADR 0049), matched to an element's `source`
ignoring case, and shown with the publication's own spelling; a `source` that names no loaded publication (`Internal`,
`Core`) is shown as written. The book list shows the books among the current matches, with counts.

### 6. An element says where it came from

The detail of an element shows its type, book, the content source it was loaded from (by the name the Sources pane
shows) and the file within that source, relative to the source's index. A generated element says it came from no
file. A link goes to the Sources pane. The id and support tags are shown too, plainly, since they are what a user
needs to report a problem with content or read the Sources pane's list of missing ids.

### 7. The state is a view-model in `packages/ui`

`ContentCatalog` (`packages/ui/src/content-browser.ts`) builds the searchable entries once per index and answers a
query with ranked rows, a count, type and book counts, and one page; its `describe` answers the detail. Both run
under `node --test`. The pane renders what they return, 100 rows at a time with a button for the next hundred, and
sanitizes a description only for the element being read, as the candidate picker does. It is a sixth destination,
Browse (Ctrl+5), beside Sources. What the user typed and chose is held by the shell, so it survives a look at another
pane and a reload of the content; where the columns stack (below 1,000 pixels) the element being read replaces the
list, with a way back to the same results.

## What was measured after it was built

- **`packages/ui/src/content-browser.test.ts`**, 15 tests, each checked against the perturbation it names (33 in all,
  every one failing a test). One passed at first: searching the raw HTML, because each word is matched on its own
  and both words of "shield master" were still in the markup. The test now holds that a word found only in a tag or an
  attribute matches nothing.
- **`tools/verify/src/content-browser.test.ts`**, on the official corpus, what must hold against any corpus: every
  loaded element is in the browser under its own type, counted as the index holds it and grouped as the system
  declares it, and the first element of every type is found by its name; every one of the 2,258 inline list items is
  offered by exactly the select the importer minted it for; and a fresh character's decisions offer the same
  candidates in the same order after a catalog was built and searched. That last test first ran after another test in
  the file had already built a catalog on the shared index, so an in-place sort went unseen; it runs first now, and
  sorting `byType` in place fails it. Sizes and timings are printed: 58 ms to build, 144 ms for the first query that
  reaches descriptions (the text, with entities decoded), 2 to 10 ms for a query after that.
- **In the browser build on Windows**: with nothing loaded the pane says so and links to Sources; after adding
  AuroraLegacy, 14,545 elements, the 13 browsable types that hold anything as categories, and all 42 types in the
  filter. Typing to a painted list took 16 to 67 ms, and 228 ms for the first query. "Fire" narrowed to Spells and
  then Xanathar's Guide gives 15; switching descriptions off takes "a" from 14,303 matches to 11,284; switching the
  only source off leaves the pane saying nothing is loaded.
- **In the Tauri window on Windows**, on a fresh profile: adding the source took 25.1 s; opening the pane 54 ms the
  first time and 17 ms after; a keystroke to a painted list 12 to 60 ms, and 178 ms for the first query; the next
  hundred rows 26 ms; opening Wish 23 ms. The native menu's View › Browse item, sent as a window message, opens it with
  the search box focused.
- **Running it changed four things**: the order within a rank (decision 2); the stacked layout, where the element
  being read sat above the list at 800 pixels and pushed the search box off the screen; the search being lost when
  the pane unmounted; and tags shown as plain text, where "Spell Saving Throw" read as three tags.
- **Real keys in the window**, pressed once the screen was unlocked: Ctrl+5 from the Characters pane reached the page
  as a key-down and opened Browse with the search box focused, and typing "misty step" went into it (51 matches, Misty
  Step first). Ctrl+4 then Ctrl+5 pressed with focus in that box left for Sources and came back to the same search.
- **Not done:** macOS and Linux.

## What this does not do

- **No "what grants this".** Only a select filtering on one plain tag is followed. A grant, a select on an `and` of
  tags, or one built from `$(spellcasting:list)` names its candidates in ways a reverse index would have to evaluate
  per character.
- **No filter by tag or setter.** "Spells on the Wizard list" or "3rd-level spells" would be filters over support tags
  and setter values, which are the system's and differ per type. Left until a type's browse view is designed.
- **No duplicate comparison.** Two sources defining one id is the next roadmap item, and the browser shows only the
  definition that won.
- **The `<div element="ID_…">` gaps in 1,278 descriptions stay gaps**, as they are in the candidate picker.
- **No link from the builder or the sheet into it**, and nothing on the Sources pane's list of missing ids links
  here: those ids are missing because nothing loaded declares them.
- **It is not an editor.** Nothing here writes content.
- **Rows that share a name, a type and a book look the same** until one is opened: one Unearthed Arcana book has three
  feat features called "Divine Omens". The detail shows each one's id and what offers it.

## Consequences

- A user can look through what their sources hold without building a character that reaches it.
- `browsable` is read for the first time. A system author who never set it gets no categories, and search still
  covers everything.
- The app holds a second, plain-text copy of every description while the browser has been opened for a load (about
  6 MB for the official corpus). It is built on first use, not at load.
- The builder, the sheet, the derivation and every save are untouched: the browser reads an index and writes nothing.

## Alternatives considered

- **Read the character's offered view.** Hides a switched-off book from the one place a user would look before
  switching it back on, and makes the browser's contents depend on which character is open. Rejected (decision 1).
- **Leave the inline list items out.** 2,014 of them can be read nowhere else. Rejected; their type stays as content
  wrote it rather than being declared into the 5e definition, because the browser needs no declaration to show them.
- **Show only `browsable` types.** Class features, subclass features and racial traits are 4,075 elements a user
  searching for "Sneak Attack" wants to find. Rejected: `browsable` decides where browsing starts, not what search
  covers.
- **An inverted index.** The scan is under 8 ms at worst in the window, and an index is another structure to rebuild
  on every load and to keep in step with the scan's matching rules. Rejected until a corpus makes the scan slow.
- **Name the owner of a list item by parsing its id.** The id's shape is the Aurora importer's business (ADR 0008)
  and would tie the browser to one format. The select's tag answers the same question from the rules. Rejected.
