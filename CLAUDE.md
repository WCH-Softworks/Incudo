# Incudo — working notes for Claude Code

A system-agnostic tabletop character builder for desktop and mobile. Free, MIT, open source.
A replacement for the discontinued Aurora Builder that reads its entire content ecosystem.

**Read first:** `ROADMAP.md`, then `docs/ARCHITECTURE.md`, then the ADR whose number a task
cites. `docs/adr/README.md` is the index. The ADRs record *trade-offs*, not just choices —
when something here looks odd, the ADR usually says why.

## Commands

```bash
npm install            # ~25s. If it starts pulling Expo, apps/mobile got added to workspaces — don't.
npm run desktop        # the app, at http://localhost:5173. No Rust, no icon, start here.
                       # Opens on the character library; pick a folder to see anything in it.
npm run desktop:app    # the real Tauri window — needs Rust. Builds now; the icon arrived.
npm run typecheck      # tsc --build --force
npm run corpus:sync    # fetch/fast-forward the official AuroraLegacy/elements into .corpus/ (gitignored)
npm test               # node --test, no build step. Includes the real-content suite below once
                       # `.corpus/` exists; without it those tests skip and say to run corpus:sync.
npm run fixtures:rebuild   # regenerate tools/verify/fixtures/aelin/ after a format change
```

**There is no CLI, and none should be added**
([ADR 0039](docs/adr/0039-the-cli-is-removed-and-what-it-measured-becomes-tests.md)).
`tools/incudo` and `npm run incudo` are gone. The folder is `tools/verify` (`@incudo/verify`): tests
and the Node adapters they stand on, none of it shipped. If you want to ask the engine a question,
write a test. When an older ADR or note says to type `incudo …`, the table in ADR 0039 says what
replaced it. This file and the ADRs still call the nine-save differential check **`aurora verify`**,
after the command that ran it; it is `aurora-oracle.test.ts` now.

**No test names a machine, a path or a person.** The real-content tests read **the current official
repository**, AuroraLegacy/elements, from `.corpus/` at the repository root: `npm run corpus:sync`
fetches it, CI checks the same repository out into the same place with no `ref:` so it is always its
head, and a daily schedule catches an upstream change while this repository is quiet
([ADR 0042](docs/adr/0042-the-tests-read-the-current-official-corpus-and-a-moving-corpus-fails-only-what-must-hold-against-any-corpus.md)).
A green run means "works with today's official content". Nothing depends on anyone's Aurora install,
which updates itself while it is open and is read by nobody else. With no `.corpus/` the tests that need
it skip and say to run `corpus:sync`; **an environment variable that names something that is not there
fails.** `INCUDO_AURORA_INDEX` (with `INCUDO_CORPUS_LAYOUT` and `INCUDO_CORPUS_ROOT`) still points a run
somewhere else, and CI sets it so that a missing checkout is a failure and not a skip; put a value in an
untracked `.env.local` that `npm test` reads (copy `.env.example`), never in a committed file. Never put
a path, a username or a character name in a committed file or a commit message: history is permanent,
and one such path already got in and stayed. `tools/verify/src/real-data.ts` is the one place that
reads the variables.

```bash
npm run corpus:sync    # once, and again whenever you want today's content; prints the commit it ends at
node --test --experimental-strip-types tools/verify/src/corpus.test.ts
node --test --experimental-strip-types tools/verify/src/aurora-oracle.test.ts   # needs saves, below
```

Both print their numbers as `ℹ` lines, beginning with the corpus commit; the variables are listed in
`tools/verify/README.md`. What the pipeline runs and what it cannot is the next section's subject.

- **Two layouts.** `repository` (what a `.corpus/` checkout is, and what CI and a default run read)
  resolves files by repository path, from the URL path after the ref. `aurora-folder` resolves them the
  way Aurora's downloader stores them (a folder per index, files by `name`) and is now only the way to
  point a run at an Aurora install: nothing committed runs it against a real one, so a small test builds
  one in a temp folder. They are different layouts — see docs/AURORA-FORMAT.md. Do not use one for the
  other. **The `repository` layout was first run against a real clone on 2026-09-21** (AuroraLegacy/elements
  at c28ce6c): it loads it with no change to the loader.
- **Always offline.** `LocalMirrorFetcher` falls through to the network when a file is not in the
  mirror, which is right for a partial mirror and quietly wrong everywhere else: an "offline" run
  that silently fetches proves nothing. `corpus.ts` gives it `OfflineFetcher` as the fallback, so a
  miss is a named error giving both the URL refused and the mirror path checked. The corpus above
  passes all 740 files that way, so it really is complete.
- **Skip when nothing is configured; fail when something is.** `node --test` reports a skip as
  green, so once `INCUDO_AURORA_INDEX` is set, a missing path fails. A checkout that did not happen loads
  nothing, and nothing has no unresolved references. The saves have the same guard:
  `INCUDO_REQUIRE_SAVES=1`, which CI sets, turns an empty saves folder from a skip into a failure.

**The saves are `tools/verify/fixtures/saves/`**: thirty generic sample characters built in Aurora to
docs/SAMPLE-SAVES.md's plan, committed, and read by every real-save test, in CI too. They are anonymous by
construction (`sample-saves.test.ts` fails on a portrait, a path, a player name, an exclusion list or a
name that is not `Sample NN`), and `manifest.json` says what each one *is*: its class split, edition,
campaign options, and what the maintainer read off Aurora's screen for it. **A test finds a sample by what
it is (`samplesWhere`), never by file name, position or count.** A person's own saves stay local and out
of the repo, and there is no variable to point a test at them: a test that read one would run on one
machine. Aurora writes a portrait, a path with the account name in it and a megabytes-long list of
disabled sources into every save, so **a new sample needs the same cleaning the first thirty got** before
it is committed.

**A test never asserts how many saves there are, or where one sorts.** It said `saves: 9` and totals
over the folder, so adding a character failed it and said nothing about the character.

**A moving corpus fails only what must hold against any corpus** (ADR 0042). The saves are frozen and the
corpus is today's, so the table of differences moves whenever upstream does, and a pinned count teaches
everyone to update pins. What fails, per save, is `oracleViolations`: it imports, 0 `stat-mismatch`,
0 `spell-missing`, every `element-missing` is an Aurora-app marker (`ID_INTERNAL_MULTICLASS_LEVEL_N`, the
whole allowlist), and no recorded spellcasting row went uncompared. Everything else (`element-extra`,
`content-missing`, `not-modelled`) is printed per save beside the table recorded when it was last
understood, as a `MOVED` line, and fails nothing. **What that loses:** an engine change that over-grants a
few elements no longer fails a pin. `INCUDO_ORACLE_SNAPSHOT=<file>` writes a run's differences and
`INCUDO_ORACLE_BASELINE=<file>` fails on any difference from one: snapshot on the base, baseline on your
change, same checkout, and only an engine change can move it. `builder-rebuild.test.ts` and
`rogue-wizard-aurora.test.ts` find a save by what it is, a class split, not by name.
`INCUDO_ORACLE_DETAIL=1` adds every difference message to the report, and those name content (elements,
spells, stats), never a character.

## Hard constraints

**No TypeScript syntax Node cannot strip.** No parameter properties
(`constructor(private readonly x: T)`), no `enum`, no `namespace`, no decorators. Write the
field and assign it. This is why the tests run with zero build step — do not trade it
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
and the packages exist to organise it. Do not add `publishConfig`, an npm publish step, changesets,
or per-package versioning, and do not remove `private`. If someone else claims the `@incudo` npm
scope, that is fine and changes nothing here.

The one release workflow that does belong here builds the desktop installers and attaches them to a
GitHub Release (ROADMAP Phase 9). It does not exist yet and is added by the commit that cuts the
first release candidate, not before.

That does **not** mean nothing is a public API. Two things are, and they need real versioning
discipline: the **system definition format** (users author these — ADR 0011) and the **`.incu`
save format** (users' own files — ADR 0012). Both carry `formatVersion`. Package versions do not
matter; those two do.

**Never generate artwork.** No AI-generated images, logos, icons, textures or sample art, not
even as a temporary placeholder. This is a stated project commitment in the README, not a
preference. If a visual asset is needed, leave a clearly-marked gap and say so — do not fill it.
Diagrams drawn in code (SVG, Mermaid) and UI built from CSS are not artwork and are fine.

The one gap this ever blocked is now filled by a person: `brand/` holds the real logo, and
`apps/desktop/src-tauri/icons/` is generated from it with `npx tauri icon`. **Downscaling and
re-encoding supplied art is not generating it**, and neither is deleting the mobile and
Windows-Store variants that command also writes. Compositing the glyph onto a coloured tile
*would* be a design decision, which is why it has not been done and is named as an open one
instead — see that directory's README. The two source PNGs were re-encoded on the way in (4.67 MB
each, stored uncompressed, down to 24 KB and 14 KB) and the decoded pixels are byte-for-byte
what was supplied.

