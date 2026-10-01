# 0082 — A refresh compares what a character carries with what its sources load, and shows the sheet it would make

**Status:** Accepted · 2026-10-01 · built the same day · answers Phase 5's "Content has been updated — refresh?" flow · amends
[0028](./0028-sources-are-a-profile-characters-carry-an-allowlist.md) (what says a source "moved") · builds on
[0012](./0012-self-contained-saves.md), [0042](./0042-the-tests-read-the-current-official-corpus-and-a-moving-corpus-fails-only-what-must-hold-against-any-corpus.md),
[0050](./0050-an-update-check-asks-every-cached-file-and-a-refresh-keeps-what-it-cannot-reach.md),
[0054](./0054-when-two-sources-define-the-same-id-the-later-one-in-the-list-is-used-and-the-list-says-so.md),
[0066](./0066-the-draft-keeps-what-the-shell-held-beside-the-character.md),
[0075](./0075-a-text-export-is-the-sheet-document-written-as-markdown-that-reads-as-plain-text.md) · **format:** none

## Context

A character carries every element it uses (ADR 0012) and opens from those copies, in front of whatever its sources load
now: "nothing the character already has is silently replaced by a newer upstream copy". ADR 0028 records, per source, the
version a character was built against, and designed three states (`present`, `moved`, `missing`), of which `moved` was
to "offer a refresh". Nothing offered one, and nothing ever moved a recorded version, so a character that outlived a
source update said so for ever, or rather would have.

### What was measured

`tools/verify/src/content-refresh.test.ts` (report-only, committed before this record) imports the thirty samples against
an **older** checkout of AuroraLegacy/elements, as if saved then, packs them as the app saves them, and compares them with
today's corpus (`c28ce6c`). The older checkout is named by `INCUDO_BASE_CORPUS_INDEX`; CI has none and skips it.

