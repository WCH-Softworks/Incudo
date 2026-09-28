# 0069 — What a description embeds is shown in place, and a save carries it for its text

**Status:** Accepted · 2026-09-28 · closes the gap [0068](./0068-a-character-may-keep-content-beside-it-as-a-reference-shown-and-embedded-and-never-held.md)
names · builds on [0005](./0005-aurora-import.md), [0012](./0012-self-contained-saves.md),
[0042](./0042-the-tests-read-the-current-official-corpus-and-a-moving-corpus-fails-only-what-must-hold-against-any-corpus.md),
[0046](./0046-preparing-spells-is-a-recorded-list-per-casting-block-and-the-rest-is-derived.md),
[0053](./0053-a-content-browser-searches-everything-loaded-and-groups-by-what-the-system-declares.md) ·
**format:** none. `content.json` of a save written after this carries more elements; `character.json`, the system format
and every `formatVersion` are unchanged

## Context

Aurora writes `<div element="ID_…" />` inside a description where another element's text belongs. ADR 0068 found every
one of the 63 prose stat blocks embedded that way, in the summoning spells and scrolls that call their creatures, and
Incudo showing nothing there: `apps/desktop/src/sanitize-html.ts` unwraps the empty div, as its header said it would,
"left as a visible gap rather than guessed at". The gap is in Browse, in a picker's preview and its dock, and in a kept
reference. And a save only carries what the character reaches by its rules, so an embed that did resolve against the
loaded content would open with the gap back once no source is loaded (ADR 0012).

### What the corpus holds

Measured by `tools/verify/src/description-embeds.test.ts` on AuroraLegacy/elements at `c28ce6c`, reported as `ℹ` lines
and asserting none of it (ADR 0042).

| | |
|---|---|
| markers written | **3,207**, every one in the one shape `<div element="…" />` (empty, self-closing, one attribute) |
| of them inside an XML comment | **5**: content switching an embed off (`<!-- <div element="…" /> -->`); a renderer drops the comment |
| embeds | **3,202**, in 1,273 descriptions, of 2,687 distinct ids |
| embedding types | 1,443 Archetype, 533 Magic Item, 354 Class, 228 Class Feature, 154 Background, 127 Archetype Feature, 113 Racial Trait, 105 Item, 44 Spell, and six more |
| embedded types | 1,510 Archetype Feature, 512 Spell, 393 Class Feature, 185 Magic Item, 178 Information, 113 Background Feature, 89 Racial Trait, 64 Feat, 61 Rule, 49 Proficiency, and ten more |
| resolving to a declared element | **3,200**; 2 do not, both `ID_INTERNAL_WEAPON_PROPERTY_SPECIAL_…` (the Lance and the Net) |
| nesting | 1,218 descriptions embed one level deep, 55 two; none deeper |
| circular, or embedding itself | **0** |
| embedded descriptions opening with their own name as a heading | **0**: 2,620 open with no heading, 63 with an empty one (the stat blocks), 2 with another |
| embeds right after a heading the embedder wrote | **0**; 1,072 sit directly inside a `<div class="reference">` |
| embedded elements carrying rules | 1,041 of 2,685 |

A subclass lists its features this way (the Path of the Berserker is four embeds and a paragraph), a class its table of
features, a 2024 background its origin feat, a spell or scroll its creature. Nobody writes the embedded element's name:
the marker stands for a heading and a text.

And over the thirty sample saves (`tools/verify/fixtures/saves/`), packed as the library packs them: they embed 6,714
elements; following what those elements' descriptions embed adds **23** (10 `Information`, 4 Item, 3 Feat, 2 Background
Variant, 2 Magic Item, 2 Spell), at most 3 to a save, in 16 of the 30. The rest of what they embed is already in the
save, because a subclass's features are granted to whoever takes it.

## Decision

### 1. The marker is read in `core`, where a description is used

`descriptionEmbeds(description)` (`packages/core/src/embeds.ts`) is the one reader of the marker: each `div` with an
`element` attribute, in either quote and among any other attributes, with where it stands and whether it closes itself;
an empty id is not one, and neither is one inside a comment. `embeddedElementIds(element)` lists each id once. Nothing
in `core` renders HTML or decides what an embed looks like: finding a reference to an element is the same kind of
question as finding a grant, and `collectCharacterContent` needs the answer.