## Baselines that must not regress

Content corpus: **740 files · 14,320 elements (+229 generated) · 0 errors · 1 unresolved
reference · 23 unmeetable requirements · 57 warnings.** Measured on AuroraLegacy/elements at
`c28ce6c` (2026-09-19), the first real clone the `repository` layout was run against. The corpus is
today's and moves; these are the record of a moment (below).

- **1 unresolved reference** — one upstream typo, `…VULNERAILITY…`. This is a *grant* to an
  id nothing declares, which means a character silently loses something. It is the only one
  left in 14,320 elements, and it should be 0 the day AuroraLegacy fixes the spelling.
- **23 requirements that can never be met** — reported, deliberately **not** budgeted. A
  requirement naming an id nothing declares is a membership test that reads false, and
  `!ID_X` against an id that will never exist is how the corpus says "unless the 2024
  replacement is in play". Five of the six `KNOWN_UPSTREAM_TYPOS` live here.
- **229 generated elements** — what Aurora's app materializes at runtime, not counted in the
  14,320 because they do not come from a file. 83 are the fixed overlay in
  `packages/aurora-import/src/generated-elements.ts` (it was 80 until the importer started
  reading `<equipment>` and found three more that only a *bag* names, ADR 0024's step 2), and
  **146 are the ability score improvement options**, derived from whatever content is loaded by
  `improvement-options.ts` (73 class-and-level pairs, an ASI option and a feat option each —
  ADR 0035). The second kind depends on what is loaded, so the total is a property of the corpus
  and not of the code.
- **2,258 of the 14,320 are synthesized from inline text, not from an `<element id="ID_…">`
  tag** — a background's suggested Personality Trait, Ideal, Bond and Flaw, and a handful of
  similarly-shaped tables (Trinket, Specialty, …). Aurora writes these as a `<select
  type="List">` whose candidates are `<item id="1">…text…</item>` children carrying small
  local numbers, never a real id — the one place in the corpus where a `<select>`'s
  candidates aren't element references, and the reason those decisions used to offer nothing
  at all. Unlike the +83 above, these *do* count toward the total: they come from a real file,
  just not from an `<element>` tag. `parseRules` in
  `packages/aurora-import/src/parse-elements.ts` mints one deterministic id per item
  (`<owner id>/list:<select name>/<item id>`), the same move already made for a
  `<multiclass>` block's synthetic element. It was 12,058 until this was found.
- **57 warnings** — 56 `<grant>` elements with no id, and one id defined in two files.

This used to read "57 unresolved references, 57 warnings, equal by coincidence". Both halves
of that changed: the overlay resolved 51 of them, and splitting grant references from
requirement references separated one real breakage from twenty-three deliberate ones. The
coincidence is gone; do not go looking for it.

CI enforces this as a **budget, not a target**, and against a corpus that moves: the job can go red
because *upstream* changed (a new dangling grant, a new warning) with nothing here touched, which is the
signal, and the response is a look at what changed and then an edit to the numbers (ADR 0042). The
floors, 740 files and 14,316 elements, are below what the corpus holds today (14,320) on purpose: they
guard "the checkout loaded nothing", and a floor at the exact count would fail on any upstream removal.
`corpus.test.ts` reads `INCUDO_MAX_UNRESOLVED`,
`INCUDO_MAX_WARNINGS`, `INCUDO_EXPECT_FILES` and `INCUDO_EXPECT_ELEMENTS`, and the numbers live in
`.github/workflows/ci.yml`. Moving one is a deliberate edit to that file, and to the test's own
fallbacks, which a guard test compares against `ci.yml` so the two cannot drift. The `EXPECT` pair
is not redundant — a corpus that failed to check out loads nothing, and nothing has no unresolved
references.

**There is no test of exact corpus totals, on purpose.** One existed, pinning the element count of one
person's Aurora install as "frozen", and it was machine-specific by definition: Aurora's own updater
rewrote that install while the app was open (seven files, 14,316 to 14,320 elements, everything else
identical). What it guarded is that a budget only catches "worse", so renaming the ids `parseRules`
mints for inline lists would leave every budget green. That is held by unit tests that read no
corpus, and it was checked by perturbation: changing the minted id's shape, and stopping inline
lists producing elements, each fail three of them. The overlay's size (83) is asserted on its own
in `corpus.test.ts`. The figures in the bullets above are the record of a moment, not a pin.

Aurora saves: **all 9 import; 1 element-missing, 0 spell-missing, 0 stat-mismatch**, and
**55 element-extra**, with **3 not-modelled** and **13 content-missing** reported and not
counted. All **8 recorded spell slot rows are compared and agree** since ADR 0018 — they used
to be 8 of the not-modelled notes, which is where 59 became 51. Since ADR 0020 the **8 save
DC rows and 8 attack rows** are compared against stats Incudo publishes rather than against a
formula the verifier owned.

**51 not-modelled became 3, and 53 element-extra became 55, with inventory step 3.** 47 of the
notes were "this element came from the bag" and one was "the bag moves this DC"; all 48 are
comparisons now and all 48 agree — including the eighth DC pair, the Tome of Clear Thought
wizard, whose Intelligence comes out 22 for a DC of 18 and an attack of 10. The two new extras
are one finding: a **Mithral Armor** adornment suppresses its host armour's
`ID_INTERNAL_GRANTS_STEALTH_DISADVANTAGE` grant inside Aurora's app and in no content file, with
a real save's mithral-less plate as the control case that proves it is suppression rather than
absence. Left visible rather than guessed at. Do not re-derive the old 51/53 from a stale doc.

Of the other 53 extras, the original set of real saves are single-classed and contribute 52, all one
species — content AuroraLegacy added *after* those saves were written, confirmed against
upstream commit dates.

The ninth was built to be the multiclass oracle the other eight could not be (level 20
Paladin 2 / Warlock 18, two `<magic>` blocks). It accounts for the rest: one extra, a
darkvision grant that post-dates it, and the single **element-missing** —
`ID_INTERNAL_MULTICLASS_LEVEL_3`, an Aurora-app marker referenced by nothing in the 740
files and carrying no rules. That one is honestly unmodelled rather than budgeted; inventing
a rule for it would be the guess ADR 0005 rules out.

> **Note, 2026-09-23 — the figures in the paragraphs above (55, 52, 53, 3, 13, "all one species") are the
> original set's and cannot be reproduced: those saves are not committed.** The samples' own figures are the
> "oracle runs in CI over the samples" paragraph below, re-measured today: 10 / 0 / 0 / 73 element-missing /
> spell-missing / stat-mismatch / element-extra, 19 not-modelled and **42** content-missing. Their extras are
> not "one species": 42 of the 73 are two Incudo-only internal multiclass grants on 21 of the 22 single-class
> samples, 22 are firearm proficiencies on the two Artificer samples, 8 the Thieves' Tools pair on four
> samples and 1 a 2024 weapon mastery grant (detail in docs/AURORA-SAVE-FORMAT.md's note). Whether that
> internal pair is an Aurora omission or an over-grant is not settled.

`compareWithAurora` in `packages/aurora-import` classifies all of them (frozen, ADR 0008; it was
never in the CLI); see docs/AURORA-SAVE-FORMAT.md. `aurora-oracle.test.ts` *records* the whole table
above, plus 1 problem in one derivation and 8 spellcasting blocks, **per save** and not in total (those
figures are what the original set of real saves sum to), and since ADR 0042 reports a change from it as a
`MOVED` line and fails only the invariants. All ten tables were confirmed unchanged against the fresh
clone at `c28ce6c`.

**A tenth save, the Wizard 4 / Rogue 4 of ROADMAP Phase 2, is recorded on its own:** 1 element-missing
(`ID_INTERNAL_MULTICLASS_LEVEL_5`, the same Aurora marker as the Paladin/Warlock's `_3`, named for the
character level the second class began at), 2 element-extra (the Thieves' Tools expertise pair, which
Aurora never derived here or in the Rogue 8; Aurora's updater rewrote `class-rogue.xml` a quarter of an
hour before the save, so it may have run on the older copy in memory — **unconfirmed**), 1
not-modelled, **0 stat-mismatch, 0 spell-missing**, two blocks and every row compared. It is the only
save with two ordinary casting blocks, and it is what showed that Aurora records each block's *own*
slot table and the shared pool only as a caster level ([ADR 0041](docs/adr/0041-aurora-records-a-slot-row-per-block-and-the-shared-caster-level-once.md)):
the comparison used to expect the pool in every block and reported two false `stat-mismatch`es.

**It also measures how many rows were compared: 8 slot rows, 8 save DC rows, 8 attack rows** across the
nine, and since ADR 0041 a fourth family, the shared caster level (1 in the Paladin/Warlock, 1 in the
Wizard/Rogue).
`AuroraComparison` cannot report that — a row that agrees leaves no trace, and neither does one
that was skipped — so the test measures it: every published stat of one family is shifted by one
and the comparison re-run, and the extra `stat-mismatch` differences are the rows that were
compared. Checked by breaking things: the DC base moved from 8 to 9 gives 8 mismatches; the DC
comparison silently disabled leaves `stat-mismatch` at 0 and is caught only by this measure.
The CLI never printed these numbers; they were established once by hand and are now measured, and
since ADR 0042 the *relation* is what fails: every recorded spellcasting block has all three rows
compared (and the caster level exactly when the save records one), whatever the corpus is doing.

**The oracle runs in CI over the samples, and this is what it found** (30 samples, 8 of them
multiclass, 12 of them 2024, against AuroraLegacy/elements at `c28ce6c`): **0 stat-mismatch, 0
spell-missing**; 10 element-missing, every one an `ID_INTERNAL_MULTICLASS_LEVEL_N` marker; 73
element-extra, 19 not-modelled, 101 content-missing (62 of them one save: see below); 29 spellcasting
blocks and every slot row, save DC and attack bonus of them compared, and the caster level in all 8
multiclass saves. That covers what the first ten saves could not: three ordinary casting blocks, two
beside pact magic with a third-caster, the Artificer's round-up, Paladin and Ranger at odd levels beside
a full caster, and the 2024 half-casters (which start casting at level 1). Everything the corpus moves is
reported, not asserted (ADR 0042).

> **Note, 2026-09-23 — two numbers in that paragraph re-measured differently.** `content-missing` is **42**,
> not 101: the 101 was taken before `canonicalizeSaveIds` respelled the save whose ids differ only by case (62
> of them), and it was left in this file. The caster level is recorded and compared in **7** of the 8
> multiclass samples, not all 8: the Barbarian 3 / Monk 3 has no casting block and records none. The block
> and row counts (29 blocks in 20 saves; 29 slot, DC and attack rows) hold.

**Armour class now has a referee, and hit points and speed have one that disagrees.** The maintainer read
armour class, hit points and speed off Aurora's screen for every sample. **Armour class agrees on all 30**,
including plate with a negative Dexterity modifier, half plate above the medium cap, both Unarmoured
Defences and a magic-armour, three-attunement build, and `aurora-oracle.test.ts` holds it to that.
**Speed differs on 9** (nothing feeds the declared stat, so every character reads 30) and **hit points on
17**, for reasons that are Incudo's: the average-HP option, a second class's own dice, and an item that
sets an ability score. Both are in ROADMAP Phase 2 and are reported, not asserted.

> **Note, 2026-09-23 — the counts re-measured differently.** `aurora-oracle.test.ts` reports speed
> differing on **7** samples (10, 11, 12, 13, 19, 21, 27 — a Ranger, a Barbarian, a Druid, two Rogues, a
> Barbarian / Monk and a 2024 Monk), not 9, and hit points on **18**, not 17. The reasons named are unchanged.

**Two findings that no count sees.** An id can be spelled with different case in a save and in the corpus
(`…_War_DOMAIN` against `…_WAR_DOMAIN`): Aurora matches ids ignoring case and Incudo does not, so that
save used to import **without its whole domain**, 62 elements, with only a report-only `content-missing`
and one derivation problem to show for it. **Fixed at the importer, not in `ElementIndex`:**
`canonicalizeSaveIds` (`packages/aurora-import/src/canonical-ids.ts`) respells a save's ids to the loaded
content's, only when the exact id is absent and exactly one element matches ignoring case, and
`importAuroraCharacter` and `compareWithAurora` both call it. Content is the one source of ids the engine
sees, so the save is the only place a second spelling can come from; folding inside `get` would leave the
character recording an id the rest of the system compares exactly. The official corpus has no two ids that
differ only by case (12,061 declared in files); if one ever does, the fold refuses to guess. The oracle
holds it with `caseMismatches`, an invariant on every sample, checked by perturbation. And a save can record a fourth attuned item: Aurora allows
it and Incudo reports `over-attuned`, as ADR 0023 designed.

## State of play

Working: core engine, Aurora content **and save** importer, content sources, two system
definitions, the `.incu` container, the JSON Schemas and the validator behind them, the whole of
the inventory work — a bag, slots, `equipped=`, attunement and a derived armour class —
**spell selection, filtered by list, school and slot level** (ADR 0030), and
**the desktop shell, which runs**: `npm run desktop` opens on a **character library** (ADR
0027), manages content sources (ADR 0028/0029), builds a character, **sets its ability scores by
all four of 5e's methods**, renders the sheet, reads and writes real `.incu` files into a folder
the user picks, **saves a copy anywhere** (ADR 0038), and **imports Aurora `.dnd5e` saves into it**, and **multiclasses**: a level can
be spent on any class the character qualifies for (ADR 0036).
Not started: the mobile shell (only its `platform.ts` contract exists).

**The CLI is gone and what it measured is tests** ([ADR 0039](docs/adr/0039-the-cli-is-removed-and-what-it-measured-becomes-tests.md)).
Things to know before touching `tools/verify`:

- **The numbers were reproduced against the CLI's own output before a line was removed**, and that
  is the evidence: `validate --json` identical key for key on both layouts, and all nine saves'
  `aurora verify --json` identical (every difference, message and expected/actual). Both
  mechanisms are described in the ADR's evidence table. It cannot be redone — the CLI is in git
  history at `e102915^` if a future doubt needs it.
- **What was not verified:** the GitHub Actions job itself (never pushed; the step's command and
  environment were run locally against a reconstructed checkout layout, relative paths and all),
  and macOS or Linux for anything here.
- **`summarize()` is `tools/verify/src/derived-summary.ts`** and means what it did: sorted
  elements, stats, pending choices and problems, and never candidate lists. `accountedFor` went
  with `character verify`, its only caller.
- **`node-system.ts` has one loader, `loadShippedSystem(id)`**, which throws. There is no
  `--system` shorthand, error callback or "install it elsewhere" hint left in it.
- **Not covered, and was not before:** a reachability bug that leaves every count alone. The
  cache dropping `<append>` blocks was exactly that, and no budget here would have seen it.
  `compose.test.ts` is what holds that line.

**A level is spent on a class by writing two records, and one of them is easy to forget**
(ADR 0036). `Character.advancement` says which class each level went to; the class's own
*multiclass element* says it was taken second. The second is load-bearing: on the oracle, dropping
it while keeping `advancement` loses `ID_INTERNAL_GRANT_MULTICLASS` (caster level 1 → 0, every slot
with it) and opens an unearned "choose two skills", with no error anywhere. Everything is in
`packages/ui/src/multiclass.ts` under `node --test`; `apps/desktop/src/panes/ClassLevels.tsx`
computes nothing. Things to know before touching it:

- **`advancement` exists only while there is more than one class**, and then covers every level.
  A single-class character carries none, as an imported one never did. Records are keyed exactly
  as the importer keys them (`ID_LEVEL_3/select:Multiclass (Level 3)`), so an imported multiclass
  character and a built one hold the same records, and they are *found by what they hold*, not
  by key. The first class never gets a multiclass element.
- **The first class is found from content, not from `build/class`.** An import records it under
  `ID_LEVEL_1/select:Class`. The same mismatch used to leave an imported character's Race, Class
  and Background open and blocking, and choosing a race added a second one beside the imported
  record, both seeding the derivation. Fixed in the builder, not the frozen importer:
  `packages/ui/src/top-level-pick.ts` answers a pick from **any recorded choice holding an element
  of one of the step's `types`** (`build/<stepId>` first, and never a key a content `select` pool
  owns). `SettledPick.ruleKey` is the key the answer is actually recorded under, so `choose`
  replaces an imported record in place and drops any other record made only of that step's types
  — which is also what repairs a character an earlier build left holding both. Measured on the
  oracle and in the running app; `aurora verify` cannot see it (it compares chosen elements, not
  which control is open).
- **Gated on what content declares and nothing else:** the class's own `requirements` plus its
  `<multiclass>` block's, through the engine's own requirement context. Not gated, deliberately:
  `ID_INTERNAL_OPTION_ALLOW_MULTICLASSING` (0 of 740 files reference it, and campaign options
  cannot be switched on yet), the *current* class's prerequisite (content never states it, so the
  builder is more permissive than the Player's Handbook), and *when* a score was met (the engine
  has no time axis). 28 of 29 classes have a block; the UA Mystic does not and is listed as
  unavailable rather than hidden.