| | April 2026 (`87e8dfa`) | August 2024 (`0002b59`) |
|---|---|---|
| the index's version, then and now | 0.0.1 and 0.0.1 | 0.0.1 and 0.0.1 |
| samples a refresh would change | 29 of 30 | 30 of 30 |
| embedded elements that differ today | 81 of 6,621 (rules 54, descriptions 24) | 410 of 2,559 (rules 176, descriptions 115, requirements 65, sheet 54, supports 44, multiclass 33, names 20) |
| embedded elements today's content lacks | 41 | 27 |
| held elements a refresh would add / take away | 120 / 0 | 68 / 0 |
| derived stats a refresh would move | 0 | on 8 samples (an armour class 15 to 16, a Dexterity 17 to 18, skills doubling, a Thieves' Tools proficiency gone) |

What the differences are: a weapon proficiency that now grants eight firearm proficiencies; a Paladin's Sacred Oath that
now grants Channel Divinity; an id whose typo was fixed upstream (`…LASTER_PISTOL`, gone, and `…LASER_PISTOL`); Aurora's
save-only markers (`ID_INTERNAL_MULTICLASS_LEVEL_N`, which no corpus declares). A character opened today keeps its old
copies, so it holds none of the new grants; nothing tells its user.

So: **the recorded version says nothing** (AuroraLegacy's index has been 0.0.1 since 2023, ADR 0050), the content does,
and a refresh has real consequences that a user should see before taking them.

## Decision

### 1. A character has content updates when what it carries differs from what its sources load

The open character's embedded elements are compared, id by id, with the loaded content's: an element **differs** when the
loaded content defines the same id differently (the whole definition, where it came from left out, as ADR 0054 compares
two sources' definitions), and is **kept** when the loaded content does not define it. The recorded version is not
consulted; ADR 0028's three states stay, as provenance shown on a library card, and `moved` no longer means "offer a
refresh".

It is asked **only of the character on screen**, with content loaded. Listing the library reaches for no content (ADR
0027) and stays so: a card cannot know what a refresh would change without loading the sources, and a card that loaded
them would break the one property the library is built on.

### 2. The offer is a line, and the review is the sheet it would make

While the open character's copies differ, the Build and Sheet panes say so in a line ("Your sources have changed N of the
elements this character was saved with.") with **Review…**, and "Review content updates…" is a command (File menu, live
on Build and Sheet then). Nothing changes until the user presses **Refresh** in the review. **Not now** hides the line
for this character until its content or the sources change.

The review shows, in words: which elements changed (by name), which are kept as saved because the sources no longer
define them, and **what the Sheet would show differently**: every row whose value would change ("Armor Class 15 → 16")
and every element a section would list or stop listing, by section. It is computed from the sheet document (ADR 0075),
built twice, as the character opens now and as it would refresh, so what the review says is what the Sheet would then
show and nothing else: a derived number no sheet shows is not news to the user.

### 3. A refresh puts today's definitions in place of the copies, and keeps every copy they lack

Every embedded element the loaded content defines is replaced by its loaded definition; every one it does not define is
kept as saved, so a refresh never loses content (a save-only marker, an element upstream removed or renamed: a choice
naming it still resolves). The character's choices, rolls and everything else it records are untouched. The recorded
sources are brought up to the profile's names and versions (`refreshSourceRefs`): the deliberate move ADR 0028 left for
this flow.

It is all or nothing. Rules interlock (a feature's grant reads another's stat), so a refresh of some elements and not
others would make a character no source ever described. It changes the working character and its embedded content, as an
open does (so the draft keeps it, ADR 0066), and **the file only on Save**: until then, opening the file again is the undo.

## Consequences

- An old character can see, and take, what its sources fixed since, and is told so; it is never changed behind its back.
- The review costs two builds of the character's sheet, asked on Review, not on every change; noticing that something
  differs costs a comparison of a few hundred definitions, once per open and per load.
- A library card still cannot say "updates available". Accepted: it would need the sources loaded to know.
- A refreshed element that today's content reaches by a renamed id is listed twice in the review: the old one kept, the
  new one gained. That is what happened upstream.

## Alternatives considered

- **Compare versions** (ADR 0028 as designed). The index's version has not moved since 2023 while hundreds of elements
  did; per-file `<update version>` blocks are optional and unread. It would offer nothing, or offer on a number nobody
  bumps.
- **Refresh per element.** Interlocking rules make partial refreshes characters no source describes.
- **Refresh silently on open.** The opposite of ADR 0012 and 0028's promise; a derived armour class would change under
  the user.
- **Show every derived stat that moves.** Hundreds of internal stats exist that no sheet shows; the Sheet is what the user
  knows the character by, so the review speaks its terms.
- **A badge on library cards.** Needs content at listing, which the library deliberately never reaches for.

## Evidence

| what | held by |
|---|---|
| the samples saved against an older corpus, compared with today's: versions, differing and missing elements, what a refresh changes | `tools/verify/src/content-refresh.test.ts`, report-only before this record, with `INCUDO_BASE_CORPUS_INDEX` |
| no sample saved against today's content is offered a refresh, an element only the save has counting as kept | `tools/verify/src/content-refresh.test.ts`, against any corpus |
| what changed and what is kept, the content a refresh leaves, the offer's count, the review built from two sheets (rows and listed elements, removed ones included) | `packages/ui/src/content-refresh.test.ts` |
| recorded sources brought up to the profile, a ref the profile no longer has kept | `packages/content/src/profile.test.ts` |
| the command: live on Build and the Sheet while there are updates, not during a load or behind a dialog | `packages/ui/src/commands.test.ts` |

Each test was checked by breaking what it holds: comparing where an element came from, reading a kept copy as changed,
dropping kept copies from a refresh, building "before" with the sources in front, leaving removed elements out of the
review. The corpus test first compared against the corpus with the save's own generated elements layered in, which the
app's loaded content never has, and did not notice a kept copy read as changed; it compares against the corpus alone.

**Driven in the browser build** (headless Edge on the dev server, every click injected over the debug port, an
origin-private folder as the library, today's AuroraLegacy added from the Sources pane's suggestion and loaded from
GitHub, 14,320 elements). Two samples packed against the April 2026 checkout: the one with no difference showed no line;
the Paladin/Sorcerer showed "Your sources have changed 5 of the elements this character was saved with." on Build and the
Sheet. Its review listed Channel Divinity added to Features & Traits and eight firearm proficiencies to Proficiencies, the
five changed elements by name, and the save-only multiclass marker and the old `Laster Pistol` proficiency as kept.
Refresh listed Channel Divinity and the Laser Pistol proficiency on the Sheet, removed the line and said to save. A page
reload kept the refreshed character (no line, content loaded); reopening the unsaved file offered the refresh again (the
undo); refreshed and saved, the file reopened with no line. Not now hid the line on both panes until the character was
opened again. Not in the Tauri window, which this flow has nothing particular to.
