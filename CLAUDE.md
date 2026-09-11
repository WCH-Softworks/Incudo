# Incudo — working notes for Claude Code

A system-agnostic tabletop character builder for desktop and mobile. Free, MIT, open source.
A replacement for the discontinued Aurora Builder that reads its entire content ecosystem.

**Read first:** `ROADMAP.md`, then `docs/ARCHITECTURE.md`, then the ADR whose number a task
cites. `docs/adr/README.md` is the index. The ADRs record *trade-offs*, not just choices —
when something here looks odd, the ADR usually says why.

## Commands

```bash
npm install            # ~8s. If it starts pulling Expo, apps/* got added to workspaces — don't.
npm run typecheck      # tsc --build --force
npm test               # node --test, no build step
npm run incudo -- --help   # the CLI: validate | types | inspect | system | content | character
npm run incudo -- validate <index-url-or-local-path> [--strict] [--json]
npm run incudo -- system validate systems/dnd5e/system.json
npm run incudo -- character show <file.incu>   # derives from the save alone — ADR 0012
npm run incudo -- aurora inspect <file.dnd5e>  # what a save contains, without importing
npm run incudo -- aurora import <file.dnd5e> <out.incu> --index <index>
npm run incudo -- aurora verify <file.dnd5e> --index <index>   # diff against Aurora's own maths
npm run fixtures:rebuild   # regenerate tools/incudo/fixtures/aelin/ after a format change
```

The real regression suite is the CLI against the full Aurora corpus. A complete Aurora install
already exists on this machine and works **entirely offline**:

```bash
npm run incudo -- validate \
  "C:/Users/gcorn/Documents/5e Character Builder/custom/AuroraLegacy.index" --aurora-folder
# 740 files, 12,058 elements (+80 generated), 0 errors, 1 unresolved, ~1.5s
```

`--aurora-folder` resolves files the way Aurora's downloader stores them (a folder per index,
files by `name`); `--local [--root DIR]` resolves them by repository path, for a git checkout.
They are different layouts — see docs/AURORA-FORMAT.md. Do not use one for the other.

Add `--offline` to make that enforceable. `LocalMirrorFetcher` falls through to the network
when a file is not in the mirror, which is right for a partial mirror and quietly wrong
everywhere else: an "offline" run that silently fetches proves nothing. With `--offline` a
miss is a named error giving both the URL refused and the mirror path checked. The command
above passes all 740 files with `--offline`, so that corpus really is complete.
Eight real Aurora saves sit beside it as `*.dnd5e`. They stay **local and out of the repo**:
read them for verification, never commit them or their contents.

## Hard constraints

**No TypeScript syntax Node cannot strip.** No parameter properties
(`constructor(private readonly x: T)`), no `enum`, no `namespace`, no decorators. Write the
field and assign it. This is why tests and the CLI run with zero build step — do not trade it
away. Relative imports use the `.ts` extension; `tsc` rewrites them on emit.

**Layering** (`docs/CODE-REUSE-POLICY.md`) — enforced, not aspirational:

| layer | may import | must never import |
|---|---|---|
| `packages/core` | stdlib only | anything platform-shaped |
| `packages/aurora-import`, `packages/content` | `core` | `fs`, `fetch`, `window`, Tauri, Expo |
| `packages/ui` | the above + `react` | `react-dom`, `react-native` |
| `apps/*` | everything | — |

`core` and `content` take injected `Fetcher` and `Storage`. Adding a runtime dependency to
`core`, `content` or `aurora-import` needs an ADR.

**No game-specific nouns in `core`.** If you are about to write `strength`, `spell` or
`armor class` outside a test fixture, you are in the wrong package. Element types and stats are
opaque strings declared by `systems/<id>/system.json` (ADR 0003).

**Characters store choices, never derived numbers** (ADR 0006) — with two exceptions, both
inputs with no formula: recorded random results (`rolls`, ADR 0007) and starting values the
user set (`baseStats`, ADR 0014). `baseStats` is a *base* that contributions add to;
`overrides` wins over everything and is a repair tool, not a place to put ability scores.
`inventory` (ADR 0024) is an input of the same family — what the user is carrying, which no
formula produces — and it is a list of instances rather than a set of element ids.

**A save must open with zero content sources** (ADR 0012). `.incu` is a zip embedding the
element subset the character uses, plus assets as real bytes. This is the product requirement,
not an optimization — if a change makes a save depend on configured sources to open, it is wrong.

**Aurora is import-only and frozen when done** (ADR 0008). No export. No speculative support.