- **Six declared stats were the real blocker.** Content reads `str dex con int wis cha` 72 times
  in requirements (36 multiclass gates, 24 feat prerequisites, 6 rules) and nothing published
  those names, so every one read false for every character — all 28 gates for a Charisma 20
  character, and 24 feats never offered. `systems/dnd5e/system.json` now declares them as refs,
  no format change. `aurora verify` is byte-identical before and after and *cannot* see this.
- **Moving a level between classes with different dice clears that level's hit point roll**, and
  it reopens as a decision. A level that comes into being keeps any roll already recorded for it:
  the oracle's own rolls include a 10 on a d8, so a value above the die is something real saves
  hold, and deleting one on a plausibility guess is destroying data. `addLevel` is one write for
  the same reason — grow-then-reassign passes through a die change that never happened.
- **Nothing prunes the picks of a class whose levels went away**, nor of a level lowered away.
  They stay in `choices` and still seed the derivation, as they do after re-picking a race. A gap
  carried deliberately; it wants a decision about every pick, not about levels.
- **Evidence:** the Paladin 2 / Warlock 18 oracle rebuilt through the builder (fresh character,
  `addLevel` × 18) has the same `advancement`, the same record, every element and every stat as
  the import, and the same differences against Aurora's save (1 element-missing, 0
  stat-mismatch, 0 spell-missing) — `tools/verify/src/multiclass.test.ts`, skipped where the save
  is not installed. It cannot prove hit points: the save records rolls and never a total, so that
  test checks the per-level dice and a sum worked by hand, not Aurora's number.
