# 0095 — A row names what moved it that the sheet lists nowhere

**Status:** Accepted · 2026-10-06 · answers ROADMAP Phase 5's "Say why a number moved when what moved it is hidden" ·
amends [0076](./0076-content-s-sheet-hints-are-read-every-description-kept-chosen-by-the-level-the-element-gates-at.md)
("What this does not do": "Tell a player why a number moved") · builds on
[0042](./0042-the-tests-read-the-current-official-corpus-and-a-moving-corpus-fails-only-what-must-hold-against-any-corpus.md),
[0074](./0074-a-kind-s-sheet-shows-its-printed-page-and-every-row-says-what-it-is.md),
[0075](./0075-a-text-export-is-the-sheet-document-written-as-markdown-that-reads-as-plain-text.md),
[0079](./0079-a-pdf-sheet-is-the-print-layout-written-to-a-file-and-the-official-form-is-the-user-s-own-copy-filled-from-the-document.md) ·
**format:** the sheet document's `SheetRow` gains an optional `including`; no system or character format change

## Context

A sheet section declaring `omitHidden` (ADR 0076) leaves out what content marks `<sheet display="false">`: the feature
list should not carry "Spellcasting", "Ability Score Improvement" or a subclass placeholder. It also leaves out Tough,
whose hit points then sit on the sheet with nothing to say where they came from, which is how Aurora's own sheet reads.
Measured first, by `tools/verify/src/hidden-reasons.test.ts` (report-only, on AuroraLegacy/elements at `c28ce6c` and the
thirty samples):

- **198 elements are left out** across the samples (99 class features, 53 racial traits, 26 subclass features, 10 feats,
  10 proficiencies), counting only what a section declaring `omitHidden` would list and no other section lists (a race is
  hidden too, and named in the Character header).
- **Of 1,399 rows, 5 are moved directly** by one of them, every one Hit Points: Tough on four samples, Dwarven Toughness
  on one. "Directly" is the derivation's own record: the row's stat's `contributions`, each naming the element it came
  `from`.
- **24 more are moved only through a formula the kind declares**: Speed by Fleet of Foot (it adds to `innate speed`,
  which `speed` derives from), and skills by Skill Expertise (9, each a row whose mark already reads "expertise"), the
  2024 Jack of All Trades (9) and the 2024 Thaumaturge and Magician (4), all through a skill's `…:proficiency` or
  `…:misc`.
- **No left-out element contributes 0.**
- **Wider, for scale:** what else moves a row and is listed nowhere is the user's base scores, the kind's own
  contributions, the casting blocks, the progression, the inventory, and the ability score improvements, whose type no
  section lists. None of those is hidden by `omitHidden`; they are not this item.

## Decision

### 1. A row names each element a section leaves out for being hidden that moved its number

`SheetRow.including` (optional, `packages/ui/src/sheet.ts`): the names of the elements that

- the sheet leaves out: held, of a type some section declaring `omitHidden` lists, `display="false"`, and listed by no
  section of this sheet;
- and moved the row: a non-zero contribution to the row's stat, or to a stat the kind's `derive` formula for it reads,
  followed through the kind's formulas.

In the order met, once each, by the name content gives the element on a sheet (`alt`, else its sheet name, else its
name), as the feature list would have named it.

**Read from the derivation, never recomputed.** A contribution's `from` is what the engine published. A formula is
followed by the names it reads (`statReferences`, core, a reader of `StatExpr` beside `readsSetter`), never evaluated, so
no number is worked out twice and a non-linear formula (a modifier) is still attributed. Names only, no amounts: an amount
through a formula would have to be recomputed.

**Kind-agnostic.** Nothing names a stat, a type or a game: the scope is what `omitHidden` leaves out, and a sheet with no
section declaring it (a stat block, a held creature's scope, every shipped NPC stat block section) names nothing.

### 2. What a shown mark reads is not followed

When a row shows a mark (ADR 0079), the mark's stat is not followed: "+7 (expertise)" already says what the hidden Skill
Expertise did, and "expertise; including Skill Expertise (Stealth)" says it twice. A mark not shown (a count of 0) does not
stop the walk.

### 3. The words are `rowAside`'s, so every renderer has them

`rowAside` (`sheet-document.ts`), the one wording of what follows a row's value, ends with "including A", "including A and
B", "including A, B and C", after what is beside the row and its mark with a semicolon, since a comma would read as one
more name:

- Hit Points: 45 (including Tough)
- Speed: 35 (including Fleet of Foot)
- Religion: +6 (proficient; including Thaumaturge)

The Sheet pane, the print layout (it is the pane), the Markdown export, the phone's sheet and the refresh review all call
it. The official form's boxes take a row's `value` and `beside`, not its aside, and are unchanged.

## What this does not do

- **Name what is not hidden.** A listed feature's contribution is already on the sheet; the base scores, the kind's own
  rules and the casting blocks are not elements; an ability score improvement is an element whose type no section lists,
  which is a different question (what a sheet should list) and not asked here.
- **Name an item the kind keeps off the sheet** (`inventory-hidden`, ADR 0072). Those are not left out by `omitHidden`;
  none of the samples' moves a row.
- **Say by how much.** Through a formula the amount is not published.
- **Follow a rule's own value.** A visible feature adding `level:half` is not traced into what moved the level.

## Alternatives considered

- **Direct contributions only.** All five Hit Points rows, and nothing else: Fleet of Foot's Speed and Jack of All Trades'
  skills would still be unexplained. Following the kind's formulas reaches them by name without recomputing.
- **List the hidden elements again, in a section of their own** ("Also held"). Puts back the placeholders `omitHidden`
  exists to remove, and still says nothing beside the number.
- **Name everything listed nowhere.** Every ability score would read "including Ability Score Improvement: Strength +1",
  and every spell row "including" its block; that is a breakdown of the number, not the reason a hidden feature exists.
- **A new field in the system format** saying which stats explain themselves. Nothing measured asks for it.

## Evidence

- `tools/verify/src/hidden-reasons.test.ts`: the measurement above, then, against any corpus, on every sample: each row's
  `including` equals what the test's own walk of the derivation finds (its own reader of the formulas, not core's); every
  left-out element contributing directly to a row's stat is named; the Markdown export writes the row's aside; and a
  sample packed and reopened with no source names the same. Now 19 rows on 9 samples name something. Perturbed, each
  failing: `nameWhatMovedRows` returning at once, the mark's stat followed (Stealth naming Skill Expertise), `derive` not
  followed (Speed), only formulas read (Hit Points), `rowAside` ignoring `including`.
- `packages/ui/src/sheet-reasons.test.ts`, a fixture with no game in it: the row's own contributions and a derived row's
  formula, the sheet name, a listed element, a hidden element another section lists, a 0 contribution and a shown mark's
  stat not named, a sheet with no `omitHidden` naming nothing, the words. Perturbed, each failing: each condition above
  removed, the element's plain name used, `rowAside` ignoring `including`.
- `packages/core/src/expression.test.ts`: `statReferences` walks every branch, once each, and names what a `:half` halves.
- The oracle is identical before and after (`INCUDO_ORACLE_SNAPSHOT` on the base, `INCUDO_ORACLE_BASELINE` on the change):
  no derivation moved.
- Driven in the browser build: samples 17 and 10 packed in Node, opened from the library with no source loaded; the Sheet
  reads "Hit Points 61 (including Tough)" and "Speed 35 (including Fleet of Foot)", and "Export sheet as text…" writes
  "- Speed: 35 (including Fleet of Foot)". Not in the Tauri window, the print dialog or the phone, which render the same
  `rowAside`.