**Nothing is ever published to npm.** Every package stays `"private": true`. The `@incudo/`
prefix is a local workspace naming convention, not a registry claim — the app is the product,
and the packages exist to organise it. Do not add `publishConfig`, a release workflow, changesets,
or per-package versioning, and do not remove `private`. If someone else claims the `@incudo` npm
scope, that is fine and changes nothing here.

That does **not** mean nothing is a public API. Two things are, and they need real versioning
discipline: the **system definition format** (users author these — ADR 0011) and the **`.incu`
save format** (users' own files — ADR 0012). Both carry `formatVersion`. Package versions do not
matter; those two do.

**Never generate artwork.** No AI-generated images, logos, icons, textures or sample art, not
even as a temporary placeholder. This is a stated project commitment in the README, not a
preference. If a visual asset is needed, leave a clearly-marked gap and say so — do not fill it.
Diagrams drawn in code (SVG, Mermaid) and UI built from CSS are not artwork and are fine.

## Baselines that must not regress

Content corpus: **740 files · 12,058 elements (+80 generated) · 0 errors · 1 unresolved
reference · 23 unmeetable requirements · 57 warnings.**

- **1 unresolved reference** — one upstream typo, `…VULNERAILITY…`. This is a *grant* to an
  id nothing declares, which means a character silently loses something. It is the only one
  left in 12,058 elements, and it should be 0 the day AuroraLegacy fixes the spelling.
- **23 requirements that can never be met** — reported, deliberately **not** budgeted. A
  requirement naming an id nothing declares is a membership test that reads false, and
  `!ID_X` against an id that will never exist is how the corpus says "unless the 2024
  replacement is in play". Five of the six `KNOWN_UPSTREAM_TYPOS` live here.
- **80 generated elements** — what Aurora's app materializes at runtime, supplied by
  `packages/aurora-import/src/generated-elements.ts`. Not counted in the 12,058, because
  they do not come from a file.
- **57 warnings** — 56 `<grant>` elements with no id, and one id defined in two files.

This used to read "57 unresolved references, 57 warnings, equal by coincidence". Both halves
of that changed: the overlay resolved 51 of them, and splitting grant references from
requirement references separated one real breakage from twenty-three deliberate ones. The
coincidence is gone; do not go looking for it.

CI enforces this as a **budget, not a target**: `validate` takes `--max-unresolved`,
`--max-warnings`, `--expect-files` and `--expect-elements`, and the numbers live in
`.github/workflows/ci.yml`. Moving one is a deliberate edit to that file. The `--expect-*`
pair is not redundant — a corpus that failed to check out loads nothing, and nothing has no
unresolved references.

Aurora saves: **all 9 import; 1 element-missing, 0 spell-missing, 0 stat-mismatch**, and
**53 element-extra**, with **51 not-modelled** and **13 content-missing** reported and not
counted. All **8 recorded spell slot rows are compared and agree** since ADR 0018 — they used
to be 8 of the not-modelled notes, which is where 59 became 51. Since ADR 0020 the **7 save
DC rows and 7 attack rows** are compared against stats Incudo publishes rather than against a
formula the verifier owned; the eighth pair is the Tome of Clear Thought wizard, and it was
already one of the not-modelled notes, so no count moved.
The eight original saves are single-classed and contribute 52 of those
extras, all one species — content AuroraLegacy added *after* those saves were written,
confirmed against upstream commit dates.

The ninth was built to be the multiclass oracle the other eight could not be (level 20
Paladin 2 / Warlock 18, two `<magic>` blocks). It accounts for the rest: one extra, a
darkvision grant that post-dates it, and the single **element-missing** —
`ID_INTERNAL_MULTICLASS_LEVEL_3`, an Aurora-app marker referenced by nothing in the 740
files and carrying no rules. That one is honestly unmodelled rather than budgeted; inventing
a rule for it would be the guess ADR 0005 rules out.

`incudo aurora verify` classifies all of them; see docs/AURORA-SAVE-FORMAT.md. Those files
are personal data and never enter the repo — and neither do screenshots of them.

## State of play

Working: core engine, Aurora content **and save** importer, content sources, CLI, two system
definitions, the `.incu` container, the JSON Schemas and the validator behind them.
Not started: both app shells (only their `platform.ts` contracts exist).

ADRs 0007, 0009, 0012, 0014, 0015, 0016, 0017, 0018 and 0024 are implemented, and **Phase 1 is done — `packages/aurora-import`
is frozen to bugfix-only** (ADR 0008). `GameSystem` declares `characterKinds[]`, each owning its
`buildSteps`, `sheet`, element types, baseline `grants` and `progression`
(level | rating | xp | none); `Character` has `kind`, `progress`, `rolls`, `baseStats`,
`advancement`, `generation`, `inventory` and `assets`. A `.incu` is a zip of `manifest.json` + `character.json` + `content.json` + `assets/`,
readable and writable as an unpacked folder too, and `incudo character verify` proves a save
re-derives identically with zero sources configured.

Three things Phase 1 changed that are easy to trip over:

- **A character kind carries a baseline.** `kind.grants` plus `progression.elementIdPattern`
  give every character elements nobody chose — the 5e base armour class, one `ID_LEVEL_N` per
  level. They are *not* stored on the character, so `collectCharacterContent` needs the kind
  passed in or the save will not embed them and ADR 0012 quietly breaks.
- **`packages/aurora-import` supplies 80 elements no content file declares.** The 5e system
  definition names seven of them in `kind.grants`. That coupling is deliberate — 5e content in
  this project *is* Aurora content — but it is why a missing kind grant warns rather than errors.
- **Four Aurora constructs were being silently dropped**: element-level `<supports>`
  (3,611 blocks — *every* support tag in the corpus), element-level `<requirements>` (1,845),
  `<append>` (171), and — found later, fixed by ADR 0021 — `equipped=` (79, none of which is
  `"true"`, all read as `false`). Every one was found by counting what the corpus contains
  rather than by reading the format. See docs/AURORA-FORMAT.md.

**The builder has no current step** (ADR 0017). `CharacterBuilder` publishes `decisions` — one
flat, always-current list — and `steps` is a grouping with `available`/`blockedBy`, not a
sequence to walk. There is no `goToStep` and no Back button; `focus()` is presentation and
nothing depends on it. A decision opened at level 4 arrives in the same list as every other.
`Character` gained a sixth input, `generation`, recording which method a budgeted step used.

**Hit points are the one number no oracle checks** (ADR 0019). Aurora's saves record the
per-level rolls and never the total, so `aurora verify` has nothing to diff. Do not describe
`hp` as verified; it is derived from the published rule and from the rolls, and that is all.

Two things ADR 0018 added that are easy to reach for wrongly:

- **A `table` expression, and `trackStats` on a character kind.** `trackStats` is the piece
  ADR 0015 stopped one step short of: for every track the character has, if `when`'s element
  is in that track, contribute `value` to `stat`, with `track:progress` reading that track's
  own count and `{name}` in `stat` making it per-track instead of an aggregate. Reach for it
  whenever the answer is "once per class" and the system cannot name the classes — hit points
  are the next one.
- **Content already declares a great deal of what looks missing.** Every casting class in the
  corpus ships its own slot table as level-gated `<stat>` rules, and its weighting as a marker
  grant. Before modelling a number Aurora computes, grep the 740 files: twice now the answer
  has been "content says it and Incudo was not reading it".

**A `select` pool is keyed on (element, name), not on the rule.** Aurora writes a growing
allowance as several same-named `<select>`s, one per level that widens it — a warlock's
cantrips are `number="2"` at level 1 plus one each at 4 and 10 — and the allowance is their
sum. The importer has always keyed a `Choice` that way (`<owner>/select:<name>`, the only key
`setChoice` and a builder's `OpenDecision` can address); the engine used to check each rule's
own `number` against the whole list, so every imported caster reported errors it had not
earned. Do not reintroduce per-rule quotas. What is genuinely lost is which slot a pick was
made under: 89 groups in the corpus have rules that differ in `supports`, `requirements` or
`type`, so a pending pool offers the union of the candidates of the rules with room left, and
nothing checks that a recorded pick was legal for its slot. See docs/AURORA-FORMAT.md.

**`Rule.equipped` is parsed and read by nothing** (ADR 0021). It is a `RequirementExpr`, all
79 in the corpus are conditions like `[armor:none]`, and the engine does not evaluate them —
so all 79 rules still apply unconditionally. Deliberate, and measured: with no inventory
there is no `armor` stat, so `[armor:none]` reads *false* for a character wearing nothing and
`[armor:any]` reads false for one in plate, while every negation reads true. Evaluating today
costs a monk their Unarmoured Defence and an armoured fighter the Defense fighting style. It
waits for inventory; do not wire it up early.

**A bag is a list of instances, and the container embeds all of it** (ADR 0024). `Character`
gained `inventory` and `character.json`'s `formatVersion` moved to **2** — the first time it has,
after `baseStats`, `advancement` and `generation` each stayed at 1. Readers accept both. Three
things in the shape are measurements, not taste: an entry is an **instance** (one save carries two
greatswords with different enchantments, so an element-keyed bag loses a real character's items);
`slot` is an **override** and normally absent (the saves' `location` agrees with the element's own
`slot` setter 15 times out of 15); and adorners **nest** with no id of their own (Aurora gives them
none, and minting one would make an import non-deterministic). `collectCharacterContent` seeds
from every entry **including the carried ones** — that asymmetry is deliberate, because only the
*equipped* ones will seed the derivation at step 3. Nothing derives from the bag yet, and step 1
moved no baseline.

**Inventory steps 2–5 are planned, not started** — `docs/INVENTORY-AND-AC-PLAN.md`, five
steps with the evidence behind each, of which step 1 is done. Read it before touching either,
and in particular before adding an `ac` derivation on its own: `ac` is `default: 10` with nothing derived, and it stays
that way until a character can wear armour, because 64 of the corpus's AC rules are gated on
what is equipped. Two things from it worth knowing without opening it. **Equipped means derived
and carried means nothing** — 26 of 26 equipped items across the nine saves are in Aurora's
`<sum>` and 18 of 19 carried ones are not, the exception being a second instance of an element
id that was equipped elsewhere. And **no save records an armour class**, so `ac` will be the
second number after `hp` that the differential check cannot see; do not describe it as verified.

**An unattuned item contributes nothing, and says so** (ADR 0023). Decided, not yet built —
the mechanism lands with the inventory work. All 12 attunement-requiring equipped items across
the nine saves are attuned, so there is no oracle and there cannot be one; do not describe it
as verified. Two things the corpus settled that are easy to miss: adorners are separate
elements, so gating one gates the magical half and leaves the greatsword a greatsword; and
`attunement:max` is already declared by content 11 times, in both `bonus="base"` override and
unbucketed `+1` shapes, which both come out right against a base of 3 contributed in the same
bucket. The prose in `addition="by a wizard"` is display text and is never evaluated.

**Identity is embedded in a save; mechanics are not** (ADR 0022). `collectCharacterContent`
seeds from `baselineElementIds(kind, progress)`, so every element a kind grants is copied into
`content.json` and frozen there, while `system.json` is the one thing a save deliberately does
*not* embed. That is why all seven of the 5e kind's `grants` carry zero rules, and why only six
of the overlay's 80 elements carry any — all six ability score improvements, where the rule
*is* the identity. Put a game rule on an element and you have put it in every save written
before you fixed it. A kind's `contributions` is where a conditional baseline rule goes
instead, and **a system definition ships no content** — decided and closed, so do not reach
for `.incuset` when a system needs a rule.

**There are three keyings of a stat, not two** (ADR 0020). A stat is contributed to a
character, or once per *track* (`trackStats`, ADR 0018), or once per *declared block*
(`blockStats`). The third exists because the second cannot reach it: the namespace content
uses is the `<spellcasting>` block's name, and an Eldritch Knight's is `eldritch knight`
while its ADR 0015 track is `fighter`. `blockStats` substitutes `{name}` from the block and
`{anything else}` from the block's attributes — including inside a `ref`, which is how
`{ability}:modifier` becomes `charisma:modifier`. If a placeholder does not resolve, nothing
is contributed and the derivation says so.

**`aurora verify` used to mark its own homework on the save DC**, and the way it did it is
worth remembering before trusting the next agreeing number. It carried `saveDcBase: 8` and
compared its own `8 + proficiency + ability` against Aurora's `8 + proficiency + ability`.
That is real evidence about the modifier and the bonus and no evidence at all about the DC,
which did not exist. The 8 is now in `systems/dnd5e/system.json` and the check reads the
published stat. Both directions were proved live by perturbation, not by the check passing.

Two things that follow from the format work, for anyone changing this code:

- **The system format is now a public API in practice.** Breaking it again is expensive.
  `schemas/system.schema.json` is the contract; `packages/core/src/json-schema.ts` is the *one*
  validator the CLI and the app share. Do not write a second one.
- **`summarize()` in the CLI is the definition of "derived output".** The self-containment test
  compares it, so anything added to a derivation that depends on *what content is loaded* rather
  than on the character must stay out of it — candidate lists are the example.

## Conventions

- Small, focused commits. Explain what you tried that didn't work — often the useful part.
- Diagnostics over guessing: when content is ambiguous, report it, don't silently pick.
- When a decision would be expensive to reverse, write an ADR before writing the code.