- **A subclass chosen through a `select` follows the class that offered it** (ADR 0040). It used to be
  seeded with no track, so at Wizard 4 / Rogue 4 (character level 8) the engine granted a Wizard 6
  feature, read a multiclass caster level of 4 where the book says 5 (the Arcane Trickster's
  third-caster marker belonged to no track) and owed a Trickster 6 spells where the table says 4.
  A recorded choice is now an edge like a grant; a pick is expanded *after* its chooser, because
  expanding it first makes the answer depend on the order of `character.choices`. Nothing is
  deferred for a character with no `advancement`, and all nine saves derive identically before and
  after (element order included) — so **the oracle could not see this and cannot vouch for it**: no
  sample save has a multiclass character with a chosen subclass. The evidence is `engine.test.ts`
  and `tools/verify/src/rogue-wizard.test.ts`, a Wizard 4 / Rogue 4 built through the builder and
  worked by hand against the Player's Handbook. Found by building it in the running app, not by any
  test — the ninth save had no oath and a patron whose gates all sit below its class level.
- **The Rogue/Wizard has an Aurora referee, and it is a sample.** `rogue-wizard-aurora.test.ts` builds the
  description in `rogue-wizard-interleaved-build.ts` through the builder, one level at a time (Rogue, Wizard,
  Rogue, Wizard, ...), and compares it with sample 06, the same description saved from Aurora: 0
  stat-mismatch, 0 spell-missing, both slot rows, both DCs, both attack bonuses and the caster level
  compared and agreeing, and every level in the class the save put it in. It is the one test that shows the
  builder *offers* the right choices, since `builder-rebuild.test.ts` replays the picks a save holds. Two
  things it found: the Ritual Caster feat's two spells cannot be offered because the `Ritual` support filter is
  unread (named in the test as the one expected missing pair, so it fails the day that is fixed), and
  Aurora records a Thieves' Tools expertise without the two internal elements it grants, in a build made
  after its content was updated, so the older "stale content" explanation for that pair is wrong. What it
  cannot referee is `hp` (see ROADMAP Phase 2), and **prepared
  spells**: nothing in the builder or the engine models preparation, and the comparison does not read
  the `prepared` flags the save records, so that clause of Phase 2's exit criterion is unmet.
  `builder-rebuild.test.ts` rebuilds *every* save through the builder, single-class and multiclass, from
  its own picks, and each matches its import and Aurora.

**A budgeted step's editor is a renderer over `BudgetState`, and everything it needs is in
`packages/ui/src/budget.ts`.** What a value costs, where the next step lands, whether the pool
covers it, which of six values is still unplaced, what a swap should move, what a change of
method keeps — all of it there, under `node --test`. `apps/desktop/src/panes/BudgetEditor.tsx`
computes nothing, which is CODE-REUSE-POLICY rule 2's stated test kept honest: "point buy let me
spend 28 points" is fixable in a package. Four things decided rather than fallen into:

- **A points method seeds every target at the cheapest value it prices.** Without it a target
  nobody touched has no base, and the derivation reads the stat's declared `default` — 10 in 5e,
  *higher* than the 8 point buy gives away free. A set nobody bought, that looks legal. The
  decision stays open on the unspent pool, which is what `BudgetState`'s two openness conditions
  were always for.
- **An assignment method swaps; it never duplicates.** Dropping the 15 on a target while another
  holds the only 15 hands that one whatever this target held.
- **A change of method keeps only what the new method can express**, and that is a rule about the
  *mode*, not the number: point buy and the standard array start clean because they are
  authorities on their own values, and free entry keeps what it is given. The case that forced it
  is the common one — every imported Aurora character has six real scores and **no recorded
  method**, so a blanket clear would have destroyed the scores of every real character in the set the moment
  someone touched "enter manually".
- **Rolling is in `packages/ui/src/dice.ts`, above the engine and below the shell.** ADR 0019
  forbids core learning to roll (a derivation runs on every keystroke, so a roller it could reach
  would eventually be called by one); `"4d6dl1"` is declared in `system.json`, which makes
  parsing it a rule about the game and not a component's business. `rollBudget` fills only the
  unrolled slots and the state a view reads is a pure function, so **no repaint can reroll**.

**The app asks which system before it shows anything, and that answer scopes the library**
(ADR 0031, amending ADR 0027). It used to import one `system.json` and print "Dungeons &
Dragons 5th Edition" in the header to a user who had chosen nothing. Four things follow, and
three of them are correctness rather than presentation:

- **A source belongs to a system**, recorded when it is added and **never inferred**. Nothing in
  a content index says which game it is for — an Aurora `.index` has no field for one and the
  format is frozen — so `sourcesForSystem` reads what the user said. An untagged source (any
  profile written before ADR 0031) belongs to *nothing* and is offered for assignment rather
  than counted as the current system's; counting it would put another game's content into a
  character and freeze it there when the save is written (ADR 0012).
- **A system card is written for a player, and `description` is user-facing prose.** It used
  to render 5e's "the one Incudo is tested against… see docs/adr/0003" on the launcher.
  Maintainer notes go in `systems/README.md`; nothing on a card cites an ADR. `logo` is
  optional, a **reference** rather than inline bytes (ADR 0007), and a card with none draws
  nothing — never a generated stand-in.
- **A user can add a system**, which ADR 0011 has promised since Phase 0 and nothing implemented.
  `UserSystemStore` (`packages/ui`) validates a picked `system.json` through the same
  `validateGameSystem` everything else uses, **revalidates on every load** rather than trusting
  the add-time verdict, refuses an id the app ships, and encodes the storage key — `remove` and
  `has` take an id from a caller, and a `Storage` key becomes a file path under `NodeStorage`,
  whose sanitiser permits `.` and `/`.
- **A system definition may `suggest` sources**, which is what keeps the tagging invisible: a
  user who clicks Add on 5e's AuroraLegacy suggestion has said which system it serves by
  picking it. `official` is a claim by whoever wrote the system definition, not a check by
  Incudo, and the UI has to say *who* is vouching.
- **A source is keyed on its URL**, so it can belong to one system at a time. Adding one that
  another system holds is refused with a sentence rather than silently retagged.
- **`Shell` is keyed on the system id.** Switching rebuilds every piece of per-system state.
  Same class of bug as the `use-builder.ts` memo that made "New character" do nothing.

**The library is the part to understand before touching the shell.** It is a folder the user
chooses, scanned on open, with no index file and no database — the folder *is* the list, because
the user edits it directly. Since ADR 0031 it publishes only the chosen system's characters —
and **keeps the whole scan privately**, which is not tidiness: `freeName` picks a filename
nothing on disk is using, and asking the *filtered* list would let a new D&D character be
written over a Cairn one of the same name. `LibraryState.elsewhere` counts what the filter
hides, because a folder of nine characters reading "nothing here yet" is indistinguishable from
having picked the wrong folder. `CharacterLibrary` (`packages/ui`) is the view-model; `CharacterStore`
(`core/platform.ts`) is the port, with three implementations: Tauri's dialog and fs plugins,
the browser's File System Access API, and a `node:fs` one that exists only in a test. **Listing
and opening reach for no source, no index and no fetcher**, which is ADR 0012 being used rather
than merely proved; two tests hold that line, one with a fake store and one over a set of real saves. If either starts needing content loaded, the feature is wrong.

**Importing is the one library operation that does need content, and that is not a contradiction.**
A `.dnd5e` records Aurora's element ids and nothing about what they mean, so an import resolves
them against a corpus and copies what they name into the container; with no source enabled the
app says so rather than writing a character full of ids nothing can resolve.
`importAuroraSaveIntoLibrary` (`packages/ui/src/aurora-import.ts`) therefore takes an
`ElementIndex` and `character-library.ts` still takes none — keep it that way. Reading the file
itself is a fifth port, `FilePicker`, deliberately *not* a method on `CharacterStore`: every
method there means "inside the folder the user chose", and an import is one file outside it,
read once and forgotten. Two steps inside that function fail silently if dropped — the
`LayeredElementIndex` overlay of `imported.generated`, and `imported.extraIds` — so
`aurora-import.test.ts` asserts both by reading the container back with zero sources, and both
assertions were checked by perturbation.