**It is read where a description is used, never when content is parsed.** A `.incu` embeds parsed elements, and a field
filled at parse time would be empty on every save written before it, the lesson of ADR 0046 and ADR 0048. The frozen
importer is untouched.

### 2. The text is put in place in `packages/ui`, and then sanitized with the rest

`expandDescription(element, elements)` (`packages/ui/src/description.ts`) replaces each marker with the embedded
element's **name as a heading and its description**, its own embeds put in place the same way. The name is supplied
because content never writes it (the table above); the heading is an `h5`, the level content itself uses most for a
heading inside a description (1,052 times). That is presentation, not a reading of the rules.

The index is whichever one the caller shows content from: everything loaded, in Browse (ADR 0053); the character's view,
with an open save's embedded content in front, in a picker, its preview dock and a kept reference (ADR 0068's
`referencesState` now returns the expanded text). The result is HTML as content wrote it plus this module's few tags,
and the shell's sanitizer runs over all of it: an embedded description is content too, and the name is escaped before it
is spliced in. The panes compute nothing new; `CandidateDescription` and `ReferenceText` call the two functions.

### 3. What an embed shows when it cannot show its text

A sentence in place of the marker, never a silent gap and never a guess:

- **Naming nothing in the index**: "`ID_…`: not in the loaded content, so its text is not shown here." The id is all
  that is known of it, as for a kept reference nothing declares (ADR 0068). Two in the corpus, both upstream.
- **Circular** (an element already being shown on the way to it, itself included): its name, and "Already shown above."
  None in the corpus; a user's file (ADR 0056) could write one, and without the check the expansion never ends.
- **Deeper than four levels**: its name, and "Nested too deeply to show here." The corpus nests two; a fixed depth keeps
  a description that fans out from growing without bound.

### 4. A save carries what its elements' descriptions embed, for the text only

`collectCharacterContent` follows each embed of every element it collects, and the embedded element's own embeds. **Only
for the text**: an element reached that way alone is embedded, and its rules are not followed, because nothing holds it
and nothing derives from it. Reached by a rule as well, it is followed in full like anything else, in whichever order
the two arrive. An embed naming nothing is **not** added to `unresolved`, which the library reads as "this save uses
something that is not in your content": it is a gap in a text, and the text says so wherever it is shown.

This changes `content.json` for a character saved after it and moves no derivation: nothing seeds from what is embedded,
and a derivation reads only what it reaches. The oracle's thirty-sample table is identical before and after.

## What this does not do

- **Search what a description embeds.** Browse's description search (ADR 0053) reads the text an element writes itself.
  A feature's words find the feature, which is where they belong; a subclass is found by its own.
- **Link an embed to its element.** The heading is text. Selecting the embedded element in Browse, or opening it from a
  picker, is presentation with no measurement behind it.
- **Repair the two embeds upstream leaves dangling**, or recognise a stat block (ADR 0068 decision 3).
- **Rewrite saves already written.** One saved before this carries what its character reaches and no more; opened with no
  source, an embed its text names says it is not in the loaded content. Saving it again with the source loaded carries
  the text.

## Alternatives considered

- **Resolve in the sanitizer**, which already walks the parsed tree and meets the empty div. It is in `apps/desktop`,
  so no test reaches it (`npm test` runs packages and tools), and a React Native shell would need its own. The splice is
  plain string work and belongs where `node --test` holds it; the sanitizer stays about safety.
- **Resolve in `core`**, returning HTML. `core` would be rendering markup and choosing a heading, which is presentation
  (the layering in docs/CODE-REUSE-POLICY.md). It reads the marker and no more.
- **A structured result** (text parts and embed parts) for the pane to render with components. A marker usually sits
  inside a `<div class="reference">`, so splitting the HTML at it leaves unbalanced fragments to sanitize one by one.
- **Fill each embed when content is parsed**, or record the embedded ids on the element. The frozen importer, and the
  parse-time lesson: every existing save would lack the field.
- **Follow an embedded element's rules too**, making an embed an edge like a grant. It would put in every save what an
  embedded feature grants, reached by nothing the character holds, for text that needs none of it.
- **Report an unresolved embed in `unresolved`.** The library turns that into "items this save uses are not in the
  content you have", which an embed in a text is not.
- **The embedded text without its name.** It is what the marker literally holds, and it leaves a subclass as a run of
  unlabelled paragraphs, since no embedder writes a heading (0 of 3,202).