**Two crashes ADR 0031 introduced and running it found, both in the first two minutes.** A
switch to Cairn killed the app with `System "cairn" has no character kind "pc"`: `choose()` set
the system and *then* awaited the character, leaving one render where the two disagreed and
`useBuilder` resolved a 5e kind against Cairn. And the same index was offered as a suggestion
while also listed as unassigned, with an Add button that would have retagged it in place. No
test had either, because every test builds one system's character against that system.

**Run the app before trusting this file about what works.** Every phase up to the shell was
verified against fixtures, a corpus and an oracle, and the first five minutes of actually using
it still found a view-model bug that no test had: a required build step with nothing picked
reported itself `complete`, so there was no way to choose a race or a class at all. Usability is
only testable by using it — see `apps/desktop/README.md`. It keeps paying: the library work
found three real bugs this way and **none of them had a failing test first** — a character
saved from the app recorded no sources at all, so ADR 0028's warning could never fire; nothing
loaded content at startup, so a reload left the builder empty until you visited Sources; and one
of the nine real portraits is a **JPEG**, which both halves of the library had assumed was a
PNG. The `.dnd5e` import kept the run going: importing one save twice, a minute apart, gave
**250 elements embedded and then 227** — a `packages/content` cache bug three subsystems away
that no count anywhere could have shown. What the shell has surfaced and not fixed is under
"Known from running it" below.

**The ability score editor found three more, and one was data loss.** Both of the serious ones
were in `apps/desktop/src/use-builder.ts` and had been there since the file was written.
Enabling or disabling a content source replaces `elements`, which rebuilds the `CharacterBuilder`
— **from the shell's `working.character`, which is the character as it was opened and is never
written back to.** Six scores, a race and a class silently back to straight 10s, with the
autosave then writing the reversion over the draft, so reloading did not bring it back. It ate a
character mid-session. And **"New character" did nothing at all**, because the memo saw the same
system and the same index; opening from the library only ever *appeared* to work, since a save
carries embedded content and so changed `elements` by accident. The hook now resumes from the
builder's own state and keys on `character.id`. Twelve green test files cover this code and none
of them rebuilds a builder mid-edit, which is the whole lesson: **the tests protect the rules,
running it protects the product.**

**What the app can be told to do is one list, and the menu and the shortcuts are two renderings of
it** ([ADR 0037](docs/adr/0037-a-command-is-data-the-page-owns-the-keyboard.md)). `packages/ui/src/commands.ts` holds thirteen commands — id, label, shortcut, and a
rule for when each is available — under `node --test`; `apps/desktop/src/use-commands.ts` and
`platform.ts`'s `TauriCommandHost` compute nothing. Adding a command is one entry in `COMMANDS`, one in
`MENUS`, one rule in `ENABLED` (a `Record`, so leaving it out does not compile) and one handler in
`App.tsx`. Things to know before touching it:

- **The page owns the keyboard in every build, and the menu is for the mouse.** The native menu
  registers no accelerator; it prints the shortcut as label text. The first version did register
  them and it passed every check that needed no keyboard — then pressing the keys in the Windows
  window did nothing, because WebView2 hands the page the key and the host's accelerator table never
  runs the item. Do not put accelerators back without pressing the keys in the window.
- **A command is enabled where its outcome can be seen**, on purpose. New character replaces the
  character being edited without asking, so it is live only on the characters screen, where its
  button is; Save only on Build, where "Saved to …" is printed. Enabling New everywhere wants a dirty
  flag nothing tracks yet.
- **A disabled command still claims its key** (Ctrl+S on the Sheet pane must not become the browser's
  "save page"), and no shortcut may be a bare printable key, use Alt (Ctrl+Alt is AltGr on a Brazilian
  keyboard) or take Ctrl+A/C/V/X/Z/Y. Tests hold each of these.
- **Verified by real keystrokes in the Windows window, not on macOS or Linux.** The navigation chords,
  Refresh, and Ctrl+A/C/X/V/Z in a text field all behave; the macOS application and Edit menus were
  written and have never run, and how a macOS or GTK menu renders the tab-separated shortcut text
  was not seen. `platform.ts` `TauriCommandHost` on those platforms is unverified.

**"Save a copy…" writes the character on screen to a file the user picks, and changes nothing else**
([ADR 0038](docs/adr/0038-a-copy-goes-through-a-save-port-and-changes-nothing-else.md)). Ctrl+Shift+D,
Build only, beside Save; the thirteenth command. Things to know before touching it:

- **`packCharacter` (`packages/ui/src/character-library.ts`) is the one packing function.** The library's
  Save and a copy both call it, so a copy is the file Save would write. Do not write a second serializer.
- **A copy is not a Save As, and that is structural.** `saveCopy` (`character-copy.ts`) takes no library and
  returns no entry, so `working.entry`, `working.readAt` and `working.savedName` cannot move, and
  `copyToFile` in `App.tsx` has no `setWorking` in it. Do not give it one. Seen in the running app: after a
  copy of a renamed, unsaved character, Ctrl+S still raised the rename prompt and saved without a conflict.
- **The port is `FileSaver`, `FilePicker`'s write half** (`core/platform.ts`): bytes and a suggested name in,
  a name out, `null` for a cancel. It needs no library, so the command is gated on `saverAvailable`, not on
  the library. Tauri needed `dialog:allow-save` and no Rust: the dialog's own `save` widens the fs scope to
  the file it returns.
- **Windows opens the dialog at the last folder used, which was the library folder.** The system's replace
  prompt is the only guard against a copy named like a library file; the app passes no starting folder.
- **A re-save drops what only an import knew** (`extraIds`): across a set of real saves one element,
  `ID_INTERNAL_MULTICLASS_LEVEL_3`, plus any unresolved ids only Aurora's `<sum>` named. `aurora verify`
  is unaffected and no derived number moves.
- **A re-save keeps the portrait only because the shell hands the bytes back.** `OpenedCharacter.assets` is
  what `library.open` returns, `working.assets` holds it, and Save and Save a copy both pass it. A
  `Character` records only where its portrait is: before this, every re-save of an opened character
  dropped the file and kept the reference, for all nine real ones, and no count anywhere showed it.
- **The chord is Ctrl+Shift+D because Ctrl+Shift+S never reaches the page in the Windows window.** WebView2
  takes the key-down before the page (only the key-up arrives); S, E, U, M, G and X are taken, K, O, D, H, B,
  Y and L arrive. An injected DevTools key event opened the dialog and hid this, so **press real keys before
  trusting a chord**; `commands.test.ts` keeps the taken ones out.
- **Not verified:** macOS and Linux, the real browser save dialog, and Ctrl+Shift+D in an Edge browser tab
  (Edge may take it as it takes Ctrl+Shift+S). The browser round trip and the whole Windows dialog, driven
  by real keys, including the replace prompt and Esc, were seen.

### Known from running it

- **~~`<select supports="$(...)">` still offers nothing.~~** Fixed (ADR 0030), and the shape
  of the fix is worth knowing before touching a filter. Resolving the interpolation was one of
  **four** things, and on its own it would have changed nothing visible: three separate defects
  in the `supports` language had to go first. `||` bound *tighter* than `,` (it is the looser
  operator, as in `requirements`); parentheses were never parsed at all, in 131 of the corpus's
  2,466 `supports=` attributes; and an operand could not name a **setter's value**, which is
  where a spell keeps its level and its school, so no levelled select could ever have matched
  however well the `$(…)` resolved. Those three alone take the interpolation-free select
  filters that match nothing from 343 to 124.
  Do not read a green `aurora verify` as evidence about any of this: it compares the elements
  a character *chose*, so a filter resolving to **everything** would move no count anywhere.
  The evidence is measurement and perturbation — see ADR 0030's numbers, and the engine tests
  that remove each half of the resolution and assert the list gets wider.
- **~~Loading a content index re-fetches every file.~~** Fixed (ADR 0029). The app composes
  `LayeredContentSource(cache → http)` now, so the cache `writeThrough` was already writing is
  finally read back. Measured in the running app: 18.4 s cold for 238 files, **0.5 s** on a
  reload, and 11.1 s after an explicit Refresh, which is how you can tell an eviction really
  happened.
- **~~A corpus read from that cache was not the same corpus.~~** Fixed, and worth remembering
  how it was found. `CachedContentSource.loadFile` returned everything the network layer did
  **except `appends`**, so all 171 `<append>` blocks were dropped on every load after the
  first. Nothing said so: same 740 files, same 12,058 elements, same 57 warnings — what changed
  was what a character's elements could *reach*. It surfaced as one Aurora save importing
  "250 elements embedded" and then 227 a minute later, and it would have written short saves
  for every user from their second session on, which is the ADR 0012 failure exactly. The
  lesson is the one ADR 0008 already recorded about `<supports>`: **counts do not catch a
  reachability bug**, so `compose.test.ts` now asserts the two layers *agree* rather than that
  the cache answers.

Eleven things the shell has surfaced, five of them since fixed and struck through. The rest are
deliberately **not** fixed:

- **~~An answered `pick` cannot be changed.~~** Fixed. It was predicted here to be "a real screen
  rather than a two-line fix" and it was one `continue` becoming a branch: `BuilderState.picks`
  publishes the settled half of a top-level pick — rule key, what is chosen, what could be
  chosen instead — exactly as `steps[].budget` already did for a settled budget, and the pane
  renders "Choices already made" beside "Values already set". Candidates are rebuilt on every
  read rather than remembered, so a replacement is filtered against the character as it is now.
  **This is not a Back button and ADR 0017 is untouched**: a settled pick is not somewhere you
  navigate to, it is something on screen that kept its control. The pane's header comment had
  been using "no Back button" as cover for the hole, which is how it survived.
- **~~A decision could only ever record one element, and waited for the whole pool to close
  before any of it could settle.~~** Fixed in three passes, all found live rather than by a
  test. First: a player chose a Skill
  Proficiency after a Sage background, and a second pick left the *first* one stuck on screen
  with no way to add to it — `choose(id, [value])` replaces, so `BuilderPane` was always sending
  a single-item array and `setChoice` always overwrote whatever was there. `OpenDecision` gained
  `chosen: ElementId[]` alongside `candidates` (ADR 0032's decision 1, landed ahead of the rest
  of that ADR), and the pane's write while a pool is open became
  `choose(id, [...decision.chosen, value])` — "replace" for a `pick`, where `chosen` is always
  `[]`, and "add to" for a `select` asking for more than one, with no branch needed between the
  two. Second, reported once the first fix made it reachable: filling the *last* slot made the
  whole decision vanish, exactly the hole ADR 0017 had already fixed for a top-level pick — a
  second Skill Proficiency had nowhere to be changed once chosen, any more than Race did before
  `picks` existed. The engine gained `answeredChoices` beside `pendingChoices`, publishing every
  slot's answer and what any one slot could hold instead once a pool has nothing left to
  choose — `pendingChoices` itself is untouched, so the self-containment test needed
  no changes — and `packages/ui` folds these into the same `picks`/`SettledPick` array a
  top-level pick already used. A full Skill Proficiency now renders in "Choices already made"
  exactly like Race: one `<select>` per filled slot, independently changeable, each excluding
  every *other* slot's current answer so two slots can never agree on one.
  Third, reported straight after the second: an answered slot was still waiting for its *whole
  pool* to close, so a wizard's first cantrip sat inside the open decision as a tag until the
  second and third were also picked — settled and outstanding shown as one undecided thing. Every
  slot with an answer now settles the moment it is recorded, pool closed or not:
  `use-character-builder.ts` builds a `SettledPick` straight from `pendingChoices` for any rule
  with `chosen.length > 0`, using the exact "add `chosen` back into its own candidates" trick the
  full-pool case already used, and the open decision that remains shows only what is left — "2
  left", a plain dropdown, no tags. `answeredChoices` needed no change for this pass.
  The engine's candidate-and-remaining math needed nothing for any of the three passes —
  `candidatesFor` and `remaining` already handled a multi-element `Choice` correctly, proved by a
  same-render three-answer test that predates all of them — so every one of these bugs was in the
  pane and in what the engine chose to publish once a pool closed or a slot filled.
- **~~The character sheet renders no features, traits, proficiencies or languages.~~** Fixed.
  `SheetPane.tsx` did `if (!stats.length) return null`, and the `features` and `proficiencies`
  sections declare `types` with no `stats`, so they were dropped whole. It now calls the shared
  `renderSheetSection` (`packages/core/src/system.ts`) instead of reimplementing `perBlock`
  expansion by hand, and renders a section whenever it has non-empty `stats` *or* a non-empty
  `derived.elements.filter(e => section.types.includes(e.type))` — the same test
  the CLI's sheet printer used before it was removed. A level 1 wizard's app sheet now lists
  its features, proficiencies and spells.
- **~~A level 4 character has an Ability Score Improvement decision it can never close.~~**
  Fixed (ADR 0035), and the diagnosis this file gave was wrong. It blamed the `Class` operand.
  Reproduced first, the decision published `candidates: []` **and** `unresolved: []`: the
  filter was well-formed and nothing carried the tags, because Aurora's app generates the
  options (`ID_INTERNAL_CLASS_FEATURE_{ASI|FEAT}_{level}_{CLASS}`) and only the two Artificers'
  are written in a file. A set of real saves record the generated ids and select names; 88 of the 123
  empty select filters in the corpus were this one protocol, and the 35 left are exactly `!`
  negation, `Ritual` and two proficiency lists. `improvement-options.ts` derives the options
  from what is loaded and `ContentLibrary` runs it after every source.
  Two more things had to be true for a +2 to land, and the second was **data loss found by
  measuring rather than by a test**. A +2 to one score is the same +1 element picked twice —
  Aurora's `<sum>` lists `ID_INTERNAL_ASI_CONSTITUTION` twice for a real level 12 Fighter save — so a
  kind may declare `repeatableSetter` (5e: `allow duplicate`): an element carrying it is offered
  again by a pool that holds it and its stat rules apply once per pick, counted across every
  choice. And the importer used to drop the second pick ("keeping one"), so that Fighter imported with
  a Constitution of 19 where Aurora computes 20. `aurora verify` cannot see it: it compares chosen
  elements and never an ability score, and came back byte-identical on all nine saves before and
  after — which proves nothing regressed and nothing else.
  The feat half is generated too, gated on `ID_INTERNAL_OPTION_ALLOW_FEATS`, and reachable since
  ADR 0032's `multiple: true` (the campaign options step, below). **Eight of the nine sample
  characters took a feat at level 4**, and with feats on a level 4 Fighter is offered two options
  where it was offered one.
  *(Note, 2026-09-23: in the thirty samples it is **3 of 12** with a level-4 improvement, 10 of the 13 level-4
  options being ability score increases. The feat half is still generated, on its other grounds. ADR 0035's
  note has the rest.)*
  Perturbation is the evidence and it is in the tests; running it is the rest — a level 4 Fighter
  is offered the option, taking it offers all six abilities, Strength twice reads +2 (12), and
  both picks settle as slots that each still offer Strength.
- **A granted ability point is unspendable except under a points method.** `BudgetState.granted`
  reports it and the editor shows it, but only a cost table says what a point buys, so a
  standard-array or rolled character cannot spend one. Inventing "a point is +1" is the guess
  ADR 0005 rules out. It fires zero times today: nothing in the 740 files contributes to
  `ability points`, and a 5e ASI is a `+1` straight to the stat.
- **Scanning a library reads every container in full.** There is no manifest-only fast path,
  because the zip codec inflates the whole archive — nine saves is imperceptible, two hundred
  will not be. Same for the portrait bytes a grid holds in memory. ADR 0027 names the
  mitigation (a summary and thumbnail cache keyed by path and mtime) and deliberately does not
  build it.
- **Nothing moves a recorded source version.** ADR 0028's `moved` state is computed and shown,
  and the "refresh this character against the newer source" flow it points at does not exist,
  so a character says a source has moved until someone builds that.
- **Importing N saves rescans the library N times.** `CharacterLibrary.save` refreshes after
  every write, because the collision suffix reads the current listing — so importing a set of real saves reads 45 containers. Imperceptible at nine and the same root cause as the entry
  above it: there is no manifest-only fast path. Not fixed, and not worth fixing before the
  summary cache ADR 0027 names.
- **Two `supports` operands are still unread, and are reported rather than guessed at**
  (ADR 0030, ADR 0005). There were three; `Class` was never an operand problem (see the
  improvement entry above), and neither of these two is what that decision needed. `!` **negation** inside a filter — 13 uses, read as a literal tag, so
  `Artificer Infusion, !TCOE Base` offers an empty list; unambiguous and simply not done, and
  the obvious next one. `Ritual` — 17 uses, where a spell carries `<set name="isRitual">true</set>`
  and Aurora evidently maps a true boolean setter to a tag named after it; deriving the tag name
  from the setter name is a guess with no second witness. ~~`Class` — 15 uses, matching no tag
  on any of the 14,316 elements~~ — a tag on the six `ID_INTERNAL_ASI_*` elements the overlay
  supplies, which is what those 15 filters select. The shell shows "No candidate in the loaded
  content matches this choice" for the two above, which is honest but not the whole truth.
- **~~There is no export.~~** Fixed (ADR 0038): "Save a copy…" writes the character on screen to a
  file the user picks. See the paragraph after the commands list above.
- **An NPC or legendary creature has no way to set ability scores.** Both kinds declare a
  required `abilities` step with `"types": []` and **no `budget`** — the inert shape ADR 0017
  names, which matches no pending choice and reports itself complete. The editor is a budget
  renderer and knows nothing about 5e, so this is one `budget` block per kind in
  `systems/dnd5e/system.json` with `manual` as its only method (a monster's scores are printed,
  not bought). Left unwritten while the phase is about a PC.

ADRs 0007, 0009, 0012, 0014, 0015, 0016, 0017, 0018, 0022, 0023, 0024, 0025, 0026, 0027, 0028, 0029, 0030, 0031, 0033, 0034, 0035, 0036, 0040 and 0041 are implemented, and so is **0032**: a build step may declare `multiple: true`
and is then published as a non-blocking, skippable *set* (`OpenDecision.multiple`,
`SettledPick.multiple`), recorded under `build/<stepId>`. 5e's `options` step is the first — campaign
options, found by type (`Option`) with no id named. Three things to know before touching it: a set is
read from its own key only, where a race is read by what it holds (`top-level-pick.ts`); the overlay's
`ID_INTERNAL_OPTION_ALLOW_MULTICLASSING` is offered and **nothing reads it** — left visible, see the
ADR's status note; and `aurora verify` cannot see any of it, so the evidence is
`tools/verify/src/campaign-options.test.ts` and perturbation.
0033 lets a non-blocking decision be skipped (`decline`, `reconsider`) as its own recorded input;
0034 ranks Open decisions by a step's declared `priority` rather than by a hardcoded rule. Neither
has anything to do with 0032 despite the numbers. The element picker is also not a `<select>`
any more: `CandidatePicker.tsx` is searchable and uncapped, hovering a candidate reads its
description in a fixed dock (`PreviewDock.tsx`), and none of that has an ADR — it is presentation.
Phase 1 is done — **`packages/aurora-import`
is frozen to bugfix-only** (ADR 0008). `GameSystem` declares `characterKinds[]`, each owning its
`buildSteps`, `sheet`, element types, baseline `grants` and `progression`
(level | rating | xp | none); `Character` has `kind`, `progress`, `rolls`, `baseStats`,
`advancement`, `generation`, `inventory` and `assets`. A `.incu` is a zip of `manifest.json` + `character.json` + `content.json` + `assets/`,
readable and writable as an unpacked folder too, and `self-contained.test.ts` proves a save
re-derives identically with zero sources configured.

Three things Phase 1 changed that are easy to trip over:

- **A character kind carries a baseline.** `kind.grants` plus `progression.elementIdPattern`
  give every character elements nobody chose — the 5e base armour class, one `ID_LEVEL_N` per
  level. They are *not* stored on the character, so `collectCharacterContent` needs the kind
  passed in or the save will not embed them and ADR 0012 quietly breaks.
- **`packages/aurora-import` supplies 83 elements no content file declares** (plus 146 it
  derives from what is loaded, ADR 0035). The 5e system definition names seven of them in
  `kind.grants`. That coupling is deliberate — 5e content in
  this project *is* Aurora content — but it is why a missing kind grant warns rather than errors.
  The last three arrived with the bag: Aurora's inventory proxies, which only a real
  `<equipment>` block names.
- **Five Aurora constructs were being silently dropped**: element-level `<supports>`
  (3,611 blocks — *every* support tag in the corpus), element-level `<requirements>` (1,845),
  `<append>` (171), `equipped=` (79, none of which is `"true"`, all read as `false` — fixed by
  ADR 0021), and `<spellcasting><list>` (17, fixed by ADR 0030 — the tag
  `$(spellcasting:list)` needs, which had never reached the engine). Every one was found by
  counting what the corpus contains rather than by reading the format. See
  docs/AURORA-FORMAT.md.

**The builder has no current step** (ADR 0017). `CharacterBuilder` publishes `decisions` — one
flat, always-current list — and `steps` is a grouping with `available`/`blockedBy`, not a
sequence to walk. There is no `goToStep` and no Back button; `focus()` is presentation and
nothing depends on it. A decision opened at level 4 arrives in the same list as every other.
`Character` gained a sixth input, `generation`, recording which method a budgeted step used.
A budget is written through `setBudgetStat`, `adjustBudgetStat`, `rollBudget`, `clearBudgetRolls`
and `setGenerationMethod` — all validated, all on the builder. `setBaseStat` still exists and
bypasses every rule; it is for a caller that has no budget, not for an editor.

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

**A pool never offers what the character already has.** `candidatesFor` has always excluded a
pool's own `chosen`; `collectPendingChoices` widens that to every element the character holds,
which is the only place the question can be asked — a background's "two languages of your
choice" is a support-tag select and a race's Elvish is a plain `<grant>`, and neither file can
know about the other. An Elf taking Sage sees 41 languages rather than 43, without Elvish or
Common, and still owes two. The case that looks like a counter-example is not: a rogue's
Expertise offers `ID_EXPERTISE_SKILL_ACROBATICS`, whose requirement is the *different* element
`ID_PROFICIENCY_SKILL_ACROBATICS`, so wanting what you have is expressed by needing what you do
not. **`aurora verify` cannot see any of this** — it compares elements a character chose, not
ones it was offered — so a green run is not evidence; perturbation in `engine.test.ts` is.

**A slot publishes a set of tags, and `equipped=` is evaluated** (ADR 0025, step 4). A character
kind declares its `inventory`: which slots exist, what stat each publishes into, which setters
become tags, and which setter marks attunement. Core says none of `body`, `armor`, `primary`,
`versatile`, `any` or `none`. Four things to know before touching it:

- **Three kinds of question, one syntax.** `[armor:heavy]` reads a setter's *value*,
  `[primary:versatile]` reads a setter's *presence* (its value is a die), and
  `[primary:double-bladed scimitar]` reads the element's *name*. That is why a slot publishes a
  set and `equals` became a membership test — string equality stays for the corpus's other 8
  `equals` checks, all `type =`, and there are **no `flag` checks anywhere**.
- **A slot's `stats` list is its capacity.** One stat holds one item, so `["primary",
  "secondary"]` is two hands and a slot with no stats holds any number of cloaks. Nothing had to
  guess a capacity, which is the whole reason that field does not exist.
- **The equipment state is resolved once, before the fixed point.** Occupancy depends on the bag
  and the index and never on the derivation; a tag set hung on a `ResolvedStat` would be a pass
  behind. Do not move it into the loop.
- **A kind with no `inventory` ignores `equipped=`**, exactly as a kind with no progression
  ignores `level=`. Evaluating with no slots is the state ADR 0021 measured and refused: every
  positive check false, every negation true.

The corpus carries 79 `equipped=` attributes and **78 reach the engine** — the 79th is Dueling's
`melee:damage`, commented out upstream.

**Nothing moved when this landed, and that is worth almost nothing.** Before it, all 78 rules
applied unconditionally, so evaluating can only ever *remove* a contribution. Only eight
conditions exist across a set of real saves (a monk's Unarmored Defence and its five movement modes,
the Defense fighting style twice) and all eight are true; nobody in the corpus of saves carries a
shield, so `[shield:any]` has never been true. **Perturbation is the evidence**, and it lives in
`packages/core/src/equipment.test.ts` and the engine tests. Do not cite the green `aurora verify`
run as proof the gating is right.

> **Note, 2026-09-23 — re-derived from the thirty sample saves.** "Nobody carries a shield" does not hold
> of the samples: **four** equip one (three Fighters and a Barbarian), so `[shield:any]` and the shield's
> armour class term are true on real characters, and armour class agrees with the hand-read screen value on all
> four. On attunement the samples give **7 of 7** attuned and **one save over the limit** (4 against 3, one
> `over-attuned`), not "none over". The "eight conditions" are not re-derived. See the notes in ADRs 0023, 0025
> and 0026.

**A bag is a list of instances, and the container embeds all of it** (ADR 0024). `Character`
gained `inventory` and `character.json`'s `formatVersion` moved to **2** — the first time it has,
after `baseStats`, `advancement` and `generation` each stayed at 1. Readers accept both. Three
things in the shape are measurements, not taste: an entry is an **instance** (one save carries two
greatswords with different enchantments, so an element-keyed bag loses a real character's items);
`slot` is an **override** and normally absent (the saves' `location` agrees with the element's own
`slot` setter 15 times out of 15); and adorners **nest** with no id of their own (Aurora gives them
none, and minting one would make an import non-deterministic). `collectCharacterContent` seeds
from every entry **including the carried ones** — that asymmetry is deliberate, because only the
*equipped* ones will seed the derivation at step 3. Nothing derives from the bag yet, and
neither step 1 nor step 2 moved a baseline.

**The importer fills the bag, and `slot` is written zero times** (step 2). All 45 instances
across a set of real saves come across — 26 equipped, 12 attuned, 15 adorners, 4 stacked rows, 1
user-given name — and every ADR 0024 measurement held on the real files, including the one it
offered as falsifiable: no recorded `location` ever disagreed with the element's own `slot`, so
the override is never written. `instanceId` is Aurora's `identifier` GUID, and an item without
one is numbered by its position rather than given a minted id, because minting would make
an import non-deterministic. An unrecognised `location` is reported and never written
through: Aurora's three location strings and content's 18 slot values are two vocabularies.

> **Note, 2026-09-23 — re-derived from the thirty sample saves.** The bag census is **24 instances in 8
> saves — 22 equipped, 7 attuned, 2 adorned hosts, 0 stacked, 0 named** — where this paragraph has 45 / 26 / 12 /
> 15 / 4 / 1. Held on the samples: every instance comes across, `slot` is written **0** times, and the
> recorded `location` agrees with the element's `slot` setter **15 of 15**. Changed: Aurora writes **four**
> location strings in the samples, not three (a shield records `Secondary Hand`). Not re-derivable from the
> samples: the two-greatswords bag, any stack, a user-given name, an equipped Aurora proxy. ADR 0024's note
> has every probe.

**Equipped derives, carried does not, and the bag is now a compared thing** (step 3).
`deriveCharacter` seeds from `equippedElementIds` next to the choices and the advancement — an
equipped entry's element and its adornments, once each however large `quantity` is. A carried
entry seeds nothing, while `collectCharacterContent` still embeds all of it; that asymmetry is
ADR 0024 decision 7 and is the half Aurora refereed, 26 of 26 equipped items in its `<sum>` and
18 of 19 carried ones outside it. Three consequences worth knowing before touching this:

- **`aurora verify` no longer excuses anything from the bag.** The `statsFromInventory`
  carve-out is gone, and with it the last two readers of `proficiency` and `abilityModifier` in
  the verifier's options — the file holds no arithmetic of its own at all now. The bag survives
  there only as a *hint* on an `element-missing` message, naming which pile the id came from.
- **An equipped plate's `ac:armored:armor 18` is summed since step 5**, and a barbarian in plate
  no longer *also* shows Unarmoured Defence, which is what step 4 fixed.

**The inventory work is finished — all five steps** (`docs/INVENTORY-AND-AC-PLAN.md`). Step 5
built ADR 0022's `contributions` and spent it on `ac` and on ADR 0023's attunement limit
(ADR 0026). Four things to know before touching the armour class:

- **`ac` is derived and checked by nobody**, exactly like `hp` (ADR 0019). No `.dnd5e` save
  records an armour class, so `aurora verify` gains no comparison and never will — a green run
  after changing the formula means nothing about the formula. Never describe `ac` as verified.
  A set of real saves read 18, 18, 17, 18, 18, 13, 16, 20, 16; the evidence for those is the
  Player's Handbook worked by hand plus perturbation in `tools/verify/src/armour-class.test.ts`.
- **It is six conditional rows, not the four the plan predicted.** A cap cannot express the
  Player's Handbook sentence that heavy armour *also does not penalise* a negative Dexterity
  modifier, so the term has a floor too. Both plate wearers in the nine have a Dexterity modifier
  of exactly 0 and both medium-armour wearers exactly +2, so **the saves cannot tell the six-row
  table from the four-row one, or the medium cap from no cap at all.** Do not read their
  agreement as evidence.

  > **Note, 2026-09-23 — this no longer holds of the samples.** The plate wearer has a Dexterity modifier of
  > **−1** (armour class 21, read off Aurora's screen; a cap alone would give 20) and two medium-armour
  > wearers have **+3** (17 and 18; no cap would give 18 and 19), so a referee now separates the six-row
  > table from the four-row one and the cap from no cap. The bullet above stands for the original nine.
  > "Checked by nobody" and "never describe `ac` as verified" are the original decision; with the readout,
  > armour class has a referee (a person reading a screen) and agrees on 30 of 30. ADR 0026's note has the table.
- **A contribution joins content's bonus buckets, it does not land after them.** That is the
  whole reason the field exists: 5e writes `ac:armored:dexterity:cap` 2 in `base` and Medium
  Armor Master writes 3, and the answer is 3. Summed afterwards it reads 5.
- **`pc`'s `ac` deliberately has no `default`.** The engine adds a `derive` on top of whatever a
  stat holds, so leaving the system-level `default: 10` in place would put a second 10 on every
  character. `npc` and `legendary` keep it and derive nothing — a monster's armour class is
  printed, not summed, and neither kind declares an inventory for `[armor:none]` to be about.

**An unattuned item contributes nothing, and says so** (ADR 0023). The gate landed at step 4 and
the **limit** at step 5, once `contributions` existed to hold the base of 3. All 12
attunement-requiring equipped items across a set of real saves are attuned and none of the nine is
over the limit (1, 0, 1, 0, 3, 2, 1, 1, 3), so both halves fire zero times there — there is no
oracle and there cannot be one; do not describe either as verified. Three things the corpus
settled that are easy to miss: adorners are separate elements, so gating one gates the magical
half and leaves the greatsword a greatsword; `attunement:max` is already declared by content 11
times, in both `bonus="base"` override and unbucketed `+1` shapes, which both come out right
against a base of 3 contributed in the same bucket; and `attunement:current` is counted per
**entry** and only when the entry has something to be attuned to, because Aurora carries one flag
per instance and none per adorner. The prose in `addition="by a wizard"` is display text and is
never evaluated.

**Identity is embedded in a save; mechanics are not** (ADR 0022). `collectCharacterContent`
seeds from `baselineElementIds(kind, progress)`, so every element a kind grants is copied into
`content.json` and frozen there, while `system.json` is the one thing a save deliberately does
*not* embed. That is why all seven of the 5e kind's `grants` carry zero rules, and why only nine
of the overlay's 83 elements carry any — the six ability score improvements and the three
inventory proxies, where the rule *is* the identity. The 146 improvement options carry a
`select` each on the same ground: the select is what the saves record them as. Put a game rule on an element and you have put it in every save written
before you fixed it. A kind's `contributions` is where a conditional baseline rule goes
instead, and **a system definition ships no content** — decided and closed, so do not reach
for `.incuset` when a system needs a rule.

**A declared block does four things, and the fourth is a filter** (ADR 0030). Three are the
stat keyings below; the fourth is that a `<select>` attached to a block may write its filter in
terms of what that block and the derivation publish. A kind's `blockFilters` says how a
`$(key)` expands: `tags` is a **fallback chain** over the block's name and attributes (first to
resolve wins, and the result is parsed as a sub-expression, because an Eldritch Knight's list is
`Wizard,(Abjuration||Evocation)`), and `tagsFromStats` globs stat names and turns positive
matches into an OR of their captures. `fillFrom` is not decoration: a warlock's pact table
publishes exactly **one** positive slot stat, and without filling downwards a level 18 warlock is
offered 5th-level spells and nothing else — the two real warlock saves hold levels 1 through 5.
Reach for `tagsFromStats` before recomputing anything; ADR 0018 already made every slot table
derive, and a second copy is the one that goes stale.
An expansion that finds nothing returns `NEVER_MATCHES` and is **not** reported as unresolved.
"You have no spell slots yet" and "Incudo cannot read this filter" are different sentences and
conflating them has already cost one wrong diagnosis.

**There are four keyings of a stat** (ADR 0020, then ADR 0022). A stat is contributed to a
character by content, or once per *track* (`trackStats`, ADR 0018), or once per *declared block*
(`blockStats`), or once by the *kind itself* (`contributions`). The fourth is the base case the
middle two are iterating specialisations of, and what it adds is a `requirements` — which is why
"a character wearing no armour has an armour class of 10" has a home and could not have had one
on an element. The third exists because the second cannot reach it: the namespace content
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
  validator the app and the tests share. Do not write a second one.
- **`summarize()` in `tools/verify/src/derived-summary.ts` is the definition of "derived output".**
  The self-containment test compares it, so anything added to a derivation that depends on *what content is loaded* rather
  than on the character must stay out of it — candidate lists are the example.

## Conventions

- Small, focused commits. Explain what you tried that didn't work — often the useful part.
- Diagnostics over guessing: when content is ambiguous, report it, don't silently pick.
- When a decision would be expensive to reverse, write an ADR before writing the code.
- **ADR evidence comes from committed generic fixtures or from public content, never from a person's own
  files.** A measurement of a personal save cannot be re-checked by anyone else, and quoting it puts that
  person's data into a permanent record. Attribute one to "a real Aurora save" and describe it by what it
  holds ("a level 12 Fighter save"), never by who made it or what it is called. Older ADRs were scrubbed of
  identities and still cite figures measured on personal saves: **re-derive those figures from the generic
  sample saves (docs/SAMPLE-SAVES.md) once they are committed**, and correct the ADR where they differ.
