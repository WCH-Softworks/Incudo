# Incudo — working notes for Claude Code

A system-agnostic tabletop character builder for desktop and mobile. Free, MIT, open source.
A replacement for the discontinued Aurora Builder that reads its entire content ecosystem.

**Read first:** `ROADMAP.md`, then `docs/ARCHITECTURE.md`, then the ADR whose number a task
cites. `docs/adr/README.md` is the index. The ADRs record *trade-offs*, not just choices —
when something here looks odd, the ADR usually says why.

## Commands

```bash
npm install            # ~70s, 535 packages: Expo is in, since apps/mobile became a workspace (ADR 0083), and its dev client (ADR 0099).
npm run desktop        # the app, at http://localhost:41730. No Rust, no icon, start here.
                       # Opens on the character library; pick a folder to see anything in it.
npm run desktop:app    # the real Tauri window — needs Rust. Builds now; the icon arrived.
npm run typecheck      # tsc --build --force
npm run corpus:sync    # fetch/fast-forward the official AuroraLegacy/elements into .corpus/ (gitignored)
npm test               # node --test, no build step. Includes the real-content suite below once
                       # `.corpus/` exists; without it those tests skip and say to run corpus:sync.
npm run fixtures:rebuild   # regenerate tools/verify/fixtures/aelin/ after a format change
npm run mobile         # the phone app's dev server (Expo Go); mobile:android opens it on an emulator or USB phone
npm run mobile:build:android   # build and install the phone app's own development build (Gradle; receives shared files)
npm run mobile:build   # serve that build (`expo start --dev-client`); `npm run mobile` stays Expo Go (`--go`)
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
GitHub Release (ROADMAP Phase 9): `.github/workflows/release.yml`, added 2026-10-07 for the first public release
candidate. A `vX.Y.Z-rc.N` or `vX.Y.Z` tag on a commit main has starts it; it stops unless the tag's X.Y.Z is the
version in `tauri.conf.json`, `Cargo.toml` and `apps/desktop/package.json` (the app's version never carries the
`-rc`: an .msi refuses one), runs `ci.yml` on the commit, builds on Windows, macOS (both chips) and Linux with
`tauri-action`, and leaves a **draft** release for the maintainer to publish. Unsigned, and its notes say so and say
only Windows was ever run by hand.

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
> internal pair is an Aurora omission or an over-grant is not settled. *(Since ADR 0071 the firearm 22 and the
> Thieves' Tools 8 are gone: both are granted elements whose own requirements are false, and element-extra is 43.)*

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
hour before the save, so it may have run on the older copy in memory — **unconfirmed**, and since ADR 0071 superseded:
the pair's own requirements are false and Incudo withdraws it too), 1
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

> **Note, 2026-09-23 — the counts re-measured differently.** `aurora-oracle.test.ts` reported speed
> differing (before ADR 0043) on **7** samples (10, 11, 12, 13, 19, 21, 27 — a Ranger, a Barbarian, a Druid, two Rogues, a
> Barbarian / Monk and a 2024 Monk), not 9, and hit points on **18**, not 17. The reasons named are unchanged.

> **Update, 2026-09-23 — speed now agrees on all 30 and is held to the readout** ([ADR 0043](docs/adr/0043-speed-is-the-race-base-plus-what-content-adds-to-it.md)):
> the player character kind derives it as `innate speed + innate speed:misc + speed:misc`, a system-definition
> change with no engine one. Hit points followed the same day (ADR 0044): all 30 agree and are held too.

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
0027), manages content sources (ADR 0028/0029), **lets a source's parts be switched off and a
dropped Aurora `.xml` be a source** (ADR 0055/0056), builds a character, **sets its ability scores by
all four of 5e's methods**, renders the sheet, **browses and searches everything loaded** (ADR 0053), reads and writes real `.incu` files into a folder
the user picks, **saves a copy anywhere** (ADR 0038), and **imports Aurora `.dnd5e` saves into it**, and **multiclasses**: a level can
be spent on any class the character qualifies for (ADR 0036). **It starts any kind the system declares**, and a 5e
**NPC starts from a creature's printed stat block** (ADR 0057), its challenge rating, armour class, hit points and
speed included, any of which the DM may replace, and what the creature gives it may be taken away (ADRs 0059-0061). Its
sheet shows the creature's other speeds, proficient saves and skills, and its senses, defences and languages as printed
(ADR 0062). A DM may write features of an NPC's own that add to or set its numbers (ADR 0063), and **put any feat, feature,
proficiency, language, condition or spell from loaded content on a player character or an NPC, whatever its prerequisites**
(ADR 0064). **A legendary creature takes legendary actions, lair actions and regional effects from a user's own file or
written by the DM on the creature**, and shows how many legendary actions it takes (ADR 0065). **An NPC keeps a stat
block printed only as prose beside it for reference**, shown and saved and never held, and may skip its creature to be
built by hand (ADR 0068). **What a description embeds is shown in place and saved with the character** (ADR 0069). **A player character keeps
text for reference too, offered first what its own elements print, and a library card names what a character keeps**
(ADR 0070). **A player character takes Tasha's optional class features, and one that replaces a feature replaces it** (ADRs
0071, 0072). **A creature a character holds is shown as its own stat block, its numbers derived from the character** (ADR
0073). **Each kind's sheet shows its printed page: a player character's saves, skills, modifiers and the spell slots it casts
with, an NPC's first line and printed dice, a Cairn character's entered scores** (ADR 0074). **The Sheet can be exported
as text: "Export sheet as text…" writes it as Markdown that reads as plain text** (ADR 0075). **A feature on the Sheet and
in the export is content's own sheet line, at the level its class reads, its numbers filled: "Rage (Bonus Action; 3/Long
Rest): …"** (ADR 0076). **"Print sheet…" prints the Sheet through the platform's own dialog, its sections in two columns**
(ADR 0077), **after a step of the app's own choosing its parts, page numbers and the name on later pages, and with no edge
of the page the dialog can write its date and address in** (ADR 0078). **"Export sheet as PDF…" writes that print to a file with no dialog in the Windows window, and "Fill the official sheet…" fills the user's own copy of the 2014 form** (ADR 0079). **Personality, appearance, backstory and notes are written on Build and shown on every sheet** (ADR 0092). **The Sheet
lists a character's attacks, every weapon in its bag with its bonus and damage, and fills the form's weapon rows** (ADR 0093).
**A spell added to a character is cast as a class the user chooses, always prepared there** (ADR 0097).
**A character takes its first class's and its background's starting equipment, or the gold instead, and holds money**
(ADR 0087, below).
**A user writes feats, traits, features, spells and the like in a homebrew source of their own on the Sources pane**
(ADR 0108, below).
**The phone app runs and shows a character's sheet, plays it (ADR 0084, below), builds and edits one (ADR 0086, below), and
receives a file shared to it (ADR 0099, below), an Aurora save imported on a tap (ADR 0101, below)** ([ADR 0083](docs/adr/0083-the-phone-app-is-expo-in-the-workspace-its-storage-is-sqlite-and-its-library-is-its-own-folder.md)),
Phase 6's first item and the read half of its second (it builds nothing). Things to know before touching it:

- **`apps/mobile` is a workspace** (Expo SDK 57, React Native 0.86, React 19.2, run in Expo Go). The install went from
  45 packages and 6 s to 519 and 69 s; `workspace.test.ts` asserts it is in. The desktop keeps React 19.3 nested;
  `metro.config.cjs` pins `react` to the app's copy and maps `@repo/systems` and `@repo/schemas` as Vite does. The
  package is an ES module (so `tools/verify` can import `@incudo/mobile/zip`), hence the `.cjs` Metro config.
- **`apps/mobile/src/platform.ts` is the only Expo-aware file**: `Storage` is one SQLite table (measured: a download is
  800 values, 14.75 MB, twenty keys over 255 bytes), the library is the app's own `library/` folder (the maintainer's
  choice; a picked folder is later), files come in through `File.pickFileAsync` and `CharacterLibrary.add`, which writes
  the picked container **unchanged**. DEFLATE is fflate in `src/zip.ts`, held to the desktop's zip by `mobile-zip.test.ts`.
- **The sheet is `sheetDocument` drawn natively** (`SheetView.tsx`, computing nothing). Content's HTML goes through
  `htmlToBlocks` (`packages/ui`), which shares `html-tree.ts` with the Markdown export; `tools/verify`'s
  `html-blocks.test.ts` holds both to the same words over all 15,671 corpus texts.
- **Hermes, measured on the emulator**: UTF-8 `TextDecoder`, `TextEncoder`, `\p{…}`, `URL` and `localeCompare` (same
  order as Node) work; `CompressionStream` is absent; **`TextDecoder('utf-16le')` throws**, which `content-files.ts` will
  meet when a phone adds a UTF-16 Aurora file.
- **Driven on the Pixel 9 Pro emulator in Expo Go by `adb`**: five samples packed in Node, added through Android's
  picker, opened with no source; in dev builds the sheet screen logs `[incudo] sheet <file>: <n> characters, sha256 <…>`
  of `sheetMarkdown`, and all five equalled Node's. Not run: a real phone, iOS, a release build (a development build
  since ADR 0099, below).
- **Export** (the sheet's header): "Save to a folder…" or "Share…", both `FileSaver`s in `platform.ts`, through
  `exportEntry`, which hands on the library file **unchanged** (never `saveCopy`, which repacks). The type is
  `application/octet-stream` on purpose: `application/zip` makes Android append ".zip". The provider never replaces a
  file ("name (1).incu", reported as such). Expo Go's floating tools button sits over the header's right corner; switch
  it off in its menu before tapping Export in a drive.
- **No icon or splash**: Expo's stand in, a marked gap (`brand/`'s tile is undecided). Never generate one.

**A character is played on the phone and the desktop alike, and what is spent is an input on it**
([ADR 0084](docs/adr/0084-play-state-is-an-input-on-the-character-and-what-it-tracks-is-read-from-the-sheet.md)),
the play half of Phase 6's second item. Things to know before touching it:

- **Measured first** (`tools/verify/src/play-state.test.ts`): Aurora's saves record no play state (`<slots>` are totals),
  so the frozen importer drops nothing; 632 of content's 968 usage hints are a count per rest or per day.
- **`Character.play`** (`{ spent?, temporary?, conditions? }`, keyed by tracker) is an input in ADR 0006's sense, in
  `character.json`, **format 8 only when recorded** (`setPlayState`; zeros never written). Never a derivation seed,
  never embedded, not in `summarize()`. A recorded key no tracker shows is kept.
- **A kind's `play`** (system format, optional, replaced along `extends`) declares rests (with `usage` templates such as
  `"{count}/Long Rest"`), trackers and conditions. A tracker reads its maximum from exactly one of `stat`, `rows` (a sheet
  section's rows, per block), `dice` (a section's `trackDie`), `uses` (listed elements whose filled usage reads as a
  rest's template) or `max`. `checkPlay` (schema.ts) refuses names nothing declares. Core and `packages/ui` name no rest,
  resource or condition: 5e's are in `systems/dnd5e/system.json` (pact magic back on a short rest by
  `restoresWhen` on `{name}:spellcasting:solo`).
- **`playView` (`packages/ui/src/play.ts`) reads every maximum off `SheetView`**, never recomputes one, and the edits
  (`adjustPlay`, `setPlaySpent`, `setPlayTemporary`, `setPlayCondition`, `restPlay`) are pure. The builder's methods of the
  same names **keep the derivation** (`playEdit` patches the cached state; `play-state.test.ts` holds `derived` to the
  same object). Wording both apps use is there too (`playValue`, `playRestNote`, `restEffects`).
- **The phone writes at once**: `CharacterLibrary.record` replaces `character.json` and the manifest's name, `updated` and
  checksum (`replaceContainerCharacter`, core) and nothing else, under ADR 0027's conflict check; `useRecorder` in
  `apps/mobile/src/App.tsx` debounces half a second and flushes on leaving. The desktop's Sheet has a Play section
  (hidden in print) and saves with Save.
- **The sheet document is unchanged**: play is not in it, so exports and the phone/desktop sheet checksum are untouched.
- In dev builds the phone logs `[incudo] play <file>: <play json>` after each write. Driven on the emulator and in the
  browser build; not in the Tauri window, on a real phone or iOS, and no NPC played in either app.

**A source is kept converted into Incudo's own form, and a phone builds with the desktop's builder**
([ADR 0085](docs/adr/0085-a-source-is-kept-converted-into-incudo-s-own-form-and-loaded-from-that.md),
[ADR 0086](docs/adr/0086-a-phone-builds-and-edits-with-the-desktop-s-builder-its-content-loaded-when-a-build-opens.md)).
Things to know before touching either:

- **`ConfiguredSource.keep`: `converted` (the default, also when absent) or `files`.** Converted, each index and file a
  load read is stored as the parser returned it, **one value per file** under `content/<source>/.converted/<url>`, and its
  raw XML removed; the next load reads that first (`ConvertingContentSource`, `composeForLoad`, `packages/content`) and
  converts only what came from behind it. One value for the whole source was tried first: 20 s for `expo-sqlite` to read
  21 MB back. Files, not a flat element list: the library folds appends across sources by file, and a converted load is
  held identical to a parsed one on the real corpus (`tools/verify/src/converted-source.test.ts`). Each value records
  `CONVERTER_VERSION`; a guard test hashes `aurora-import`'s parsing files, and when it fails, decide whether the same XML
  now parses differently (bump the version) and record the hash. A refresh converts again; one reaching nothing changes
  nothing. A refresh of a converted source downloads in full (no raw copy to answer a 304 with).
- **`Storage.apply(changes)` is optional** (`core`, `applyChanges` falls back): the phone's SQLite measured about 40 ms a
  statement alone, so a conversion is one transaction there. The desktop's and Node's storage do not implement it yet.
- **`loadSources` is `packages/content`'s now** (moved from `apps/desktop/src/content.ts`); the desktop and the phone call it.
- **The phone's content is `ContentSources`** (`packages/ui/src/content-sources.ts`): the profile, a system's suggested
  source added in download mode, switched, kept either way, refreshed, removed **with its cache**, and loaded once per set of
  sources, only when a Build screen asks. `restore` publishes once; the Build screen's effect depended on a list it
  published every call and rendered in a loop (found on the emulator, held by a test).
- **Build and Edit are one phone screen** (`BuildScreen.tsx`, rendering `BuildView`, memoized: a load's progress redrew
  the whole build and cost 18 s). Save is `saveEdit` (`packages/ui/src/edit-session.ts`) through `CharacterLibrary.save`
  under ADR 0027's conflict check; leaving unsaved asks. The sheet reopens its file on focus and Edit waits for play
  writes. Wording both shells share is `build-view.ts`; the desktop's panes call it too. **Second pass**
  (`BuildExtras.tsx`): what a creature gives, features of the user's own, additions and references, worded and grouped by
  `holderGrantSections` and its siblings (`build-view.ts`), `additionGroups`, `customLineWithMode` and the rest of
  `custom-features.ts`, `referenceSuggestionNote`; `build-sections.test.ts` holds them. A written feature's line is one row
  (stat through the `Picker` with `details: false`, Adds | Sets, number, Remove: the maintainer's choice). **Third pass**: the class
  split editor, inline behind "Set the split" (the maintainer's choice), and the progress control's "Use Wolf's (1/4)"
  link (`ProgressState.printedBy`); the split's rows, total and sentences (`splitDraftView` and siblings) and the link's
  words (`progressResetLabel`, `progressPrintedHint`) are `build-view.ts`'s, and the desktop calls them too. Not on the
  phone yet: a source of the user's own.
- **A Save rescans nothing** (ADR 0086's third pass): `CharacterLibrary.save` describes only the entry it wrote, from
  the files it wrote, as `record` does. Measured first on the emulator: the rescan was 2.3 of a PC Save's 3.2 s (every
  file inflated and parsed), and a Save is now 1.5 s (pack ~0.4, zip ~0.5, describing the one entry ~0.4). Back during a
  Save waits for it (`BuildScreen.tsx`, `pending`), and a frame passes before packing so the header says "Saving…".
- Driven on the emulator: a character built and a sample edited, exported, and read in Node to the phone's sheet
  checksum. Measured there: AuroraLegacy loads in 2.3 s converted, 6.6 s as files, 82 s from the network.

**A file shared to the phone, opened with it or picked is added by one function, and receiving needs the app's own build**
([ADR 0099](docs/adr/0099-a-file-shared-to-the-phone-is-added-as-a-picked-one-is-and-receiving-needs-the-app-s-own-build.md)),
the rest of Phase 6's import/export item. Things to know before touching it:

- **Measured first, on the emulator:** Expo Go registers no `SEND` filter and is not offered for `application/octet-stream`,
  which is what Android types both a `.incu` and a `.dnd5e`. So **the phone app has a development build of its own**
  (`expo-dev-client`, the maintainer's choice; `app.json` names `dev.incudo.mobile`, the scheme `incudo`, `expo-sharing`'s
  plugin for `SEND`/`SEND_MULTIPLE` and a `VIEW` intent filter on `content`, both for `application/octet-stream` and
  `application/zip`). `apps/mobile/android` is generated and ignored; build it again after a change to `app.json` or a
  native dependency. **Expo Go stays:** `npm run mobile` is `expo start --go`, said explicitly because with the dev client
  installed a plain `expo start` serves the build and Expo Go loads nothing (found by running it).
- **`receiveFiles` (`packages/ui/src/received-files.ts`) decides by contents, not name**: a zip that reads as a character
  goes to `CharacterLibrary.add` unchanged (a name not ending `.incu` is replaced by the character's), an Aurora save
  (`isAuroraSave`: XML whose root is `character`, BOM, declaration, comments and UTF-16 zero bytes skipped) is named and
  **offered for import, not imported** (`ReceivedView.saves`, the Import button; ADR 0101, below), anything else is refused
  with a sentence. It
  restores the library first when it is not `ready`: a share can start the app, and a free name chosen before the first
  scan would be chosen against nothing. A name with no extension is a provider's id (`msf:44`, Android's Recent files)
  and is not quoted. `receivedView` is the alert: title, a line per file, Open only when exactly one was added. The picker's
  "Add a character file…" calls it too.
- **`MobileShareInbox` (`platform.ts`)** reads `Linking` (a `VIEW`'s `content://` URL; `expo-sharing`'s
  `incudo://expo-sharing` for a share) and, at the start, whatever payloads `expo-sharing` holds whatever the first URL is
  (in a dev build it is the launcher's). It reads `expo-sharing`'s cache copy, then the sender's URI, then each raw payload
  when resolving rejects, and hands a file it cannot read on with `unreadable`, which becomes a sentence. `App.tsx` shows
  the alert over whatever screen is open and never replaces it.
- **A share that starts a development build arrives unreadable**: the launcher's new activity does not hold the sender's
  read grant. Warm shares, "Open with" and the picker all work. A release build has no launcher; none has been built.
- `workspace.test.ts`'s home-path check walks the working tree and skips `apps/mobile/android` and `ios` by path: the
  generated build caches are full of the builder's paths.

**On a metered connection the phone asks before a fetch that downloads a source, and the Stream/Download setting is gone**
([ADR 0100](docs/adr/0100-on-a-metered-connection-the-phone-asks-before-a-fetch-that-downloads-a-source-and-the-mode-setting-goes.md)),
Phase 6's last item. Things to know before touching it:

- **`ConfiguredSource.mode` does nothing and is kept.** Measured: both modes fetch in full when a source is added, nothing
  reads the field, and no default of it can save data. The desktop no longer offers it and writes `download`; profiles and
  `SourceRef`s still carry it, so do not remove it from the format for tidiness.
- **What an action fetches is `fetchCost`** (`packages/ui/src/fetch-prompt.ts`): a refresh downloads everything when the
  source is kept converted (no raw copy to answer a 304 with) and only what changed when kept as files; converted to files
  downloads everything again; files to converted fetches nothing. `fetchPrompt` asks only when `metered === true`, never
  on an unknown connection; `addSourceNote` adds the sentence to the Add question the phone always asks.
- **`MobileConnection` (`platform.ts`) reads NetInfo's `isConnectionExpensive`**, a native module: the development build
  was rebuilt for it, Expo Go has it. On the emulator `adb shell svc wifi disable` gives the metered LTE connection.
- The desktop does not ask (Windows says "metered" only through WinRT). A Build screen's load that finds a file missing
  from the cache fetches it unasked.
- Driven on the Pixel 9 Pro emulator from the Files app (share sheet, "Open with", three at once with a taken name and an
  Aurora save, the picker's Recent files), every sheet to Node's checksum; Expo Go run after. Not run: a real phone, iOS,
  a release build.

**An Aurora save shared to the phone, opened with it or picked is offered for import, and imported with the content a build
loads** ([ADR 0101](docs/adr/0101-an-aurora-save-received-on-the-phone-is-offered-for-import-and-imported-with-the-content-a-build-loads.md)),
Phase 6's last item. Things to know before touching it:

- **Measured first** (`tools/verify/src/phone-aurora-import.test.ts`, report-only plus one assertion): the desktop's
  `importAuroraSaveIntoLibrary` imports all thirty samples with the whole corpus and with only AuroraLegacy's core part
  (every one then names what it misses, 235 ids: reported, never blocked), refuses an empty index, **refused a name with
  no extension** (Android's Recent files hands the picker `msf:44`), and refuses a UTF-16 save with a sentence (it decodes
  as UTF-8 and never calls `TextDecoder('utf-16le')`, which throws on Hermes). UTF-16 is not added (ADR 0008). The
  assertion: every sample imported through the phone's path under a provider id opens to the desktop import's sheet.
- **`packages/ui/src/received-saves.ts`**: `saveImportStep(saves, { systems, sources, connection }, game?)` is the next
  question or `ready` — `choose-game` (a name whose extension names no system that declares `auroraTypeMap`, the format's
  "consumes Aurora content"; one button per such system), `switched-off` (Content), `needs-source` (the system's suggested
  source, `addSourceNote` after it, added kept converted), `no-source`. Asked again after every answer. Nothing is switched
  on or downloaded unasked, and the import is never automatic. `importReceivedSaves` loads each needed system's content
  once (`ContentSources.load`, shared with a Build screen), hands a file whose name does not say to the importer as
  `<name>.<system id>`, and unquotes that name in a refusal; `importedView` (taken name, missing count, "The import noted
  N things.", Open for exactly one) and `saveImportLine` are the words. `receivedView` gives `saves` and the button label.
- **The desktop's empty-content sentence lost "(ADR 0012)"**: no ADR number on screen.
- **`App.tsx` holds the flow** (`importSaves`, `presentReceived` in a context the picker uses too, `ImportLine` over the
  screen); it computes nothing. The notes alert carries Open as well: pressing Notes closes the result alert.
- Driven on the emulator in the development build: shared, picked from Recent files, no source (Wi-Fi and metered), three
  at once with taken names, the source off; every sheet equals the desktop's import. A fresh emulator imports in 6.3 s
  (3.6 s load); one swapping for hours took minutes, which is the machine. Not run: Expo Go's picker, "Open with", a real
  phone, iOS, a release build.

**A user system may be an overlay of another: a patch applied to its parent on every load and validated as the system it
makes** ([ADR 0102](docs/adr/0102-an-overlay-is-a-patch-applied-to-its-parent-on-every-load-and-validated-as-the-system-it-makes.md)),
Phase 7's first item. Things to know before touching it:

- **Measured first:** the root `extends` was in the schema and read by nothing; ADR 0011's example overlay was refused with
  three errors; 5e's `version` has read 0.2.0 through 72 commits, so the parent-version warning ADR 0011 asked for is declined.
- **An overlay is never seen past the validator.** `validateGameSystem(value, schemas, { parent })` recognises a root
  `extends`, checks the shell against `$defs/overlay` (`validateJson`'s `root` option), applies it
  (`applySystemOverlay`, `packages/core/src/system-overlay.ts`) and validates the result as a complete system; it returns a
  complete `GameSystem` keeping `extends`, plus `overlay: { parent, changes }`. Without `parent` an overlay is refused.
- **The patch:** an object merges (`null` removes a key); an array in `OVERLAY_KEYED_ARRAYS` merges by its identity (`name`,
  `id`, `key`; `suggestedSources` by `url`), merged entries keeping the parent's position and new ones appended, `"remove":
  true` removing one (one naming nothing is an `absent` change, not an error); a kind's `elementTypes` written as a `+`/`-`
  delta is applied to the parent's list; anything else is replaced. Guard tests hold the table to every schema array whose
  entries require `id`, `name` or `key`, `$defs/overlay`'s fields to the root's, and no identified entry to a `remove` field.
  **A new root field or identified array needs an entry in both**, or the guards fail.
- **The parent is a complete system**, shipped or the user's: an overlay of an overlay is refused with a sentence, as is
  one naming nothing or taking its parent's id. `UserSystemStore(storage, schemas, reserved, bases)` takes the shipped
  systems as `bases` (their ids are reserved), loads complete systems before overlays whatever the files are called, and
  publishes `overlays` by id. A character built in an overlay records the overlay's id.
- **`systemLineage(system)`** (core: own id, then the parent's) is what sources (`sourcesForSystem` takes a lineage),
  starting equipment (the builder) and form maps (desktop) match against. An overlay loads its parent's sources; a source
  keeps one tag, so switching it off there does it for the parent, which the Sources row says (`sharedSourceNote`).
- **Words:** `overlayView` (`packages/ui/src/system-overlay-view.ts`): "Built on …", one sentence per change, fields
  named in words (`NOUNS`), entries by label. The launcher folds them under the card. The shipped-id refusal lost "(ADR 0011)".
- Tests: `packages/core/src/system-overlay.test.ts`, `packages/ui/src/system-overlay-view.test.ts`, the lineage case in
  `packages/content/src/profile.test.ts`, `tools/verify/src/system-overlay.test.ts` (5e's overlay through the store, a fixed
  5e reaching it, a breaking change named, a Fighter built in the overlay deriving as in 5e with 5e's starting equipment),
  each failing under its named perturbation. The oracle is identical. Driven in the browser build only, the picker stood
  in for by a script; not the Tauri window, not the phone (which has no user systems yet).
- **Not done:** errors name the applied system's paths by index, not the overlay's lines; no overlay of an overlay; a new
  entry cannot be placed before another; a JSON editor pointed at `system.schema.json` validates an overlay as a complete
  system.

**A system definition's error says where it is: its line, and a path with ids in place of positions**
([ADR 0103](docs/adr/0103-a-system-error-says-where-in-the-file-by-line-and-by-the-ids-written-there.md)), Phase 7's
second item. Things to know before touching it:

- **`readJsonText` (`packages/core/src/json-text.ts`)** reads JSON and records where each value starts, under the path the
  validator renders (a member at its name, an array entry at its start), and names the common slips at their line. It is
  for locating only; `JSON.parse` reads values everywhere else. `json-text.test.ts` holds the two to the same value on every
  JSON file in `systems/` and `schemas/` and the same verdict on 4,000 broken variants. A leading BOM is read past (JSON.parse
  refuses one).
- **`describeSystemErrors(errors, file, positions, overlay?)` (`packages/ui/src/system-problems.ts`)** gives each
  `SchemaError` a `where` (an identified array's position replaced by the entry's id as written, other positions counted
  from 1, field names kept since the author searches for them), the line and column of the path or its nearest ancestor,
  sorted in file order; `systemProblemLine` is the one wording. For an overlay the errors are about the applied system
  (`SystemValidationResult.overlay.applied`) and are traced back to the overlay's text by id; one in a part the overlay
  does not write is `fromParent`, with no line.
- **`UserSystemStore`** reads with `readJsonText` and attaches `problems` to every failure and failed add; the desktop
  launcher lists all of them (`ProblemList`, five open). Shipped-system failures get problems without lines (no text).
- **Refused since:** an identity twice in any array of ADR 0102's table (`duplicateIdentities`, stat names ignoring case;
  arrays with a check of their own are in `CHECKED_ELSEWHERE`), and a generation method's `min` above its `max`. A guard
  test duplicates an entry of every table path in 5e and requires an error naming it.
- **Not done:** the 141 reference checks point at the container (they read resolved kinds, inherited parts included);
  reference checks run only once the structure validates, so a second round can appear. Driven in the browser build only.

**A new system starts from a file the app writes: a starter, changes to a shipped system, or a copy that keeps its origin**
([ADR 0104](docs/adr/0104-a-new-system-starts-from-a-file-the-app-writes-and-a-copy-keeps-what-it-was-copied-from.md)),
Phase 7's fork and scaffold items. Things to know before touching it:

- **Measured first:** a full copy of 5e under its own id validated and loaded no content (AuroraLegacy is tagged with 5e,
  a source has one tag) and lost 5e's starting equipment and form; an overlay changing nothing is refused for want of
  `version`; a shipped system as validated is deep-equal to its file.
- **`copiedFrom`** (system format, optional root, `formatVersion` 1; in `$defs/overlay` too) joins `systemLineage` after
  `extends`, each id once, so a copy loads its original's sources and is offered its starting equipment and form, and an
  overlay of a copy inherits it. Nothing checks the id exists. A copy of a copy records the origin.
- **`packages/ui/src/system-new.ts`** writes the text only: `newSystemChoices` (the starter, then changes to and a copy of
  each shipped system), `systemIdFor` (lowercased, accents dropped, hyphens, 64 characters, `-2`… when taken ignoring case:
  `UserSystemStore.add` replaces a same id, so a new system must never take one, a failed definition's id included),
  `newSystemFile`, `starterSystem` (Incudo's own words, builds with no content), `copiedFromNote`, `newSystemSavedNote`.
  Every new file is `version` 0.1.0 and has no `$schema` line.
- **The launcher saves, then adds** (`createSystem` in `App.tsx`): `FileSaver` with `<id>.json`, then those bytes through
  `UserSystemStore.add`; a cancel adds nothing. Editing is the user's editor and **Add a system…** again.
- Tests: `packages/core/src/system-lineage.test.ts`, `packages/ui/src/system-new.test.ts`, `tools/verify/src/system-new.test.ts`
  (every start added and loaded through the store against the real schema; the starter built; a copy of 5e's sources and
  starting equipment), each failing under its named perturbation. The oracle is identical. Driven in the browser build only.

**How to write a system definition is `docs/SYSTEM-GUIDE.md`, every block of it read by a test, and a stat name one slip
from a declared one is a warning when a system loads**
([ADR 0105](docs/adr/0105-a-stat-name-one-slip-from-a-declared-one-is-a-warning-when-a-system-loads.md)), Phase 7's guide
item. Things to know before touching either:

- **Measured first**, growing the starter as an author would: of 334 field paths in the schema (expressions aside) the
  starter writes 57, Cairn a subset of those, and 242 have an example only in 5e; 32 have none at all. 5e's 152 formulas
  run 27 to 736 characters (median 210; `floor((x - 10) / 2)` is 190). Four slips validate: a misspelled stat in a
  `derive` (Health read 2 for 16, no problem anywhere), a budget target, a step type missing from a kind, a point-buy
  with no costs. **The starter's Traits and Gear steps offered nothing** (neither required, `pick` nor `multiple`); they
  are sets now. `auroraTypeMap` maps nothing: its presence is the "reads Aurora content" flag, and the guide says so.
- **`SystemValidationResult.warnings`** (`systemWarnings`, `packages/core/src/system-warnings.ts`): a stat name in a
  `derive`, a contribution, a per-track stat, a budget target or a `startsFrom` that nothing the kind resolves declares and
  that is within one edit of a declared name (two for five letters or more), case ignored, `{…}` templates skipped.
  **Not "every undeclared name"**: 5e's player character names 72 of its 87 formula stats without declaring them, for
  content to supply, and a test holds both shipped systems and the starter to no warning. Never a refusal.
  `UserSystemStore` locates them like errors (`LoadedUserSystems.warnings` by id, `AddSystemResult.warnings`), the
  launcher lists them under the card after `systemWarningsNote`.
- **The guide's fences are its contract** (`tools/verify/src/system-guide.test.ts`): `json system` (validates, no warning,
  nameable in `extends`), `json overlay`, `json refused` / `json warns` / `json slip` each followed by `text problem` (exactly
  `systemProblemLine`'s output), `json $defs/<name>` (a fragment against that part of the schema), `xml content` (parses,
  types declared), `text sheet` (the worked example built from that content). An untagged `json` or `xml` block fails.
  Edit the guide's examples by running that test.
- **An overlay merges an expression key by key**: replacing a binary `derive` with a `ref` keeps `op`, `left`, `right` and
  is refused with "In <parent>'s part…" (ADR 0103 locates only what the overlay writes). The guide shows the `null`s that
  fix it. Locating such an error at the overlay's own `derive` is an open improvement.
- Not done: the app links to the guide (waits for the published schema's address); the `$schema` lines the guide suggests
  were not tried in an editor. Driven in the browser build only.

**Shipped and user systems are read by one loader, and differ only in where they came from**
([ADR 0107](docs/adr/0107-shipped-and-user-systems-are-read-by-one-loader-and-differ-only-in-where-they-came-from.md)),
Phase 7's last item. Things to know before touching it:

- **`packages/ui/src/system-loading.ts` reads every definition**: `readSystemDefinition` (`readJsonText` when there is text,
  `validateGameSystem`, `describeSystemErrors` for errors and warnings), `loadSystemDefinitions` (complete systems before
  overlays, each loaded one a possible parent beside `bases`). `UserSystemStore.load`/`.add`, the desktop's and the phone's
  `loadShippedSystems` (`loadShippedCatalog`, which also checks the shipped starting equipment) and the tests'
  `loadShippedSystem` all call it. Do not write a fourth reader. The desktop imports the shipped files with Vite's `?raw`
  (`env.d.ts` declares it), so their problems have lines; Metro gives the phone values, so its do not.
- **`systemCatalog(shipped, user)`** is what the launcher renders: systems, failures and `origins` (`'shipped'` | `'user'`),
  overlays, warnings. `systemFailureNote(origin)` and `systemOriginLabel` are the words: a shipped failure says it comes
  with Incudo, only a user's says to add the file again. A user's card keeps "yours" and Remove; a shipped one has no badge.
- **A file shipped beside a system is checked against every system its lineage hands it to**: `startingEquipmentFits` is
  `checkStartingEquipment`'s system half (lineage, kind, steps, units); `startingEquipmentFor` is the builder's choice and
  offers a file only when it fits, and `systemCatalog` warns on the card once per distinct reason. Measured: an overlay
  with no gold was offered 5e's wealth roll in gold and wrote `money: { gp }`, which its own system refuses. The form map
  has no system half.
- Tests: `tools/verify/src/system-loading.test.ts`, each case failing under its named perturbation. Driven in the browser
  build only (user files written into its storage). A user's system shipping starting equipment of its own is 1.x.

**A feature written once is kept in the user's feature library, a file beside the characters, and given to any character of
its system as a copy that remembers where it came from**
([ADR 0106](docs/adr/0106-a-user-s-features-are-kept-in-a-file-in-the-library-folder-and-given-to-a-character-as-a-copy-that-remembers-where-it-came-from.md)),
Phase 8's reuse item and its exit criterion. Things to know before touching it:

- **Measured first:** only a line that adds is an element rule; a set or a mark is a start the engine reads from the
  character, so the library holds features, not elements. 5e's three kinds name the same 34 stats; an NPC may set 7 a
  player character works out (`ac`, `hp`, the speeds), and the NPC's and PC's feature types do not overlap.
- **`incudo-features.json` in the character library folder** (the maintainer's choice), schema
  `schemas/feature-library.schema.json`, `formatVersion` 1, every system's features in one file, each `{ id, system,
  revision, name, description?, type?, stats }`. A user's own file, so a public format. `checkFeatureLibrary`
  (`packages/ui/src/feature-library.ts`) is the one checker; a missing file is an empty library, a broken one is
  `unreadable` and **never written over**. The library scan already ignores it (only `.incu` and folders with a manifest).
- **`CharacterStore.readFile` / `writeFile`** (optional; a plain name only, `assertPlainFileName` in core's `platform.ts`),
  in the Tauri, browser and phone stores. `FeatureLibrary` reads the file before every write and applies one change to
  what it read. The desktop makes one in `App.tsx` (loaded when Build opens or the folder changes); the phone's is
  `Platform.features`, sharing the library's store.
- **`CustomFeature.library`** (`{ id, revision, edited? }`), **format 12** only when recorded; the validator refuses it below.
  Nothing derives from it. The builder: `giveLibraryFeature` (one copy per library feature; the library's type only where
  the kind lists it), `updateFromLibrary` (text and lines, never the character's type), `linkCustomFeature` (after a save
  to the library); `updateCustomFeature` marks a linked copy `edited` when its name, description or lines change.
- **`featureLinkView` / `featureLibraryView`** word everything: an update is offered only when the library's revision is
  higher **and** the text or lines differ; "Save to your feature library" / "Save changes to your feature library" (the
  character's Save is already "Save to library"). Desktop `panes/CustomFeatures.tsx`, phone `BuildExtras.tsx`; both
  compute nothing.
- Tests: `packages/ui/src/feature-library.test.ts`, `tools/verify/src/feature-library.test.ts` (5e's NPC and PC, no
  content), the format in `schemas.test.ts`, each failing under its named perturbation. The oracle is untouched (no import
  path changed). Driven in the browser build, the Tauri window on Windows (DOM events over the debug port, a scratch
  folder) and the development build on the Pixel 9 Pro emulator (`adb` taps, the file read back with `run-as`): give,
  save back, update, Remove's confirmation, a broken file left untouched, and on the phone a file changed outside the app
  read again on entering Build. Not with real keys or mouse, not Expo Go, a real phone, iOS, macOS or Linux.
- **Never `window.confirm`, `alert` or `prompt` in the desktop shell**: `tauri-plugin-dialog` makes them async in the
  window, so `if (!window.confirm(…))` asked nothing (Remove from library, a rest). `ArmedButton` asks by a second
  click; `tools/verify/src/desktop-dialogs.test.ts` fails on a call. **The phone's `NumberField` keeps a number 400 ms
  after typing stops**: hiding the keyboard with Back does not blur the field, and a button pressed next read the old value.

**A user writes elements in the app into a homebrew source of their own, kept in Incudo's own content format**
([ADR 0108](docs/adr/0108-a-user-writes-elements-into-a-homebrew-source-of-their-own-kept-in-incudo-s-content-format.md)),
the first slice of Phase 8's element editor. Things to know before touching it:

- **Measured first** (`tools/verify/src/homebrew-elements.test.ts`, report-only): of the kinds' addable types, a slice of
  name, description, setters, tags, add-a-number lines and plain grants writes 95% of the corpus's spells and 98% of its
  languages but 22% of its class features (prerequisites) and 9% of its feats (choices). 1,078 of 1,079 spells carry the
  support tags a class's spell list selects by, which is why tags are in the slice.
- **`ConfiguredSource.kind: 'homebrew'`** (`packages/content/src/homebrew-source.ts`), id and URL `homebrew:<slug>`, body
  under `sources/homebrew/<id>` (outside `content/`: the only copy), removed with the source; no update check, no refresh,
  never converted (`keepsConverted` is true only for an index). The body is a `ContentBundle` (`{ formatVersion: 1,
  elements }`, each element less `origin`), checked by `checkHomebrewBundle`, the one checker; one that does not read
  fails the load with a sentence and `writeHomebrew` never writes over it. `HomebrewContentSource` re-reads the body on
  every load and stamps `origin.format: 'incudo'` (the first producer of it). **Its one file ref ends `.json`**
  (`homebrewFileUrl`): `isElementFile` decides by extension, and a ref named `homebrew:x` loaded nothing.
- **`packages/ui/src/homebrew.ts` is the editor's view-model**: `homebrewTypes` (every kind's `additions.types`, system
  order), `homebrewStats` (every kind's `customFeatureStats`, once each: ADR 0106's add line is the element rule),
  `homebrewDraftOf` (an element with anything the editor does not write is locked, never opened), `saveHomebrewDraft`,
  `mintHomebrewId` (`ID_HOMEBREW_<TYPE>_<NAME>`, `_2`… against the source and loaded content ignoring case; minted once,
  a rename keeps it), the description as escaped `<p>`/`<br />` HTML and back, setter and tag suggestions read off loaded
  elements of the type, grant options through Browse's catalog. No game noun; no character format change.
- **Desktop**: Sources pane, "Write your own" → **Make a homebrew source**; on its line **Edit elements** opens
  `panes/HomebrewEditor.tsx` (computes nothing); a save writes and reloads. The source's Remove is an `ArmedButton`.
  The phone loads a homebrew source in its own profile and has no editor.
- Tests: `packages/content/src/homebrew-source.test.ts`, `packages/ui/src/homebrew.test.ts`,
  `tools/verify/src/homebrew-source.test.ts` (a feat and a language given to a 5e PC, reopened with no source, a later
  edit offered by the refresh; with the corpus, a spell copying Magic Missile's setters and tags offered by a Wizard's
  spellbook), each failing under its named perturbation. The oracle is identical. Driven in the browser build only.
- **Not done:** choices, prerequisites, level gates; races, classes, backgrounds, items; a library feature turned into
  content; export (Phase 8's next item); the Tauri window.

**The sheet ends with the whole descriptions of what its sections list**
([ADR 0114](docs/adr/0114-the-sheet-ends-with-the-whole-descriptions-of-what-its-sections-list.md), Phase 5). Things to
know before touching it:

- **Measured first** (`tools/verify/src/whole-descriptions.test.ts`): 18,000 to 83,000 characters a sample, 61% of it the
  race, class and background chapters. The maintainer chose features, spells and a held creature's traits, actions and
  reactions (about 11,000 a sample), in a part after the sheet.
- **`describe` on a sheet section** (system format): 5e's `pc` Features & Traits and Spells, and its held creature's
  Traits, Actions and Reactions. `SheetSectionView.describe`; `sheetDescriptions` (`packages/ui/src/sheet-descriptions.ts`)
  builds `BuilderState.descriptions` through the builder's index (a save reopened with no source shows the same), once
  per element, a creature's groups "<creature>: <section>". **`SheetDocumentSource.descriptions` is required** (as
  `freeform`): the phone's App passes it.
- Renderers: desktop `SheetPane.tsx` (`DescriptionText` in `References.tsx`), phone `SheetView.tsx`, Markdown (`##`, `###`
  group, `####` element, content's headings from `#####`), print part `descriptions` (`print-options.ts`; CSS
  `.sheet-descriptions`, a page of its own).
- **The form**: a flow's list may declare `describe`; `formValues` writes each head and its whole description in plain
  words (`runsText(htmlToRuns(…))`) when all of them fit (`flowFits`), else the heads. 5e's Features and Traits: whole on 5
  of 30 samples.

**An NPC's scores start where its creature prints them, and a score the DM types replaces the print**
([ADR 0057](docs/adr/0057-a-creature-s-printed-scores-are-where-an-npc-starts-and-the-dm-may-replace-them.md)). Phase 4's first item. Things to know before touching it:

- **Measured first, and it moved the design.** The corpus has no `Creature`, `Legendary Action`, `Lair Action` or
  `Regional Effect` element: the kinds were written around four types nothing declares. A creature is a `Companion`
  (141, familiars, beasts and class summons, CR 0 to 8) that prints its six ability scores as setters and nowhere
  else, and states armour class, hit points and speed a second time as its own `companion:*` rules. The 2025
  Monster Manual is 32 such creatures plus 45 prose-only stat blocks (`Information`), seven of them legendary as text.
- **`setterStats` on a kind** (`packages/core/src/setter-stats.ts`): a held element's setter is where a stat *starts*.
  It lands where a declared default lands, before `baseStats`, so a typed score replaces it and contributions add to
  either. A printed 12 and a typed 14 is 14, not 26 — why neither a `contribution` nor a builder copying into
  `baseStats` was used. A value is a whole number or a fraction with at most one parenthesised note; anything else
  (`14 + PB (natural armor)`) starts nothing and warns (`setter-not-a-number`); two suppliers warn. One function
  answers it for the engine and for `budget.ts`, whose rows carry `printed` and count a printed target as set.
- **5e's `npc` reads the six scores that way, and `ac`/`hp`/`speed` start from `companion:*`** (ADR 0059, below). The six
  scores are redeclared **capped at 30**: the system's are a player character's 20, which clipped the Triceratops and
  Tyrannosaurus (found by `npc-creatures.test.ts`, not foreseen).
- **A fresh NPC is offered 117 of 141**: 24 creatures carry their own requirements naming a PC's subclass, feat or
  class level, and a candidate list leaves them out. Content being right, not a filter.
- **A stat may start where another stat is** ([ADR 0059](docs/adr/0059-a-stat-may-start-where-another-stat-is-and-a-typed-value-replaces-it.md)).
  `startsFrom` on a stat names another stat; when content contributes to that one, its value is where this one starts.
  The order of starts, most general first: `default`, `startsFrom`, a held element's printed setter, the user's
  `baseStats`; contributions to the stat add to whichever is in force. The NPC's `ac`, `hp` and `speed` are `default: 0`
  and `startsFrom` the creature's rule, so a typed value **replaces** the creature's rather than adding to it (the old
  `derive` added). A required step, Armor Class, Hit Points and Speed, is a budget with one method, `entry` (from 0, no
  maximum: the Tarrasque has 697). `DerivedCharacter.starts` publishes every start content supplied, even when a base
  replaced it, and `budget.ts` reads a row's `printed` from it rather than recomputing setters. A budget offering one
  method applies its bounds unrecorded.
- **An NPC's challenge rating starts where its creature prints it**
  ([ADR 0060](docs/adr/0060-a-character-may-leave-its-progression-to-what-it-chose-and-that-is-format-3.md)).
  **`Character.progress` is optional**: absent means "where the kind says it starts", which is what an element the
  character *chose* prints for the progression's stat (a `setterStats` entry naming it, 5e's `challenge`), or else the
  progression's start. Read it through `characterProgress(character, kind, index)`, never `character.progress`
  directly: the engine settles it once before the fixed point (choices only, because gates read it), fills it into
  every internal step (`Progressed`), and publishes `DerivedCharacter.progress`; the collector, the builder
  (`BuilderState.progress`, `setProgress(undefined)` to go back) and a library card (`libraryEntryProgress`, from the
  `chosen` elements an entry keeps for a character that records none) ask the same function. 121 of 141 creatures print
  a numeric rating; 20 print `—` and start at 0, since 2026-10-12 with no warning: a dash alone reads 0
  (`readSetterNumber`, the maintainer's call: it is how a book prints a rating that is none, and the lowest there is).
- **Character format 3, and only for the characters that need it.** A character with no `progress` or with
  `removedGrants` is `formatVersion` 3 (`raiseFormatVersion`, `LATEST_CHARACTER_FORMAT_VERSION`); `createCharacter`
  still writes 2, and only `setProgress(…, undefined)`, `createCharacter({ progress: null })` and `setGrantRemoved` raise
  one. Nothing downgrades. The validator refuses either field below 3. The frozen importer and every PC are untouched.
  *(Since ADR 0063 a character that records `customFeatures` is **4**, and since ADR 0064 one that records `additions` is
  **5**, and since ADR 0065 one with a custom feature that records its `type` is **6**, and since ADR 0068 one that
  records `references` is **7**, and since ADR 0084 one that records `play` is **8**, and since ADR 0094 one with a custom
  feature line that marks a row is **9**, and since ADR 0097 one that records `additionBlocks` is **10**, and since ADR
  0087 one that records `money` or `startingEquipment` is **11**, and since ADR 0106 one with a custom feature copied from the
  feature library is **12**, and since ADR 0111 one that records `spellAttacks` is **13**; `LATEST_CHARACTER_FORMAT_VERSION` is 13.)*
- **A DM may take away what the creature gives** ([ADR 0061](docs/adr/0061-what-a-creature-gives-may-be-removed-from-its-npc-as-a-recorded-input.md)).
  `Character.removedGrants` cancels what a *holder* gives: its setter's naming and its own `<grant>` of the same id (12
  creatures grant what they also name, so stopping only the setter would do nothing for them), and since ADR 0067 any
  `<grant>` of its own. Chosen, or granted by anything else, the element is still held. `setterGrantIds(defs, element,
  removed)`, `holderGivenIds` and `withdrawnGrantIds` are the only readers, used by the engine and by
  `collectCharacterContent`, so a removed trait is neither derived nor saved; a save opened with no source therefore
  cannot name it, and the pane says so rather than printing an id. The builder publishes `holderGrants`, refuses to
  remove what no held element gives, and forgets a removal nothing names once the creature
  changes. Not "one grant cannot cancel another": that is still content's, and still open.
- **A creature's traits, actions and reactions are granted through its setters**
  ([ADR 0058](docs/adr/0058-a-setter-may-name-elements-its-holder-has-and-the-kind-says-which.md)). A kind's
  `setterGrants` names a setter, on some types, whose comma-separated ids the holder is granted like a `<grant>`.
  `setterGrantIds` (`packages/core/src/setter-grants.ts`) is the only reader, called by the engine's expansion and by
  `collectCharacterContent` **when it is given the kind** — without it they derive and are not saved. Per setter and
  never inferred: 212 item `proficiency` setters name ids and are requirements, not grants. Split and trimmed only
  (three Tasha's ids end in `>` and are declared so). `pc` declares none, so a ranger's companion does not give the
  ranger its bite. A set step (`multiple`) now leaves out everything the character holds, not only its own picks.
- **An NPC's other speeds, saves and skills are its creature's rules under names of its own, and its senses are what
  it prints** ([ADR 0062](docs/adr/0062-an-npc-s-other-speeds-saves-and-skills-are-its-creature-s-rules-and-its-senses-are-what-it-prints.md)).
  A creature's skill and save rules read `companion:proficiency`, which only class summons supply themselves (for the
  rest, Aurora's app does). The `npc` kind contributes it, `= proficiency`, **unbucketed**: in `base` the Steel
  Defenders' own `-2` "PB removal" zeroes every proficiency they have. It is the one `companion:` stat the kind writes, and an input, not a name
  on the sheet. `speed:<mode>`, `<skill>:proficiency` and `<ability>:save:proficiency` `startsFrom` the creature's
  `companion:<same>`; `<skill>`, `<ability>:save` and `perception:passive` derive, reading `…:misc` so content written
  for a character adds. Senses, defences and languages are prose in every creature and are shown, never parsed. **So is
  the speed line** (2026-10-12, the maintainer's call: every speed a stat block declares is printed explicitly): the NPC,
  the legendary creature and a held creature's Stat Block print "Speed, as printed" beside the derived numbers, which is
  where "(hover)" (4 creatures), a swim-only speed and "see bad flier below" are; all 141 creatures print one.
  `kind-sheets.test.ts` holds it for every creature in both kinds and a hovering one held.
  **A sheet section may declare `showWhen`** (a row shows only when that stat, `{stat}` for the row, is non-zero),
  **`printed`** (a held element's setter as written) and **`description`**; `renderSheetSection` takes a `SheetReader`
  and decides all three, so the pane still computes nothing. No editor for the new stats: only the walking speed has one.
  *(Since ADR 0094 a written feature's line may mark a save or skill, below.)*
- **A DM may write a feature of the NPC's own, "Godspeed: Speed 60"** ([ADR 0063](docs/adr/0063-a-character-may-carry-features-its-user-writes-which-add-to-a-stat-or-set-where-it-starts.md)).
  `Character.customFeatures` (format **4**, only when present): a name, a description and lines that each **add** to a
  stat (an unbucketed rule on the feature) or **set** where it starts. A set sits after a creature's print and before a
  typed base: `default` → `startsFrom` → printed setter → custom set → `baseStats`, contributions adding to whichever
  is in force. A typed value still wins, and says so three times: `custom-feature-replaced` in the derivation, the
  feature line's status, and the entry step's row (`BudgetRow.featureNote`). A kind opts in with
  `customFeatures: { type }`, the element type the feature is held as (5e `npc`: `Companion Trait`, so it is listed
  with the creature's traits; `pc` since ADR 0094, below). **What a line may name is what the kind's sheet shows**
  (`customFeatureStats`), not every labelled stat: that first version offered an NPC spell slots and item slots, found by
  running it. **And never an ability score, for any kind**: `customFeatures.sections` lists the sheet sections a feature
  may name, and 5e leaves out Ability Scores (they have their own editor). **Reuse across characters
  is a Phase 8 item and part of its exit criteria.** A feature lives in `character.json`, is held as `custom:<id>` in front of the content, and is never
  embedded content. The editor's state is `packages/ui/src/custom-features.ts`; `CustomFeatures.tsx` computes nothing.
- **A player character's written features only add, and a feature line may mark a row**
  ([ADR 0094](docs/adr/0094-a-player-character-s-written-features-only-add-and-a-feature-line-may-mark-a-row.md)). Things
  to know before touching it:
  - **5e's `pc` declares `customFeatures`** (the maintainer's choice): Class Feature by default, Racial Trait, Feat or
    Background Feature, all listed under Features & Traits; sections Combat, Other Speeds, Saving Throws, Skills, Senses.
    Measured: those 34 stats all derive, so every line adds and "sets it to" is greyed. No content reads `[type:feat]`.
  - **`mode: "mark"`** on a custom feature line names a sheet *row* and a count (0, 1, 2…). It applies only where the
    row's section declares a `mark` (ADR 0079) and the mark stat (template filled) is **declared by the kind, with no
    `derive`**: then it sets where that stat starts to count × the mark's `per`, read from the previous pass, so an NPC's
    marked skill follows its challenge rating. The condition is what keeps it off a PC, whose `…:proficiency` is
    content's (a start would be added to content's) — never name a kind to decide it. `CustomFeatureStat.mark`
    (`{ stat, per, choices }`, choices the mark's `none` then its labels) is the one reader; `CustomSet.per` carries it to
    the engine. A count past the labels or a mark on an unmarkable row is `custom-feature-stat`; two marks of a row are
    `custom-feature-conflict`. **Format 9** only when a line marks (`setCustomFeature`), the validator refuses it below.
  - **A sheet `mark` may declare `none`** (5e: "not proficient"), offered by the editor and never shown beside a row.
  - **5e's NPC and legendary creature declare their saves' and skills' marks**, so their sheets read "+5 (proficient)",
    "+7 (expertise)" (the maintainer's call; every NPC export changed). Measured: all 300 rows the 141 creatures show
    hold a whole number of the NPC's bonus. ~~A held creature's stat block declares none.~~ It does since 2026-10-12, in
    its own bonus (`companion:proficiency`): measured over all 141 creatures, 294 of 300 shown rows hold a whole number of
    it (25 skills read "expertise", as content doubles them: the 2025 Owl's Perception, the Steel Defender's); the 6 that
    do not are fixed numbers content writes (a UA Ancient Companion, upstream's Eberron homunculus) and read the whole
    bonuses they hold. `companions.test.ts` holds the rest.
  - **The editor** (`customLineModes`, `customLineModeAllowed`, `customMarkChoices`, `customFeaturesHint`, in
    `packages/ui/src/custom-features.ts`): "marked" only where a row may be, its value a list of names; the hint is worded
    from what the kind's lines can do (a PC's says only that a line adds). Desktop `CustomFeatures.tsx`, phone
    `BuildExtras.tsx` ("Marked" and a picker).
  - Tests: `packages/core/src/custom-feature-marks.test.ts`, `packages/ui/src/custom-feature-marks.test.ts`,
    `tools/verify/src/pc-custom-features.test.ts`, the last test of `npc-creatures.test.ts`, each failing under its named
    perturbation. The oracle is identical. Driven in the browser build only (selects set through the DOM).
- **A user may add an existing element to a character, and an unmet prerequisite is a flag**
  ([ADR 0064](docs/adr/0064-a-character-may-carry-elements-its-user-adds-from-loaded-content-and-an-unmet-prerequisite-is-a-flag.md)).
  ADR 0063's sibling, for the player character and the NPC alike. Things to know before touching it:
  - **`Character.additions` is a list of its own, never a recorded choice** (format **5**, only when present; the
    validator refuses it below 5 and an id twice). A choice record was the obvious shape and is wrong: `pickAnswerOf`,
    `replacePickAnswer` and `firstClassOf` find records *by the types they hold*, so an added Origin-typed element
    would answer a pick. `packages/ui/src/additions.test.ts` holds that, by perturbation.
  - **The kind says which types** (`additions: { types, description }`, replaced along `extends`; a type the system
    does not declare is refused when it loads). 5e's `pc` and `npc`: Feat, Racial Trait, Class Feature, Archetype
    Feature, Background Feature, Proficiency, Language, Condition, Spell. Not what a character *is* (race, class,
    subclass, background, creature, option), not items. The NPC sheet gained two sections for them.
  - **The engine seeds an addition like a choice but never defers it**: it follows no class's track, so its level gates
    read the character's own progression. One of a type the kind does not list is `addition-not-allowed` and not held.
    **After the fixed point each held addition's own requirements are asked, with the element itself counted as not
    held**, and a false one is `requirement-unmet`, a warning, the code that had been declared and never emitted. Only
    additions: picks were offered only when they qualified, and checking every held element would add problems to
    derivations nothing else moved. *(Since ADR 0096 a held pick is asked too, once per element; 0 samples flagged.)*
    `collectCharacterContent` seeds from them, so a save embeds them.
  - **The offer is every element of the declared types, whatever its requirements, less what is held**, read through the
    offered view (ADR 0049), and asked for on request (`additionOptionsFor`), not carried in the state: it is thousands
    of elements. A row's flag is read from the derivation's own `requirement-unmet`, so the row and Problems cannot
    disagree. The prerequisite *text* is prose in the description (475 elements) and is never parsed.
  - **Removal drops the answers to the selects it closed, exactly**: a recorded choice goes when its pool was open before
    the removal and is not after, repeated until nothing more closes. By name (`<element>/select:`) would be wrong: a
    pool another element still opens keeps its answers.
  - ~~**An added spell belongs to no casting block**~~ It is cast through a block the user names since ADR 0097 (below,
    "An added spell is cast through a block"); without a record it is still in none.
  - **The corpus's `Condition` type is 23 damage resistances and immunities**, not Blinded or Charmed. Found by running it.
  - `packages/ui/src/additions.ts` is the view-model; `Additions.tsx` computes nothing. Driven in the browser build only.
- **The roadmap's legendary and 2025 Monster Manual items were reworded** by the measurement: decide where legendary
  content comes from first, and show the prose stat blocks as reference rather than parse them. Both are done: the second
  is ADR 0068, below. The first:
- **Legendary content is content of the types the system declares, from a user's file or written by the DM**
  ([ADR 0065](docs/adr/0065-legendary-content-is-content-of-the-types-the-system-declares-and-a-dm-may-write-it-on-the-creature.md)).
  Things to know before touching it:
  - **Measured by `tools/verify/src/legendary-content.test.ts`**: nothing in the corpus declares, names or grants a
    `Legendary Action`, `Lair Action` or `Regional Effect`; seven 2025 prose stat blocks have a Legendary Actions heading,
    none a lair or regional one, none a cost, each three uses. The 2025 rules have no lair actions in a stat block.
  - **No format of its own and no engine noun.** The system declares the types; an element of one from any source is
    offered, held, listed, granted by a `<grant>` and embedded like anything else. A user's own file (ADR 0056) is the
    reusable way in, and `tools/verify/fixtures/legendary/` is a generic example of one, a creature granting its own.
    No setter names legendary content (0 in the corpus): speculative support for a frozen format.
  - **A written feature may be held as any type its kind lists** (`customFeatures.types`, `type` the default and among
    them; the validator refuses an undeclared one or a list without the default). `CustomFeature.type` is recorded only
    when it is not the default, and only then is the character **format 6**; the validator refuses it below 6. A recorded
    type the kind does not list is `custom-feature-type` and the feature is not held, and the editor names it as the sheet
    would head it (`typeLabel`: "Legendary Actions (not available)"), never by the type's own name. `customFeatureTypes` and
    `customFeatureType` (`packages/core/src/custom-features.ts`) are the only readers. 5e's NPC lists trait, action and
    reaction; the legendary kind redeclares `customFeatures` with its three types and its Legendary Actions section.
  - **No cost field** (the 2025 rules print none; a 2014 one is in the name). **`legendary actions`**, "Legendary Action
    Uses", default 3, is a stat of the legendary kind on its Legendary Actions section, changed by a feature, not typed:
    an entry target with only a default would be open on every legendary creature.
  - **The legendary kind's two steps are sets.** As optional single picks they were offered nowhere: a non-required pick
    is not a top-level pick, so there were never "three empty pickers", there was nothing.
  - **An NPC built on a creature that grants legendary content lists it** (ADR 0065 decision 7, amended the same day):
    the `npc` sheet has the legendary kind's two sections, types only, so they are hidden (`sheetSectionIsEmpty`) on
    every NPC whose creature grants none, and each says that uses and more are a Legendary Creature's. The NPC still
    declares none of the types, offers none, and has no uses stat; `legendary-content.test.ts` reads the legendary types
    as the difference between the two kinds' `elementTypes`, so adding them to the NPC's would empty that test.
  - ~~**A creature's own `<grant>`s cannot be removed from its NPC**~~ (found here, fixed by ADR 0067, below).
  - **The kind's description is a line under the Characters header** for the kind New character makes. It was a
    tooltip on the chooser's options, which a dropdown never shows.
- **Driven in the browser build and, since 2026-09-28, in the Tauri window on Windows**: a real file drop and the native
  "Choose files…" dialog, a Legendary Creature with taken and written legendary actions and a "Lair" adding a use, saved
  and reopened with the source off. The browser build used an origin-private folder for the native folder picker.
- **What a creature grants may be removed like what it names, and only a holder's gifts are**
  ([ADR 0067](docs/adr/0067-what-a-creature-grants-may-be-removed-like-what-it-names-and-only-a-holder-s-gifts-are.md),
  amending ADR 0061). Things to know before touching it:
  - **A holder is an element of a type the kind's `setterGrants` reads** (`isGrantHolder`), and what it gives is its setter
    ids then its own `<grant>` ids, once each (`holderGivenIds`, `packages/core/src/setter-grants.ts`). `withdrawnGrantIds`
    answers from that and only for a holder, so the engine and `collectCharacterContent` skip a removed id among the
    holder's own grants whatever their type, and nothing else's. The builder's `holderGrants` lists the same function.
  - **Not "types the kind lists"**: the NPC's `elementTypes` leave out the legendary types on purpose (ADR 0065 decision
    7), so that filter would have kept an NPC's granted Tail Sweep fixed. The holder is the scope.
  - **A PC removes nothing**: `pc` declares no `setterGrants`, so no class, race, feat or item is a holder, and a
    hand-edited `removedGrants` naming a class feature does nothing. `removed-grants.test.ts` holds it by perturbation.
  - **`HolderGrant.group`** is the step's label, else the label of the sheet section that lists the type, else ''
    ("Other"), and `holderGrants` is ordered by it; an NPC's granted legendary action has no step and is listed under
    "Legendary Actions". The pane groups by it and computes nothing else.
  - **Measured at `c28ce6c`**: every one of the corpus's 12 creature grants is also named by the creature's setter, so no
    corpus NPC changes; what this reaches is a user's file. The oracle's table is identical before and after.
  - Driven in the browser build and in the Tauri window on Windows (DOM clicks over the debug port, the file added through
    the native dialog, the saved file read back from disk); not with real input, and not on macOS or Linux.
- **An NPC may keep content beside it for reference, shown and embedded and never held**
  ([ADR 0068](docs/adr/0068-a-character-may-keep-content-beside-it-as-a-reference-shown-and-embedded-and-never-held.md)).
  The 2025 Monster Manual's prose stat blocks, beside an NPC the DM builds by hand. Things to know before touching it:
  - **Measured by `tools/verify/src/stat-block-references.test.ts`** (report-only): 63 descriptions print a stat block
    (45 from that book, 16 PHB 2024 summons, 2 DMG 2024), all `Information`, which also holds 53 that are not stat
    blocks. Nothing but the prose sets one apart, none carries a rule, none embeds another element, and nothing a
    creature grants, names or embeds is one (8 share a name, which nothing reads). **Nothing in the app recognises a stat
    block**: the offer is every element of the kind's types, by name.
  - **`Character.references` is never held.** Not a derivation seed, not an addition (ADR 0064 holds; this must not),
    not a choice. `collectCharacterContent` seeds from it (`referenceIdsOf`), so a save embeds the text. Format **7**,
    only when present (`setReferenced`); the validator refuses it below 7 and an id twice. Not `referencedElementIds`,
    which is the engine's "what an element's rules name".
  - **The kind says which types** (`references: { types, label, description }`, replaced along `extends`, undeclared
    types refused). 5e's NPC keeps `Information` under "For reference" and the legendary creature inherits it; `pc` too
    since ADR 0070 (below).
  - `packages/ui/src/references.ts` is the view-model: a row not loaded, or of a type the kind does not keep, is listed
    with a note and its text is not shown. `References.tsx` renders it on Build (first column) and after the Sheet, and
    computes nothing but sanitizing the description.
  - **A build step may be a `pick` that is not required** (system format): offered as a pick, never blocking, so it can
    be skipped (ADR 0033). The NPC's and legendary creature's Creature steps are, because an NPC built from nothing had a
    blocking Creature decision nothing could close. A step that is neither required, a set nor a `pick` still only heads
    the selects content opens of its types; making every such step a pick would open "Languages: pick one" on a PC.
    Tests that look for the creature step find it by `required || pick`.
  - ~~**Found and not fixed:** all 63 stat blocks are embedded in other descriptions by `<div element="…">`, and Incudo
    shows nothing there.~~ Fixed by ADR 0069, below.
  - Driven in the browser build and in the Tauri window on Windows (DOM clicks over the debug port, the saved file read
    back from disk, reopened with the source off); not with real input, and not on macOS or Linux.
- **What a description embeds is shown in place, and a save carries it for its text**
  ([ADR 0069](docs/adr/0069-what-a-description-embeds-is-shown-in-place-and-a-save-carries-it-for-its-text.md)).
  Things to know before touching it:
  - **Measured by `tools/verify/src/description-embeds.test.ts`** (report-only, plus one assertion that holds against any
    corpus): 3,207 markers, all `<div element="…" />`, 5 of them inside XML comments (content switching an embed off,
    not an embed); 3,202 embeds in 1,273 descriptions, 3,200 resolving, at most two deep, none circular. **No embedder
    writes the embedded element's name** (0 headings before one; its description opens without one), so it is shown.
  - **`descriptionEmbeds` (`packages/core/src/embeds.ts`) is the one reader of the marker**, read where a description is
    used and never when content is parsed (a `.incu` embeds parsed elements). `core` finds the reference and renders
    nothing.
  - **`expandDescription` (`packages/ui/src/description.ts`) puts the text in place**: the name as an `h5` and the
    description, nested, looked up in the index the caller shows from (everything loaded in Browse; the character's view,
    save in front, in a picker, its dock and a kept reference, whose `ReferenceRow.description` is now expanded). One
    naming nothing, closing a circle, or deeper than `MAX_EMBED_DEPTH` (4) is a sentence in its place. The result is
    not safe HTML: the shell's sanitizer runs over all of it, embedded text included. Panes call the two functions and
    compute nothing.
  - **`collectCharacterContent` follows embeds for the text only**: an element reached only that way is embedded and its
    rules are not followed; reached by a rule too, it is followed in full, in either order. An embed naming nothing is
    **not** `unresolved` (the library reads that as "this save uses something you do not have"). On the thirty samples: 23
    more elements, in 16 saves, and the oracle's table identical before and after. A save written before this carries
    what it reached; saving it again with the source loaded carries the text.
  - **A description is XML, and `<h4 />` there is empty.** An HTML parser leaves it open, so every prose stat block
    rendered inside its own opening heading since ADR 0068 (found by running this). `openSelfClosingTags`
    (`packages/ui`) opens and closes every non-void empty element, and `sanitize-html.ts` runs it before parsing.
  - Not done: searching embedded text (Browse reads what an element writes itself), linking an embed to its element.
    Driven in the browser build only.
- **A player character keeps text for reference, what its own elements print is suggested first, and a creature it
  holds is not a reference** ([ADR 0070](docs/adr/0070-a-player-character-keeps-text-for-reference-and-a-creature-it-holds-is-not-a-reference.md)).
  Things to know before touching it:
  - **Measured by `tools/verify/src/pc-references.test.ts`** (report-only, plus what holds against any corpus): a player
    character's own elements (every type its build steps and sheet sections name) print 113 of the 116 `Information`
    elements; 100 of the 116 are stat blocks once plain table cells count (ADR 0068's bold-cell shape found 63); Wild
    Shape prints and selects nothing. 26 selects in its own content offer every one of the 141 creatures (ALE's
    Companion Selection item, equipped, opens 117), 5 of the 30 samples hold one (an Owl), **no `pc` sheet section lists
    a creature type**, 109 creatures carry no description, and 29 read their holder's stats.
  - **`pc` declares `references: { types: ["Information"] }`**, one block in `systems/dnd5e/system.json` and no code:
    everything ADR 0068 says of a reference holds.
  - **`ReferencesState.suggestions`** (`referenceSuggestions`, `packages/ui/src/references.ts`): what the held elements'
    descriptions embed, nested as far as `expandDescription` shows text (`MAX_EMBED_DEPTH`; the limit also ends a
    circle), of the kind's reference types, **through the offered view** (the builder passes `this.elements`, never
    `this.content`), less what is kept, by name, each with every held element that prints it. Derived on every read and
    recorded nowhere; kind-agnostic; the same with no source, since a save carries what its elements embed.
  - **`Companion` is deliberately not a `pc` reference type.** The player character already holds its creature, a
    reference derives nothing (29 creatures scale with their holder), and most have no text. Showing a *held* creature
    is ADR 0073 (below), a scope per creature. Do not add `Companion` to `pc`'s references
    to get a familiar on the Sheet: it would be a second, unheld copy with the wrong numbers.
  - **A library card names what a character keeps**: `LibraryEntry.references` (`{ elementId, name }`, named from the
    save's embedded copy, else the id; absent when none) and `libraryEntryReferences(system, entry)`
    (`character-kinds.ts`): "For reference: A, B, C and 2 more", under the kind's label, the default for a kind
    nothing declares. The card computes nothing.
  - Driven in the browser build and in the Tauri window on Windows (DOM clicks over the debug port, the saved file read
    back from disk, reopened with the source off to an identical Sheet); not with real input, and not on macOS or Linux.
- **An element's own requirements hold it as well as offer it, and a granted element they rule out is withdrawn**
  ([ADR 0071](docs/adr/0071-an-element-s-own-requirements-hold-it-as-well-as-offer-it-and-a-granted-element-they-rule-out-is-withdrawn.md)).
  Things to know before touching it:
  - **Aurora's `[character:N]` and `[type:X]` are answered by the system, not core.** 5e declares `character` (a ref to
    `level`, beside the six ability abbreviations), and a kind may name `heldTypesStat` (5e: `type`): `makeContext`'s
    `statTags` then answers that stat with the lowercased types of every held element, the membership branch equipment
    slots use. A kind that names none reads `[type:x]` as before (false). The validator refuses a held-types stat a slot
    publishes into. Reading them alone moved no sample's elements; it widened eight feat choices, and a level 4 2024
    Fighter is offered 23 of its book's 50 general feats, the Ability Score Improvement feat among them.
  - **Withdrawal is in the expansion's `grant()`**: an id reached only by a `<grant>` or a setter grant, the first time
    it is attempted in a pass, is asked its own requirements against the *previous* pass's context, itself counted as not
    held (`ownRequirementsHold`, the same function the additions flag uses). False: not added, joins no track, recorded
    with every granter. **A seed is never withdrawn** because every seed is `attempted` before any grant is read; do not
    reorder that. A recorded choice under `<withdrawn id>/select:` stops seeding, unless another open
    choice or a fixed seed names the same element; the record stays in `choices` (since ADR 0096 this is one case of a
    pick whose pool is closed: `openSeeds` became `countedSeeds`, below). A change in what is withdrawn keeps the
    fixed point going. Cycles hit the existing `cycle-limit`.
  - **`DerivedCharacter.withdrawn`** (`{ elementId, grantedBy[] }`) is not a `Problem`, and `summarize()` includes it.
    `collectCharacterContent` needed nothing: it ignores gates, so a withdrawn element is still embedded, which is what
    lets a save re-derive the same withdrawal with no source and bring the element back when its condition clears.
  - **Measured, oracle before and after on `.corpus/` at `c28ce6c`: 30 `element-extra` rows go (73 to 43) and nothing
    else moves.** The Artificers' firearms proficiency is withdrawn (Firearms option off) and takes its 10 children; the
    internal Thieves' Tools expertise proficiency is withdrawn on four samples and takes its class feature. So the
    "unconfirmed" and "stale content" readings of that pair elsewhere in this file are superseded: its own requirements
    are false and Aurora withdraws it. Outside the samples, the UA Ancient Companion's three "(X Only)" features are
    withdrawn on a bare NPC (`npc-creatures.test.ts` accepts a named id only when published as withdrawn by it).
  - Tests: `packages/core/src/withdrawn.test.ts` and `held-types.test.ts`, each case failing under its named
    perturbation; `tools/verify/src/own-requirements.test.ts` (2014 Ranger with Deft Explorer equipped and carried,
    answer included; the 2024 Fighter's offer). With 5e's `heldTypesStat` removed the oracle fails on all thirty for
    `Ability Score Maximum Over 20` (`[type:class]`), which is why the terms had to come first.
  - **Not done:** ~~the replacement cannot be driven in the app~~ (it can since ADR 0072, below); a seed whose own
    requirements have since become false is not flagged. Driven in the browser build and the
    Tauri window on Windows (DOM clicks over the debug port, the saved file derived from disk with no source); not with
    real input, and not on macOS or Linux.
- **A build step may offer items a character equips, and what it takes is an equipped bag entry**
  ([ADR 0072](docs/adr/0072-a-build-step-may-offer-items-a-character-equips-and-what-it-takes-is-a-bag-entry.md)).
  Tasha's optional class features, taken in the app. Things to know before touching it:
  - **Measured by `tools/verify/src/optional-features.test.ts`** (report-only): 36 `Item`s of category "Optional Class
    Features", all `misc`, all `inventory-hidden`, **no requirements of their own**: the class and level are on their
    grants (`[level:ranger:1]`), and six carry an unconditional replacement marker. Nothing grants, selects or offers
    them; no sample carries one; a 2024 class answers their gates as a 2014 one does (content's, not narrowed here).
    `inventory-hidden` is on 91 items, and 8 of them are 2024 mounts with no rules, so **hidden is not "a switch"**: the
    category names the family.
  - **`BuildStepDef.equip: { setter, values }`** (system format, `formatVersion` 1): a set like `multiple` (never
    blocking, skippable, published as `OpenDecision.multiple` and `SettledPick.multiple` under `build/<stepId>`), whose
    offer is the step's types admitted by the setter (case ignored), own requirements holding, through the offered view,
    and **whose answers are equipped bag entries, never choices**. What it has taken is read back from the bag, so an
    imported item reads as taken. Validation refuses it beside `required`, `pick`, `multiple`, `perLevel`, `budget`,
    `levelRoll`, and with no types. **Not `multiple` as well**, on purpose: a reader knowing only `multiple` would offer
    every item as choices. It heads no content select (`stepForType` skips it).
  - **`packages/ui/src/equip-step.ts` is the view-model**; the builder's `choose` routes the step's key there
    (`equip`). Taking back comes first and drops the answers it closed (`dropClosedAnswers`, shared with
    `removeAddition`); taking comes second and drops nothing, so a replaced feature's answer waits for it. Taking equips
    a carried entry of the element if there is one; taking back removes an entry that records nothing else and only
    unequips one with a quantity, slot, attunement, adornment, name or notes. The pane renders it as any set.
  - **Since ADR 0081 an equip step may declare `gatedOnHeld`**: it offers an element only when one of its grants is
    gated (a term outside a `not`) on a stat the character publishes above zero or an element it holds
    (`requirementConcerns`, `equip-step.ts`); not whether it holds, so a Fighter 1 sees its level 4 feature. 5e's step
    declares it, so it offers nothing before a class and a class only its own; `optional-feature-offer.test.ts` holds it.
  - **Since ADR 0089 5e declares two more equip steps**, by category and not `gatedOnHeld` (no grant of theirs is gated):
    "Additional features" (35: speeds, senses, feat and multiclass unlockers, weapon mastery, the Companion and Familiar
    Selection, Lycanthropy, bonus feats) and "Ability score adjustments" (12: +1 or −1 to one score). The 2024 mounts are
    hidden, priced and have no rules: no step offers them, they are the inventory editor's goods, so **hidden is never a
    reason to leave an item out**. The multiclass unlocker works only through the classes' `<multiclass>` blocks (`… ||
    marker`, which an element's own requirements do not show): with it, no score is flagged. The player character now derives
    `speed:burrow|climb|fly|swim` as walking speed is (`innate speed:<mode> + innate speed:<mode>:misc + speed:<mode>:misc`,
    `speed:<mode>` itself on top; an innate mode plus an item's of the same mode reads double, unrefereed) and shows them
    under Other Speeds (`showWhen`); sample 28 (a 2024 Thief) climbs 30. `hidden-items.test.ts` measures and holds it.
  - **`InventoryDef.hiddenSetter`** (5e: `inventory-hidden`): `sheetListedElements` (core) leaves such an item off the
    sheet's lists; still held, derived and saved. The Sheet pane reads through it.
  - **`BuilderState.withdrawn`** names what ADR 0071 withdrew and its granters; Build lists it under "Not held" (an
    Artificer's firearms proficiency too).
  - **`setInventoryEntry` raises the format version to 2 and never lowers it.** It used to write 2 over a 5 or 7.
  - The oracle is identical before and after on all thirty samples. Tests: `packages/ui/src/equip-step.test.ts` (each
    case failing under its named perturbation), `tools/verify/src/optional-feature-step.test.ts` (a 2014 Ranger through
    the builder, packed and reopened with no source).
  - **Not done:** a bag editor; a note saying which items give this character anything; ~~the other hidden families~~
    (ADR 0089, above). Driven in the browser build and the
    Tauri window on Windows (DOM clicks over the debug port, the saved file read back from disk with no source); not with
    real input, and not on macOS or Linux.
- **A creature a character holds is derived one at a time in its holder's namespace, and shown as its own stat block**
  ([ADR 0073](docs/adr/0073-a-creature-a-character-holds-is-derived-one-at-a-time-in-its-holder-s-namespace-and-shown-as-its-own-stat-block.md)).
  The roadmap's "Companions" half; sidekicks were split off (the corpus has no sidekick content). Things to know before
  touching it:
  - **Measured by `tools/verify/src/held-creatures.test.ts`** (report-only): content writes a held creature's numbers in
    its holder's derivation, in the one namespace the NPC reads (`companion:`), reading the holder (a Steel Defender's hit
    points, class levels) and added to by the holder's own features (Ranger's Companion, Improved Defender). The six
    scores are setters only. It assumes one creature, as Aurora's app does, and 22 of the 26 creature selects do not keep
    a character to one: a Battle Smith with the Homunculus Servant infusion holds two, and in the holder they **sum**.
  - **`companions` on a kind** (system format, `formatVersion` 1): `types`, `label`, `description`, and what a
    creature's scope adds, `stats`, `setterStats`, `contributions`, `setterGrants`, `sheet` (sections, ADR 0062's
    fields included). Replaced along `extends`. `companionScopeKind` (`system.ts`) builds the scope's kind. The validator
    refuses an undeclared type, a scope setter on a type that is not a creature, a section id twice, a `perBlock` section.
  - **The engine derives each held creature again** (`deriveCharacter` → internal `derive` with an `exclude` set): every
    other held creature is never added, as a seed or a grant, so what only it gives is not reached. Published as
    `DerivedCharacter.companions` (`{ elementId, stats, starts, elements, problems, withdrawn }`, `problems` only what
    the holder's derivation does not have). **The holder's own derivation is unchanged**: it still sums, as Aurora's
    would, and nothing on its sheet reads the namespace. Do not "fix" the holder's `companion:*`; the scope is where one
    creature is meant. A scope costs a full derivation (3 to 9 ms on the corpus), only for a character holding a creature.
  - **What a creature names is held in its scope only** (the scope's `setterGrants`); `pc` still declares no
    `setterGrants`, so the ranger does not get its beast's bite. `collectCharacterContent` follows the scope's setter
    grants as it follows the kind's, so a save embeds them; a save written before this does not, and reopened with no
    source its stat block says "One feature this creature names is not in any loaded source" per missing feature.
  - **5e's `pc` declaration** (`systems/dnd5e/system.json`, no engine noun): `companion:<ability>` from the print with
    modifiers; `companion:<ability>:save`, `companion:<skill>`, `companion:perception:passive` as the NPC's formulas;
    labels for `companion:ac`, `hp:max`, `speed` and the other speeds; **`companion:proficiency` 2 in the bucket
    `proficiency`**. That bucket is measured: of the 12 creatures supplying their own bonus from their holder's, 8 write
    `base` and take away "the app's" 2 in a bucket of their own, 3 Fizban's drakes write `proficiency`, the Eberron
    homunculus writes `base` and takes nothing away. Unbucketed is right for 8, `proficiency` for 11, `base` for 1. The
    homunculus's bonus row reads +2 over (its skills are right). Found by running the app. The NPC (ADR 0062) still takes
    its own bonus unbucketed; not revisited.
  - **Aurora records the companion it shows**: every save has a `<companion>` block (scores, saves, skills; 25 samples
    with no creature record 10s). The four samples holding the 2014 Owl agree with the scope on every score, save and
    skill; the 2025 Owl reads Perception and Stealth +5, its print, where Aurora recorded +1. Reported by
    `companions.test.ts`, not asserted, and not in the oracle.
  - `packages/ui/src/companions.ts` is the view-model (`BuilderState.companions`): per creature, its name, what gave it
    (the element whose choice holds it, or whose grant names it), its sections rendered by `renderSheetSection` against
    its scope, empty ones left out. `Companions.tsx` renders it on the Sheet after the character, before its references.
  - Tests: `packages/core/src/companions.test.ts`, `packages/ui/src/companions.test.ts`, `tools/verify/src/companions.test.ts`
    (every creature by type; two held together; a Battle Smith through the builder; the samples reopened with no
    source), each case failing under its named perturbation. The oracle is identical before and after.
  - **A holder's feature changes only the creature it is about** ([ADR 0109](docs/adr/0109-a-holder-s-feature-changes-the-creature-it-is-about-found-by-what-reached-both.md),
    2026-10-12): about a creature when it, or what gave it, is among what reached the creature (recorded choices and
    grants, back to the start, the creature included); in another creature's scope its rules on the scope's stats are not
    applied (`foreignFeatures`, `scopeStatNames`, `packages/core/src/companion-features.ts`), and one about no held
    creature applies to all. The scope's stats are what the `companions` declaration names and its formulas read, less
    the holder's: never a prefix. The holder still sums. A Battle Smith 15 with a Homunculus Servant: defender 17,
    homunculus 13 (was 15).
  - **Not done:** ~~which creature a holder's feature is for when two are held (Improved Defender's +2 applies to both)~~ (ADR 0109);
    ~~a creature's challenge rating for its bonus~~ (2026-10-12: a held creature that does not take its holder's bonus
    has its print's, `companion:challenge` from its `challenge` setter, as an NPC's; the Triceratops and Tyrannosaurus
    Rex read +3); ~~`companion:attack`~~ (shown as what its holder adds since ADR 0093);
    tracking a creature's hit points. Driven in the
    browser build and the Tauri window on Windows (DOM clicks over the debug port, the saved file read back from disk and
    reopened with the source off); not with real input, and not on macOS or Linux.
- **A kind's sheet shows its printed page, and every row says what it is**
  ([ADR 0074](docs/adr/0074-a-kind-s-sheet-shows-its-printed-page-and-every-row-says-what-it-is.md)). The roadmap's
  "Kind-specific sheets and exports"; exports are Phase 5's, since an export renders the sheet. Things to know before
  touching it:
  - **Measured by `tools/verify/src/kind-sheets.test.ts`**, first report-only on the base commit: the Spell Slots section
    read the multiclass pool (`spellcasting:slots:N`), which **only a multiclass caster publishes**, so all 13
    single-class casters among the samples drew nine zeros; every casting block's two rows were labelled by their keys
    ("wizard:spellcasting:dc"); a player character held 153 skill and 60 save proficiencies and no row showed a save, a
    skill, passive Perception or a modifier; race, class and background were listed nowhere; no creature's size, type,
    alignment or printed armour class and hit points were shown; Cairn's ability step had no budget (ADR 0017's inert
    shape), so every Cairn character read 10, 10, 10 and 1. **No test saw the slots**: the oracle compares stats, never
    the sheet.
  - **`packages/ui/src/sheet.ts` is the view-model** (`sheetView`, `sheetSections`, `formatStatValue`;
    `BuilderState.sheet`): a row's label, its value as written, what is beside it, the listed elements and their unmet
    marker (ADR 0064), empty sections left out. `companionsView` (ADR 0073) builds each creature's sections with the same
    `sheetSections`. `SheetPane.tsx` and `Companions.tsx` (its `SheetRows`) compute nothing. **A section lists its
    elements in the order it names their types**, then in the order held, and draws them before its printed lines.
  - **Three optional system-format fields** (`formatVersion` stays 1): `signed` on a stat or a `blockStats` entry
    ("+2", "+0", "-1"; display only), `label` on a `blockStats` entry (a per-block row's name, found through the new
    `SheetSectionRendering.entries`, the section entry each row came from), and `beside` on a sheet section (a stat
    template, `{stat}` for the row, block placeholders resolved in a `perBlock` section; `renderSheetSection` publishes
    it aligned with the rows `showWhen` keeps). The validator refuses a `beside` naming nothing the kind or scope
    declares. **An unlabelled row still falls back to its key** (a user's system may have one); every shipped kind is
    held to none by the test, not by the validator.
  - **5e's `pc`** (`systems/dnd5e/system.json`, no engine change): `<ability>:save`, the eighteen skills and
    `perception:passive` with the NPC's formulas (modifier + `…:proficiency` + `…:misc`), all rows shown, signed;
    scores with modifiers beside; a Character section (race, subrace, class, subclass, background, alignment, deity);
    Senses (passive Perception and `Vision`). **Spell slots**: the pool with `showWhen`, and a `perBlock` section over
    `{name}:spellcasting:table:<n>` = the block's own `{name}:spellcasting:slots:<n>` × `{name}:spellcasting:table`
    (`max(solo, 1 − min(1, multiclass:spellcasting:level))`: 1 for a single-class caster, and for pact magic beside a
    pool). **Do not name it under `spellcasting:slots:*`**: `blockFilters`' `tagsFromStats` globs that for spell
    selects, and the oracle's row count shifts that pattern. The pool's labels are the system's "1st-level Spell Slots".
  - **5e's `npc` and `legendary`** (the legendary kind repeats the NPC's sections; change both): a Creature section listing
    `Creature`/`Companion` and printing `size`, `type`, `alignment`; the header prints `ac` and `hp` as written
    ("95 (10d12 + 30)") and shows `initiative`; scores with modifiers beside; saves, skills and bonus signed. A held
    creature's sections (`pc.companions.sheet`) got modifiers, signs and the printed first line.
  - **Cairn**: Abilities is a budget over Strength, Dexterity and Willpower (method `scores`, 3 to 18) and a Hit
    Protection step (`protection`, 1 to 6); its sheet lists the Background. Rolling in order (Cairn's rule) is not
    offered: the roll method assigns. **The score editor's footnote is every kind's**, so it names no game's rules (it
    said "in 5e an ability score stops at 20" on Cairn, found by running it).
  - **Saves and skills are worked, not refereed**: Aurora's save records the companion's skills and never the character's.
    The test works every sample's from Aurora's own `<sum>` and the book (682 rows agree, 0 differ; the 38 something else
    adds to are held to their three terms). Content spells one expertise id `…_SLEIGHT_OF_HAND` with underscores and the
    rest without, so the check ignores underscores. Never describe these as verified against Aurora.
  - ~~**Content's `<sheet>` hints are parsed and read by nothing, on purpose**~~ Read since ADR 0076 (below): a section
    declares `omitHidden` to honour `display="false"`, and 5e's header and Senses do not, so Darkvision stays.
  - The oracle is identical before and after. **Not done:** a proficiency mark on a save or skill; levels per class;
    hit dice, death saves, inspiration, personality, ~~attacks~~ (ADR 0093); ~~the `<sheet>` hints~~ (ADR 0076); the Build pane's "Progress" number on a
    level-less kind. Driven in the browser build (a Cairn character too) and the Tauri window on Windows (a packed sample
    and a built NPC, the file read back from disk, reopened with the source off); not with real input, Cairn not in the
    window, and not on macOS or Linux.
- **The sheet is one document, and a text export is it written as Markdown that reads as plain text**
  ([ADR 0075](docs/adr/0075-a-text-export-is-the-sheet-document-written-as-markdown-that-reads-as-plain-text.md)).
  Phase 5's first item. Things to know before touching it:
  - **Measured by `tools/verify/src/sheet-export.test.ts`** (first report-only on the base commit): the Sheet's view is
    identical packed and reopened with no source for all thirty samples, all 282 creature characters and Cairn; none of
    its text is markup (21 creature lines carry square brackets); the importer's `freeform` prose and the portrait path
    never reach it (since ADR 0092, prose under a key no field declares); a listed element's description would add 18,635 to 93,290 characters to a sample. The only HTML is
    a kept element's text: 116 elements a kind may keep, fifteen tags (all on the shell sanitizer's allowlist), 110
    tables (63 the 2024 grid, `<td colspan="2"/>` and no header row; 47 with a `thead`; every row as wide once spans
    count; only `b`, `i`, `strong` in a cell), 100 empty `<h4 />`s, no embed of another element.
  - **`sheetDocument(state)`** (`packages/ui/src/sheet-document.ts`) is what the Sheet shows: name, kind, the sheet's
    sections, held creatures (with a `from` line) and kept references (`referenceEntry`: the HTML, or a `note`,
    `NO_KEPT_TEXT` when there is no text). **The Sheet pane, `Companions.tsx` and `References.tsx` render it and compose
    no sentence**; `PREREQUISITES_UNMET` is the words beside an unmet addition. A print layout or a PDF is another
    renderer of the document, never of `BuilderState` directly: that is the drift it removed. The lede's element count
    is in it and the export leaves it out (it counts internal elements).
  - **`sheetMarkdown(document)`** (`sheet-markdown.ts`): `#` title ("Unnamed character" when blank), the kind, `##` per
    section with one list (rows `Label: value (beside)`, elements, printed `Label: text`, in the pane's order), `###` per
    creature and kept element, content's headings from `####`. UTF-8, `\n`, a final newline. **Plain text and Markdown
    are one format.** Names only, as the Sheet shows.
  - **`htmlToMarkdown`** (`html-markdown.ts`) is a small tolerant tag reader, no DOM, run after `openSelfClosingTags`:
    blocks, lists (nested ones indented), pipe tables whose first row is the header and where a spanning cell is followed
    by empty ones, `**`/`*` with spaces moved outside the markers, http(s) links only, `script`/`style` and the rest of the
    sanitizer's removed list dropped with their contents. **It writes no HTML**: `escapeMarkdown` escapes `\` `` ` `` `*`
    `_` `<` always, `&` only before an entity, `]` only before `(`, `[` or `:`; `escapeLineStart` a line that would read as
    a heading, quote, list, rule or table. Nothing else is escaped, so "Hit Dice [d8s]" reads as written.
  - **`exportSheet(saver, document)`** (`sheet-export.ts`) goes through ADR 0038's `FileSaver` and returns a name only;
    `suggestedFileName(name, 'md')`. The `export-sheet` command is **enabled on the Sheet only** (its bar prints
    "Exported the sheet as …"), needs no library and no content, sits below Save a copy in the File menu, and is on
    **Ctrl+Shift+O** since 2026-10-12, one of the chords ADR 0038 saw reach the page with real keys in the Windows window;
    `commands.test.ts` now refuses a Ctrl+Shift chord not on that list.
  - Tests: the corpus test (offline identity, every section and row written, no HTML, no empty heading, the words and
    table columns of all 232 kept texts), `packages/ui`'s `html-markdown.test.ts`, `sheet-document.test.ts` and
    `commands.test.ts`, each case failing under its named perturbation. **Escaping is held by the `packages/ui` tests
    only**: the corpus gives it almost nothing to do. A count of pipes per table row did not see a spanning cell written
    as one (rows are padded to the table's width); the test compares columns. The oracle is identical before and after.
  - **Not done:** a copy to the clipboard; ~~a shortcut~~ (Ctrl+Shift+O); feature descriptions, personality, notes, the bag, prepared spells.
    Driven in the browser build (exports compared byte for byte with the tests' and with the source off) and the Tauri
    window on Windows (no source ever added; the native menu item and the real save dialog, by window messages); not with
    real input, not the dialog's replace prompt or Cancel, and not on macOS or Linux.
- **Content's sheet hints are read: every description kept, and the one shown chosen by the level its element gates at**
  ([ADR 0076](docs/adr/0076-content-s-sheet-hints-are-read-every-description-kept-chosen-by-the-level-the-element-gates-at.md)).
  Groundwork for Phase 5's PDF and print layout. Things to know before touching it:
  - **Measured by `tools/verify/src/sheet-hints.test.ts`**, which also asserts what holds against any corpus: 5,984
    elements carry a `<sheet>`; 220 write two to five `<description>`s gated by `level=` (332 gates), 11 of them a usage
    and 1 an action of their own; `usage` is a count per rest or a resource's name, `action` Action, Bonus Action,
    Reaction or Attack but for 8; `alt` (1,014) and `name` (9) are a shorter name; `{{stat}}` placeholders, some with
    `:half:up`. Sheet text is feature text: 302 of 341 shown features carry one, no proficiency, spell, language or
    background does. Aurora's save records nothing of its sheet, so **nothing here has a referee**.
  - **The importer kept only the first description** (the sixth silently dropped construct, a bugfix to the frozen
    package). `SheetHints.descriptions` (`{ text, level?, usage?, action? }[]`, file order) keeps them all; `description`
    stays the first text, and **a reader finding no `descriptions` treats `description` as the one ungated one**, so a
    save written before shows its first text at every level until saved again with the source loaded. The content cache
    stores raw XML, so a cached source picks it up on its next load.
  - **The level is `DerivedCharacter.gateLevels`** (held element → what `trackLevelReader` gives it after the fixed
    point: its class track's level, else the character's progression), published by the engine and never recomputed.
    `CompanionDerivation.gateLevels` too. It is in `summarize()`: a property of the character and what it embeds, so the
    self-containment, rebuild and reopen tests compare it, and every builder rebuild of a sample agrees with its import.
    One sample separates class level from character level (sample 17's Font of Magic): "consistent with", never
    "verified".
  - **Core reads, ui writes.** `packages/core/src/sheet-hints.ts`: `sheetDescriptions`, `sheetDescriptionAt` (highest
    gate at or below; ungated from 0; the later of two at one level), `sheetPlaceholders` (the one reader of `{{…}}`).
    `expression.ts` exports `halfReference`, the `:half` reading `statNumber` uses, so nothing copies it.
    `packages/ui/src/sheet.ts` `fillPlaceholders`: a published stat by `formatStatValue` unsigned, a half through core's
    `evaluateExpr`, a value escaped inside the HTML-ish text, an unpublished stat written "—" and named in
    `SheetListedElement.unfilled` and counted in `SheetView.unfilled` (0 on the samples).
  - **`SheetListedElement` gains `sheetName`, `text`, `usage`, `action`, `unfilled`, each only when content wrote
    one**, so an element with no hints is listed exactly as before. `text` keeps **one line per line content wrote**
    (824 of 4,753 descriptions are bullet lines that HTML would run together), trimmed, blank lines dropped. A
    description's own usage and action replace the sheet's.
  - **`omitHidden` on a sheet section** (system format, optional, `formatVersion` 1; the validator refuses it beside no
    types). 5e declares it on the player character's Features & Traits and Proficiencies and the NPC's and legendary
    creature's Feats and Features and Proficiencies and Conditions; **never on a Character header, Senses, or a stat
    block's Traits, Actions and Reactions** (a held creature's included): `display="false"` is on every race and class,
    and on "Primal Bond", which the 2024 book prints in the beast's stat block. **A hidden element a section lists anyway
    is named with no line** (found in the Tauri window: a 2014 class's header read its sheet text). 188 hidden elements
    leave Features & Traits on the samples and 10 Proficiencies; 46 header entries are named without their line.
  - **`listedName` and `listedUsage`** (`sheet-document.ts`) are the one wording of "**Rage** (Bonus Action; 3/Long Rest)":
    the pane (`Companions.tsx` `ListedElement`, the text through the shell sanitizer with `white-space: pre-line`) and
    the export both call them. The export bolds a name only when content writes it a line and writes each line of the
    text as a line of the item ending in two spaces.
  - **ADR 0075's personal-text check exempts content's own words**: Aurora copies a background feature's description into
    every save's freeform, and the sheet now shows content's copy (four samples read as leaking). A freeform value of 20
    characters or more that a held element writes itself is not counted.
  - Tests: `packages/core/src/sheet-hints.test.ts`, `engine.test.ts`, `packages/ui/src/sheet-hints.test.ts`,
    `parse-elements.test.ts`, `schemas.test.ts` and the corpus assertions in `sheet-hints.test.ts`, each case failing
    under its named perturbation. The oracle is identical before and after.
  - **A held creature's unfilled placeholders are counted on its own view** (`CompanionView.unfilled`, the same
    `unfilledIn` helper); `SheetView.unfilled` counts only the character's own sections. Found by driving one.
  - **No creature feature in the corpus names a stat**, so filling inside a creature's scope is only reachable from a
    user's own file; the drive used a scratch one (not committed), and `companions.test.ts` holds it (two creatures' lines
    each read their own scope, not the holder's sum).
  - **Not done:** spells, proficiencies and backgrounds described on the sheet (content writes no sheet text for them); a
    ~~reason beside a number a hidden feature moved (Tough)~~ (ADR 0095, below); counting uses (Phase 6); a hidden trait a stat block prints is
    named without its line (the three Tasha's "Primal Bond"s, held by no sample). Driven in the browser build (samples 17,
    11 and 08, an NPC and a held creature from a user's own file, reopened with the sources off, exports byte for byte
    the tests') and the Tauri window on Windows (samples 02, 17, 08 and 11 and the NPC packed outside it, no source ever
    added, exported from the native menu through the real save dialog, byte for byte the tests'); not with real input,
    not importing in the window, and not on macOS or Linux.
- **A row names what moved it that the sheet lists nowhere: "Hit Points: 61 (including Tough)"**
  ([ADR 0095](docs/adr/0095-a-row-names-what-moved-it-that-the-sheet-lists-nowhere.md)). Things to know before touching it:
  - **Measured by `tools/verify/src/hidden-reasons.test.ts`**: 198 elements a section declaring `omitHidden` leaves out on
    the samples; of 1,399 rows, 5 moved directly (all Hit Points: Tough, Dwarven Toughness) and 24 only through a formula
    the kind declares (Speed by Fleet of Foot; skills by Skill Expertise, the 2024 Jack of All Trades, Thaumaturge, Magician).
  - **`SheetRow.including`** (`nameWhatMovedRows`, `packages/ui/src/sheet.ts`): the sheet names of elements held, hidden, of
    a type an `omitHidden` section lists and listed by no section, that contribute non-zero to the row's stat or to a stat
    its `derive` reads, followed through the kind's formulas **by name** (core's `statReferences`), never evaluated. No
    amounts. The stat a shown mark reads is not followed ("expertise" already says it). A sheet with no `omitHidden`
    section (a stat block, a held creature) names nothing. No system or character format change.
  - **`rowAside` words it** ("+6 (proficient; including Thaumaturge)"), so the pane, print, Markdown, phone and refresh
    review show it; the official form reads `value` and `beside` and is unchanged. 19 rows on 9 samples; oracle identical.
  - Not named: what is listed nowhere but is not hidden (base scores, the kind's rules, blocks, ability score
    improvements), `inventory-hidden` items. Driven in the browser build only (samples 17 and 10, no source, the export).
- **A printed sheet is the Sheet pane under print rules, its sections flowing in two columns**
  ([ADR 0077](docs/adr/0077-a-printed-sheet-is-the-sheet-pane-under-a-print-stylesheet-and-its-sections-flow-in-columns.md)).
  Phase 5's print layout. Things to know before touching it:
  - **Measured by `tools/verify/src/print-layout.test.ts`** (report-only lines, plus assertions): a sample's sheet is 109
    to 233 lines before wrapping, an NPC's 27 to 61; kept texts run to 6,014 characters with tables twelve columns wide.
    **A section's shape is not stable**: Worn & Wielded and Senses change between "short figures" and not on 7 and 5 of
    the 30 samples, which is why nothing classifies sections.
  - **No second renderer.** The `@media print` block at the end of `apps/desktop/src/styles.css` lays out what the Sheet
    pane already draws from `sheetDocument`; content's HTML is made safe only by the shell's DOM sanitizer, so a print
    renderer in `packages/ui` could not show it. The block is last in the file on purpose: its light colour tokens win
    over the dark scheme's by source order.
  - **What it undoes**: `.app` one window tall with overflow hidden and `.pane` scrolling (a print would be cut at the
    fold); the header, the Sheet's bar, the name `<input>` and the lede's element count (`.sheet-element-count`) are
    hidden; the dark scheme's text colours. The name prints from `.sheet-print-title`, which is `SheetDocument.title`
    (the name trimmed, else `UNNAMED_CHARACTER`, now in `sheet-document.ts`; the Markdown's heading reads it too).
  - **Sections flow in `.sheet-flow`** (sections, then held creatures; `columns: 2`); kept texts sit outside it and start
    a page (`break-before: page`), their tables shown whole. **A whole section is not kept unbroken**: that left pages
    half empty (a long list moves on rather than breaking). Kept whole: `dl`, a listed element, a creature's section, a
    `.hint`, and a section that lists no elements, chosen by `:has()` on what it holds, never by name. Not a whole
    creature: kept whole, the Owl left the Companions heading alone at a page's foot.
  - **"Print sheet…"** (`print-sheet`, Sheet only, File menu below the text export and on the Sheet's bar) calls
    `window.print()`; Tauri documents it for every platform and wry's `print()` on Windows is that call. While printing
    the page is titled with the character (`beforeprint`/`afterprint`, which `Page.printToPDF` fires too), so the dialog's
    header, the spooler's job and "Save as PDF" name the character. **Ctrl+P**, claimed on every pane: real keys in the
    Windows window reach the page as a key-down before WebView2 acts, so Build opens nothing and the Sheet one preview.
  - **Driving it**: `window.print()` holds the page until WebView2's preview closes; the preview is a DevTools target of
    its own (`edge://print/`), so a drive cancels it there. A drive that looks for "the page" must pick the app's URL,
    not the first page target.
  - The oracle is identical before and after. Driven in the Tauri window on Windows (34 packed characters, no source ever
    added, printed to A4 PDF: every word of the text export in order, nothing clipped; the native menu item and the
    button and real Ctrl+P opening the preview, printed from it to a real printer and saved as PDF with the layout intact)
    and in headless Edge on the dev server (the same pages and words); not in a headed browser's dialog, and not on macOS
    or Linux. ~~The dialog's default header and footer print the page's address; that is the dialog's option.~~ Not since
    ADR 0078, below.
- **"Print sheet…" first opens a print options step, and no edge of a printed page is left to the dialog**
  ([ADR 0078](docs/adr/0078-a-print-is-chosen-in-a-step-of-the-app-s-own-and-no-edge-of-the-page-is-left-to-the-dialog.md),
  amending ADR 0077). Things to know before touching it:
  - **Measured first** (`tools/verify/src/print-options.test.ts`, report-only lines, plus one assertion since): 25 of the
    30 samples, every creature character and Cairn have only their own sections; a held creature costs no page, a kept text
    costs pages. In WebView2 (Chromium 154) **the dialog prints its date, title, address and number in any edge with a
    margin and no margin box drawing in it, and offers its headers-and-footers option only while some edge does**: with
    none, the option is not in the dialog at all, so nothing can put them back. A page number needs a margin (only a
    margin box prints one).
  - **`packages/ui/src/print-options.ts` is the view-model**, reading the sheet document only: parts offered only when
    the document has more than one, never all unticked, labelled with the document's own labels ("The character's own
    sections" is the view-model's); `printRendering` gives the Sheet's root `print-omit-<part>`, `print-page-numbers`,
    `print-running-name` and **one `@page` rule carrying the name** (`cssString` escapes it), since a margin box cannot
    read the page. Remembered per user in `Storage` under `print/options`, written by `finishPrintStep` on Print only,
    read afresh when the step opens, falling back field by field; a remembered omission of a part a sheet lacks is kept.
    Never in `character.json`.
  - **`print-sheet` opens the step** (`PrintOptions.tsx`, modal: every command off, Ctrl+P claimed and run by nothing);
    its Print calls `window.print()` **from an effect after the render that closed it**, so the step is not printed and
    the classes are on the Sheet. `App.tsx` has exactly one `window.print()` call; `print-layout.test.ts` holds that.
  - **The print rules**: `@page { margin: 0; padding: 10mm }`; three named pages (`sheet-numbered`, `sheet-named`,
    `sheet-named-numbered`) chosen by `page:` on `.sheet` with the classes, each giving an edge a 10 mm margin only with
    its box (8 pt, the page's font, muted), the first page of a named one no head margin. **`content: none !important`
    on that first page's box is load-bearing**: Chromium let the name's rule, later in the document, beat `:first`
    whatever the page selectors, and the name printed on page 1. `print-layout.test.ts` resolves pages in document order
    with `!important` above it, as measured, not by the spec's specificity, which passed the broken rules.
  - Driven in the Tauri window on Windows: 109 prints of 36 packed characters, no source added, through the step and
    WebView2's preview (no headers option in any; a scratch margin made it appear) and to PDF with the dialog's headers on:
    no date, title or address, numbers and the name only where chosen, every word of the export of the parts printed (a
    kept table's `<thead>` repeats on the next page, which is Chromium's). Running items move no page count.
  - **Driven again with real keys, a real mouse and paper** (the same day): Ctrl+P opens nothing on Build, the step on the
    Sheet, nothing a second time; real Escape and Cancel print and record nothing; boxes toggle, the last part is greyed,
    Tab cycles inside the step, and **Enter on any box prints** (Print… is the form's submit). No headers option in the
    preview for all four running-item combinations; on A4 paper (both items, and neither) and saved as PDF through the
    real save dialog, nothing of the dialog, the app's items exactly where chosen, every word of the export. Remembered
    across characters and a window restart.
  - **The preview's Margins list undoes decision 4**: Minimum or Custom brings the headers option back (ticked), Custom
    with room at the head prints the dialog's date and title on page 1 and the app's page numbers are lost, and the preview
    remembers the choice for the next print. It opens on Default, which is what the rules hold for; no print rule was found
    that holds against it (a no-break space in page 1's head box did not), so nothing changed. Not in the browser build,
    not on macOS or Linux.

- **A PDF sheet is built** ([ADR 0079](docs/adr/0079-a-pdf-sheet-is-the-print-layout-written-to-a-file-and-the-official-form-is-the-user-s-own-copy-filled-from-the-document.md),
  accepted). Things to know before touching it:
  - **Incudo's own PDF is the print layout**, written without the print dialog through WebView2's `PrintToPdfStream` on
    Windows first, behind a port; elsewhere "Print sheet…" and "Save as PDF" stay the PDF. No PDF renderer of its own.
  - **The official 2014 form is never shipped, committed or downloaded by Incudo**, not even in a test: its notice permits
    personal photocopying only, and both D&D Beyond's and Wizards' terms forbid unauthorised software reaching the service.
    The user downloads it from a link and points Incudo at their copy. `tools/verify/src/pdf-sheet.test.ts` describes its
    boxes in its own words; the 2024 sheet has no form fields.
  - **It is filled from the sheet document only** (ADR 0075's rule), which grows first: proficiency marks, levels per class,
    spell levels and prepared marks, hit dice. The field map is the 5e system's data; the filler in `packages/ui` names no
    game; the PDF library is in `apps/desktop`.
  - **Proficiency marks are built** (decision 6): a sheet section may declare `mark: { stat, per, labels }`, a row
    template counted in multiples of `per`; `SheetRow.mark` is `{ label, count }` (`rowMark`), and `rowAside` is the one
    wording of what follows a value ("+7 (expertise)"), read by the pane and the Markdown. 5e's `pc` declares it on Saving
    Throws and Skills; content puts expertise in the `double` bucket and Jack of All Trades in `…:misc`, which is why a
    mark reads `…:proficiency` and never the row's value. The mark's row stat need not be declared (content supplies it).
  - **Levels per class are built** (decision 7): a sheet section may declare `trackProgress`, and a listed element a track
    is rooted on carries `SheetListedElement.progress`, read by core's `trackProgress` from the stat the progression's
    `trackStatPattern` names and only when that element contributed it (a single-class character's implicit track, ADR
    0044, included; never recomputed from `advancement`). `listedName` writes "Paladin 3". 5e's `pc` Character section
    declares it; `class-levels.test.ts` holds every sample's split.
  - **A spell's level and prepared mark are built** (decision 8): a sheet section may declare `group` (a setter it lists
    by, named like a candidate note; core's `sheetGroup`, `compareSheetGroups`) and `preparedMark` (what always and chosen
    are called; core's `preparedState` reads `DerivedCharacter.preparation` across every block, always first). Such a
    section **also lists what a prepared list holds and the character does not**: a list preparer's spells are embedded
    and never seeded (ADR 0046), and 50 of the samples' 94 chosen spells were on no sheet; `sheetView` takes a lookup, the
    builder's index. `listedAside` writes "Level 1, prepared". 5e's `pc` Spells section declares both;
    `spell-levels.test.ts` holds every sample's list and marks to the derivation.
  - **Hit dice per class are built** (decision 9): a sheet section may declare `trackDie` (a setter, beside `trackProgress`),
    and a listed track root carries `SheetListedElement.dice` (`{ count, sides }`): the track's count, as decision 7 reads
    it, of the die core's `trackDie` reads off the setter (`dN` only, through `dieSides`). `listedAside` writes it first:
    "Paladin 3 (3d10)". The form's total ("3d10 + 3d6") is the filler's to add up, not the Sheet's. 5e's `pc` Character
    section declares `"trackDie": "hd"`; `hit-dice.test.ts` holds every sample's classes to the derivation and `hd`.
  - **"Export sheet as PDF…" is built** (decision 10), the Windows window only. A `PdfWriter` port (`core/platform.ts`):
    paper in, bytes out, nothing written; `exportSheetPdf` then saves through `FileSaver`. The Tauri writer is the Rust
    command `print_to_pdf` (WebView2 `PrintToPdfStream`, margins 0, no headers, via `with_webview`). The paper is
    `PrintOptions.paper`, offered only when the step's target is `'pdf'`; `printRendering(…, 'pdf')` adds `@page { size }`
    and the shell puts the target back to `'print'` afterwards. **Where there is no writer there is no command**:
    `menuModel(os, absentCommands(…))` leaves it out, the Sheet's bar has no button. Driven in the window by window
    messages and the debug port only; the save dialog is `#32770` "Export this character's sheet as PDF".
  - **"Fill the official sheet…" is built** (decision 11). **The form is never committed, shipped or downloaded**; the user
    picks their own copy, kept under `forms/<map id>` in `Storage`, recognised by exactly its fields (`recogniseForm`; bytes
    differ between copies, and one measured copy did). The map is a file beside the system,
    `systems/dnd5e/forms/official-2014.json`, with its own schema (`schemas/form-map.schema.json`), **not** the system format;
    `checkFormMap` is the one checker. `formValues` (`packages/ui/src/form-fill.ts`) reads only the document (which grew
    `SheetListedElement.type` and `SheetSectionView.section`/`block`) and names what it leaves off; `listedHead` is the one
    plain wording of a listed element's head. pdf-lib is in `apps/desktop/src/official-form.ts` only, exported as
    `@incudo/desktop/official-form` so the tests fill with the same code. Flowed boxes are written at a fixed 7 pt (the
    form's auto size writes 22 pt or shrinks to 8), and the 2014 form's fields mostly inherit the form's default
    appearance, which `setFontSize` refuses. `official-sheet.test.ts` fills a stand-in form built from the map's field list
    in CI, and your own copy when `INCUDO_OFFICIAL_SHEET` in `.env.local` names it.

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

- **The level is buttons at the head of Build's middle column, not a typed number** (2026-10-06, the maintainer's
  call): "Level up to N" with the class it goes to beside it, and "Remove level N (Wizard 2)". It was a number field
  in the header and a Classes panel in the settled column, where taking a second class read as not built. The
  wording is `levelControlView`, `LEVEL_HINT` and `LEVEL_UP_OTHER` (`build-view.ts`); the phone shows the same panel
  ahead of "Your character". A rating or xp total is still typed. A jump of many levels is the split's.

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
- **Gated on what content declares, and on the one option the system names:** the class's own `requirements` plus its
  `<multiclass>` block's, through the engine's own requirement context, and since
  [ADR 0088](docs/adr/0088-a-per-level-step-may-name-the-option-that-allows-another-class.md) the step's `multiclassWhen`
  (5e: `ID_INTERNAL_OPTION_ALLOW_MULTICLASSING`, which no content file reads): while the character does not hold it, a
  class it has no level in is `unavailable: 'multiclassing-off'`, `ClassLevelState.allowedBy` names the option, and a
  character already holding two classes keeps them, flagged by `multiclassOffNote` (`build-view.ts`) and never changed.
  A character recording no options reads as off (ADR 0080), so a real-corpus test building a multiclass character from
  `createCharacter` ticks `build/options` first. Measured: all 8 multiclass samples record the option and the 21
  single-class samples without it are offered no second class (`multiclass-option.test.ts`). `applySplit` still takes
  a split of the classes already held while it is off. Not gated, deliberately: the *current* class's prerequisite (content never states it, so the
  builder is more permissive than the Player's Handbook), and *when* a score was met (the engine
  has no time axis). 28 of 29 classes have a block; the UA Mystic does not and is listed as
  unavailable rather than hidden.
- **Six declared stats were the real blocker.** Content reads `str dex con int wis cha` 72 times
  in requirements (36 multiclass gates, 24 feat prerequisites, 6 rules) and nothing published
  those names, so every one read false for every character — all 28 gates for a Charisma 20
  character, and 24 feats never offered. `systems/dnd5e/system.json` now declares them as refs,
  no format change. `aurora verify` is byte-identical before and after and *cannot* see this.
  *(Note, 2026-09-23, re-run as a before/after over the thirty samples: still no difference against Aurora and
  no derived element moves, but one existing stat does, the plate-wearing Fighter's `speed`, 20 to 30, which is
  right and was wrong since the bag step seeded plate. ADR 0036's note.)*
- **Moving a level between classes with different dice clears that level's hit point roll**, and
  it reopens as a decision. A level that comes into being keeps any roll already recorded for it:
  the oracle's own rolls include a 10 on a d8, so a value above the die is something real saves
  hold, and deleting one on a plausibility guess is destroying data. `addLevel` is one write for
  the same reason — grow-then-reassign passes through a die change that never happened.
- **~~Nothing prunes the picks of a class whose levels went away~~**, nor of a level lowered away. Since ADR 0096
  they stay in `choices` and stop counting (below, "A pick counts while its slot exists"); nothing prunes them but
  the user's Forget.
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
  *(Note, 2026-09-23: on the thirty samples the oracle **can** see it. All 8 multiclass samples change with this
  commit, `element-extra` falls 101 to 73 and the caster level moves onto Aurora's in the three subclass-caster
  samples; the 22 single-class ones are identical. ADR 0040's note. "All nine derive identically" is the
  original nine's.)*
- **The Rogue/Wizard has an Aurora referee, and it is a sample.** `rogue-wizard-aurora.test.ts` builds the
  description in `rogue-wizard-interleaved-build.ts` through the builder, one level at a time (Rogue, Wizard,
  Rogue, Wizard, ...), and compares it with sample 06, the same description saved from Aurora: 0
  stat-mismatch, 0 spell-missing, both slot rows, both DCs, both attack bonuses and the caster level
  compared and agreeing, and every level in the class the save put it in. It is the one test that shows the
  builder *offers* the right choices, since `builder-rebuild.test.ts` replays the picks a save holds. Two
  things it found: the Ritual Caster feat's two spells could not be offered because the `Ritual` support filter
  was unread (the test named them as the one expected missing pair; **ADR 0047 read the filter and the pair is
  gone: the build offers and accepts both, and the test asserts no element Aurora derived is missing beyond an
  option or a marker**), and Aurora records a Thieves' Tools expertise without the two internal elements it grants, in a build made
  after its content was updated, so the older "stale content" explanation for that pair is wrong (ADR 0071 found the
right one: its own requirements are false, and Incudo now withdraws it as well). What it
  cannot referee is `hp` (see ROADMAP Phase 2). **Prepared spells are refereed too now** (ADR 0046): its
  Wizard's limit is the count Aurora's screen showed, and preparing the spells the save prepared is offered and
  accepted, giving the list the save records. That closed the last clause of Phase 2's exit criterion.
  `builder-rebuild.test.ts` rebuilds *every* save through the builder, single-class and multiclass, from
  its own picks, and each matches its import and Aurora.

**A class split is one input, and only the ability score minimum is soft** ([ADR 0045](docs/adr/0045-a-class-split-is-one-input-and-an-unmet-ability-score-minimum-is-a-flag.md),
amending ADR 0036 decision 4). `CharacterBuilder.applySplit` takes `[{ classId, levels }, …]` in the order the
levels were taken, writes the same `advancement` and multiclass records as level-by-level, and is judged class by
class against the rest of the split already held. A class short only of ability scores is `eligible` and carries
`ClassOption.flag` (derived on every read, never stored, clears when the score rises); every other unmet term still
refuses. Things to know: `eligible` means "may be taken", not "requirements hold"; a minimum under a `not` is read
for real; a class already held is flagged from its multiclass block only, since its own requirements read "not
multiclass"; and the flag survives a save and reopen with zero sources.

**Preparing spells is one recorded list per casting block, and everything else about it derives**
([ADR 0046](docs/adr/0046-preparing-spells-is-a-recorded-list-per-casting-block-and-the-rest-is-derived.md)).
Measured before it was built, and **content already stated nearly all of it**: every preparing class publishes
`<class>:spellcasting:prepare`, an always-prepared spell is a `<grant … prepared="true">`, and Incudo already
agreed with Aurora's screen for 10 of 15 blocks. The other five were `:half`. Things to know before touching it:

- **`:half` and `:half:up` are read where a reference is evaluated** (`expression.ts`), and not where it is parsed,
  because a `.incu` embeds *parsed* elements: a parse-time reading leaves every character saved before it at zero.
  61 uses in the corpus, 57 of them other stats (Jack of All Trades, initiative) that used to read 0.
- **The one input is `Character.prepared`**, keyed by the lowercased block name (`"wizard"`), added in the order
  chosen, absent when empty, no `formatVersion` bump. It may hold a spell content also makes always prepared (the
  importer copies every flag); the derivation ignores it there and the builder never writes one. It is **embedded**
  (`collectCharacterContent` seeds from it, since a whole-list preparer's prepared spells are named by nothing else)
  and is **not a derivation seed**: Aurora's `<sum>` does not hold them, and seeding would invent `element-extra`.
- **`preparation` on a character kind** (`systems/dnd5e/system.json`) says which blocks prepare (`blockAttribute`),
  where the limit is, and two `supports` filters. `deriveCharacter` publishes `preparation: PreparedBlock[]`
  (`packages/core/src/preparation.ts`): `limit`, `mode`, `always`, `held`, `chosen`, `unavailable`, `over`. Past
  the limit is the **error** `over-prepared` and never a refusal; something the block cannot prepare is the warning
  `not-preparable`. `preparationPool` builds what could still be offered and is not part of the derivation: a level 20
  Cleric's list is over two hundred spells.
- **A book or a list is an assumption, and Aurora's own listing is its witness.** Nothing in content says a Wizard
  keeps a book but the name of its select (`Spellbook (…)`, `heldSelect`). Aurora's `<spells>` for a book holds only
  spells the character `known`s; a list holds the class. `preparationViolations` holds the mode to that on all 15
  blocks. An always-prepared spell need not be on the block's own list (an Artificer's specialist spells are the
  Wizard's and Cleric's), so removing the marker makes it unpreparable, not over the limit.
- **Held to Aurora** in `tools/verify/src/aurora-oracle.ts` (`preparationViolations`), outside the frozen importer
  package, for all 30: the flagged set exactly, the limits as a multiset against the readout, the mode, and
  everything Aurora lists held or offered. `preparation.test.ts` breaks the rule seven ways and names the samples
  that must notice. **Reported and not asserted:** Aurora marks a spell the character holds by another route
  always prepared in any block whose list has it (samples 18 and 24: one more than content does), so Incudo counts
  it as chosen; the set agrees and neither block is over. Sample 03's Wizard is genuinely over (10 of 8) and is
  the one new problem in the oracle's tables.
- **The list pool is wider than Aurora's**: Aurora had sources and editions switched off. A character can now be
  offered only some books (ADR 0049), but an import does not record which, so an imported character's pool is still
  wider. Never narrower: 0 of Aurora's listed spells are missing.
- ~~**Not modelled:** the 2024 Paladin and Ranger, the Wizard's minimum of one~~ Both since ADR 0097: the 2024 Paladin's
  and Ranger's count is their spell picks (content states it as the select's allowance), and a kind's preparation may
  declare `minimum` (5e: 1). Still not: a list on the Sheet. Rituals are not a gap: the `Ritual` filter is read (ADR 0047).
- **Driven in the browser build only.** A Fighter 12 / Wizard 5 taking a Cleric level was built and its two lists
  prepared, over-limit and reload seen; the library save-and-reopen needs a folder dialog and was covered by the
  tests, which pack and reopen every sample that records a list with zero sources.

**An update check asks every cached file, and a refresh keeps what it cannot reach**
([ADR 0050](docs/adr/0050-an-update-check-asks-every-cached-file-and-a-refresh-keeps-what-it-cannot-reach.md)).
Things to know before touching the content cache or the desktop fetcher:

- **The top index's version says nothing.** AuroraLegacy.index has been 0.0.1 since 2023. A check with ETags cached
  sends one conditional request per cached file and reports how many changed; with none it compares the version and
  says that is all it could do. It still writes nothing.
- **`Fetcher.conditional` says who may send `If-None-Match`.** The Tauri build may; a browser page may not, because
  the header needs a CORS preflight and raw.githubusercontent.com refuses it with a 403. A non-conditional fetcher
  must ignore `etag`, or every browser fetch that carried one would fail. ETags live at `content/<source>/.etag/<url>`.
- **Refresh is `refreshSource`, network first.** A 304 keeps the cached copy, a failure keeps it and is reported, and
  keys the load did not touch are pruned. It no longer evicts first, so offline it changes nothing.
- **The Tauri build fetches through `fetch_content_text` in `src-tauri/src/lib.rs`, not `tauri-plugin-http`.** The
  plugin built a client per request, the host throttles new connections, and a check of 800 files took 113 s and then
  never finished. One client for the life of the window: 3.1 s for the check, 10.8 s for a full download (was 81 s).
  https only, redirects only to https, timeouts. Do not put the plugin back without timing a check of the real corpus
  in the window.

**A source loads every file it lists, and its nested indexes are fetched as soon as they are named**
([ADR 0051](docs/adr/0051-lazy-loading-is-declined-and-the-index-walk-stops-waiting-on-itself.md)). Things to know
before touching `ContentLibrary.loadSource`:

- **Lazy per-file loading was measured and declined; do not build it without new numbers.** A sample character holds
  7 to 18 of the 740 files, but the builder's first screen needs 373 (Race is declared in 123 files, Background in 98,
  every `Source` for the Books list in 133, and 31 files carry appends that reach into other files). An Aurora index
  names files, not types, and a file name misses 16 of the 123 race files. After the first load a reload is 0.8 s.
  `stream` and `download` differ only in when, and that is the design now.
- **Sixty of the first sixty-three requests of an AuroraLegacy load are indexes.** Walked one at a time they were
  about 11 s of a cold first load. `prefetch` asks for each nested index when the index naming it is read, through the
  same limiter as the files (six in flight, indexes first); the queue still decides when each is *applied*. It only
  asks for what the walk would load: the same depth limit, `include` and already-loaded checks.
- **Measured in the Tauri window on Windows, fresh profile, host cold (it keeps files 300 s): adding AuroraLegacy
  36.7 s before, 25.7 s after.** Paired cold loads in one window: 35.0 and 33.5 s before, 25.1 s after; warm about 5.6
  s before, 4.8 s after. The rest is 740 files at about 30 a second from a cold host, which this does not touch. A cold
  run needs five idle minutes first, and a page that imported a module before an edit keeps the old one until reloaded.
- **Held by comparing two loads.** `packages/content/src/index-walk.test.ts` (every rule, each checked by perturbation)
  and `tools/verify/src/index-walk.test.ts` (the real corpus loaded one request at a time and ahead with jittered
  answers: every element, in order, and every diagnostic). Counts alone would not see a load that applied files in the
  order they arrived.
- **An `<append>` reaches its target whichever source loads first.** Appends used to be folded only within their own
  source's load, and the app loads enabled sources into one library in the order they were added: Tasha's index added
  before core's lost 51 support tags (spells on class lists), with the same 7,544 elements and a warning each. The
  library now keeps every append, folds them all again after each source over whatever element holds the id, withdraws
  a warning once its target arrives, and never applies one twice. Held by `packages/content/src/appends.test.ts` and
  `tools/verify/src/appends-across-sources.test.ts` (AuroraLegacy's four groups as four sources, forwards and
  backwards, against the whole index as one). Seen in the browser build: 53 warnings before, 2 after.
- **Partial sources work, and only two of AuroraLegacy's 60 indexes can build a character alone** (the top one and
  `core.index`): skills and languages live in `core/ALE.xml`, which `core.index` lists directly and no book does. Upstream
  states the dependency only in its README ("Requires Core Index").
- **What a source refers to and nothing enabled declares is reported on its line, never enforced**
  ([ADR 0052](docs/adr/0052-a-source-that-refers-to-content-no-enabled-source-has-is-reported-and-never-blocked.md)).
  `ContentLibrary.missingContent()`: grants and select defaults to ids nothing loaded declares, and appends still
  waiting, per source; not requirements (content writes `!ID_X` against absent ids on purpose). A rule an append folded
  into another source's element counts against the append's source; the Aurora overlay's against the first Aurora
  source. Never name a source as "probably missing": nothing in an Aurora index says which, and AuroraLegacy's own
  line always shows the upstream typo, which no source supplies. `missing-content.test.ts` holds the per-source report,
  taken together, equal to `analyseCorpus`'s whole-load count.
- **A switched-off source is named for what it declared at its last load, never guessed**
  ([ADR 0090](docs/adr/0090-a-switched-off-source-is-named-for-what-it-declared-at-its-last-load.md)). After each successful load
  `loadSources` keeps the ids the source's files declare and the parts it had off under `sources/declared/<id>` (with a
  signature beside it, so an unchanged record is not rewritten), **outside `content/<id>/`** on purpose: a refresh prunes
  and an eviction clears that prefix. `LoadReport.declared` walks the library's index lists and file ids again **without
  the "already loaded" check**: a source loaded after one holding the same files (Core, then the Player's Handbook index)
  reads none itself. Given `switchedOff`, `loadSources` reads those sources' records only when something is missing and
  only when the record's parts match the source's now, and sets `LoadedSource.switchedOff`; an id two of them declare is
  under both. The words are `missingNote` (`packages/ui/src/source-notes.ts`). The phone does not pass `switchedOff` yet.
- **Loads of a system's sources may overlap, and only one whose sources are still the ones switched on publishes**
  (`SourceLoads`, `sourcesLoadKey`, `packages/ui/src/source-loads.ts`; 2026-10-12). Two quick switches start two loads
  and the earlier is often the slower: it used to win, and the first to end cleared "loading". The desktop's `reload`
  (`App.tsx`) and the phone's `ContentSources.load` both ask it; a phone load that does not publish returns the current
  set's load (its import uses the result directly). Compared by the sources' key, never "begun last": a source switched
  off and on makes an earlier set current again, and a phone load sharing a pending key would wait on itself.

**The Browse pane looks through everything the enabled sources loaded, and nothing a character holds**
([ADR 0053](docs/adr/0053-a-content-browser-searches-everything-loaded-and-groups-by-what-the-system-declares.md)).
`ContentCatalog` (`packages/ui/src/content-browser.ts`) is the view-model; `apps/desktop/src/panes/BrowsePane.tsx`
renders it and computes nothing. Things to know before touching it:

- **It is handed `content.elements`, the index the load produced**, never the builder's `elements` (which puts an open
  save's embedded content in front) and never `offeredIndex` (a book switched off for one character is still loaded).
  With every source off it says nothing is loaded, whichever character is open.
- **It must never reorder what the index hands back.** `byType` arrays are the builder's candidate lists in the
  builder's order; the catalog sorts a copy. `tools/verify/src/content-browser.test.ts` compares a fresh character's
  offers before and after, and runs first in its file, because the corpus is loaded once per file and an earlier test
  building a catalog hid an in-place sort.
- **A plain scan, no index**: under 8 ms a query in the Tauri window over 14,545 elements. Description text (tags
  stripped, entities decoded) is built on the first query that reaches it, about 150 ms, once per load; the catalog is
  cached per index object (`contentCatalog`), so a reload gets a new one.
- **Ranks**, best first: name equal, name prefix, a word in the name starting with it, every word in the name, the id
  starting with it (so "fire" does not find every `…_FIREBALL`), every word in the description. Within a rank the
  system's `browsable` types come first, then other declared types, then undeclared ones.
- **Types are the system's.** `browsable` (in the format since Phase 0, unread until now) decides the categories shown
  with nothing typed; every type can be a filter, and a type the system does not declare (5e: `List`, `Level`) is
  still searched and listed by the name content gave it.
- **"Offered by" follows only a select whose filter is one plain tag.** That is how an inline list item names its
  background, from the rules and never from the shape of its id. `and`, `or`, `$(…)` and `!` filters are not followed.
- **Ctrl+5 was pressed with real keys in the Windows window** and arrives, from a text field too. Not verified:
  macOS and Linux.

**When two sources define the same id, the later one in the list is used, and each source's line says so**
([ADR 0054](docs/adr/0054-when-two-sources-define-the-same-id-the-later-one-in-the-list-is-used-and-the-list-says-so.md)).
Things to know before touching `ContentLibrary.addElements` or the Sources pane's order:

- **The rule is the load order, which is the profile's order**, and it is what the loader always did: no profile loads
  differently for it. Move up and Move down (`SourceProfile.move`) swap a source with its neighbour among its own
  system's sources and leave every other entry in place.
- **Across sources it is a report, not a warning.** `ContentLibrary.sourceOverlaps()` pairs each source with the one
  whose definition is used, never two losers with each other, and compares definitions as their files declared them:
  an append folded into the first one must not make it read as different. Within one source, and over the Aurora
  overlay, a redefinition is still the warning the corpus budget counts.
- **Line endings no longer change what differs.** A checkout with `core.autocrlf=true` used to make 1,546 identical
  definitions read as different, because the XML parser kept a carriage return inside text. Since 2026-09-25 it reads
  line endings as XML 1.0 §2.11 says (a bugfix to the frozen importer, `xml.ts`), and a CRLF checkout of the original
  Aurora repository beside AuroraLegacy gives the same figures as a byte-exact one: 7,262 shared and 1,978 different,
  in either order. **Do not assume a corpus is LF:** AuroraLegacy's own bytes have CRLF in 51 of its files (Tasha's,
  several 2024 subclasses), and every sample save is CRLF. Git Bash's `grep` does not show a `\r`; count them in Node.
- **Driven in the browser build only.**

**A source records the parts switched off, and the load skips them**
([ADR 0055](docs/adr/0055-a-source-records-the-parts-switched-off-and-the-load-skips-them.md)). Things to know before
touching `ConfiguredSource.excluded` or the chooser:

- **An exclusion list, not an allowlist**, of index or element-file URLs, matched by URL through the load's existing
  `include` hook (`partsFilter`, `packages/content/src/parts.ts`). A switched-off index is never read. `loadSources` and
  `refreshSource` both pass it, so a refresh prunes a switched-off part's cached files like a file upstream dropped.
- **The tree and the load must agree.** `readIndexTree` walks level by level, as the load's queue does, so "first
  mention" means the same in both; it lists refs by the load's own `isElementFile` and depth limit. `tools/verify`'s
  `source-parts.test.ts` holds the tree to the exact URLs a real corpus load requests. `partsView` (`packages/ui`) counts
  what will load by walking the same way, and a test holds it to a real load for every single part switched off.
- **Driven in the browser build only.**

**An Aurora file the user adds is a source of its own, kept as a copy**
([ADR 0056](docs/adr/0056-an-aurora-file-the-user-adds-is-a-source-of-its-own-kept-as-a-copy.md)). Things to know
before touching `packages/content/src/file-source.ts`:

- **`kind: 'file'`, id and URL `local:<file name>`**, text in `Storage` under `sources/files/`, never under `content/`:
  eviction and the refresh prune remove whatever is under a source's cache prefix, and this is the only copy.
  `removeSource` deletes it with the profile entry. Adding the same file name again replaces the copy in place.
- **`composeSource` returns a `FileContentSource`** (an index of one file, parsed once), and `checkSourceForUpdates` and
  `refreshSource` say there is nothing upstream. The pane hides mode, check, refresh and parts for it.
- **A drop is a port, `FileDrop`**, because the Tauri webview never sees a dropped file (the host reports paths, and
  `tauri-plugin-fs` grants them). It is listened to only while the Sources pane is shown. **`TauriFileDrop` first ran on
  2026-09-28** in the Windows window: a real OLE drop (from a form of the test's own, not from Explorer) added a file, and
  "Choose files…" through the native dialog replaced it. The browser drop has only ever been a dispatched drop event.

**Which books a character is offered is one recorded list, and it narrows offers only**
([ADR 0049](docs/adr/0049-a-character-records-which-publications-it-is-offered-and-it-narrows-offers-only.md)).
Things to know before touching it:

- **The unit is the book, not the content source.** A publication is an element of a type the system marks
  `publication: true` (5e: `Source`), and every other element names its book in `source`, joined ignoring case. An
  element whose `source` names no loaded book (`Internal`, `Core`, two misspellings) is always offered.
- **`Character.publications` is an allowlist of names, absent for every book**, optional, no `formatVersion` bump. A
  recorded name nothing loaded has is kept and shown as not loaded. It is not `Character.sources`, which is provenance
  (ADR 0028), and not the profile, which decides what is loaded.
- **`offeredIndex` (`packages/ui/src/publications.ts`) is a view: `all`, `byType` and `bySupport` filter, `get` does
  not.** The derivation reads only `get`, so switching a book off moves no derived number; all thirty samples derive
  identically offered no book at all. The builder reads every index through its `elements` getter, which is that view;
  `content` is everything loaded and only the Books list reads it. A new enumeration of the index belongs behind the
  view, or it will offer switched-off books.
- **A book content marks required is always offered** (`requiredWhen`, 5e's `core`). One book carries it, Aurora
  Legacy Essentials, and it holds every skill, every common language and the alignments: without it a character
  offered only the Player's Handbook is offered no skill. Found by running the app, not by a test.
- **Not done:** the frozen importer does not fill the list from a save's `<restricted>`; no edition switch; no
  per-user default for new characters.

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
builder's own state only when the shell hands over the *same character object* (a content reload, a
save), and starts from what it is handed otherwise (open, new, import). It used to key on
`character.id`, and that hid a third bug until 2026-09-28: opening the library file of the character
already on screen kept the copy on screen and never read the file. Twelve green test files cover this code and none
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

Twelve things the shell has surfaced, seven of them since fixed and struck through. The rest are
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
  *(Note, 2026-09-23: on the thirty samples that run is not byte-identical: 12 change, `stat-mismatch` falls
  25 to 11 because 14 save DC and attack rows were wrong by the dropped second pick, so the spellcasting rows
  did see it. ADR 0035's note.)*
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
- **~~Nothing moves a recorded source version.~~** Fixed ([ADR 0082](docs/adr/0082-a-refresh-compares-what-a-character-carries-with-what-its-sources-load-and-shows-the-sheet-it-would-make.md)),
  and the version turned out to say nothing: AuroraLegacy's index has been 0.0.1 since 2023. A refresh is offered when
  the open character's embedded copies differ from what its sources load (`contentChanges`, `packages/ui/src/content-refresh.ts`),
  reviewed as the Sheet it would make (the sheet document built twice), and applied all or nothing: every copy the sources
  define replaced, every other kept, choices untouched, `refreshSourceRefs` moving the recorded versions, the file changed
  on Save. Asked only of the character on screen: a library card still reaches for no content. `content-refresh.test.ts`
  measures it against an older checkout named by `INCUDO_BASE_CORPUS_INDEX` and holds that no sample saved against
  today's content is offered one.
- **~~A draft reloaded with no source enabled has lost its file's embedded content.~~** Fixed
  ([ADR 0066](docs/adr/0066-the-draft-keeps-what-the-shell-held-beside-the-character.md)), and it was worse than
  recorded: the library entry went too, so the next Save wrote a *second* file embedding nothing. The draft now keeps
  the rest of the working state beside `character:current`, under `character:current:origin`: the opened file's
  embedded content and assets, its entry, read time and saved name, tied to the draft by the character's id, all or
  none, and written on an open, a new character or a save, never a keystroke. It keeps what the session held, not what
  the character reaches: an element taken from a source after opening is not kept, because a reload must change
  nothing. `packages/ui/src/draft.ts`; `boot.ts`'s `loadDraft` reads it. Driven in the browser build only.
- **~~Importing N saves rescans the library N times.~~** Fixed (ADR 0086's third pass, measured on a phone, where a
  rescan was most of a Save): `CharacterLibrary.save` puts the entry it wrote into the listing from the files it wrote,
  which is also what the collision suffix reads next, and rescans nothing. A scan still reads every container in full.
- **No `supports` operand is unread any more** (ADR 0030, ADR 0005). There were three; `Class` was never an
  operand problem (see the improvement entry above), and `Ritual` and `!` are read (ADR 0047, ADR 0048).
  ~~`!` **negation** inside a filter~~ — **read** (ADR 0048): a tag operand starting with `!` holds when the
  candidate does not answer to the rest (a tag, its id, or a setter value). It is read in `matchesSupports` and
  **not in the parser**, on purpose: a `.incu` embeds parsed elements, so a parse-time reading would leave every
  save written before it holding the literal `!TCOE Base`. It negates one operand only: a `!` before a group
  or a `$(…)` is not a negation (0 in the corpus). Samples 01 and 03 (the Artificers) pick ten elements through
  negated selects and all pass; `negation-filter.test.ts` reads each negated select's list from the elements and
  fails without the change. Driven in the Tauri window on Windows (2026-09-24, not macOS or Linux): a level 2 Tasha's Artificer is offered 11
  infusions and none of Eberron's, the level 3 specialist 5, and a Dragonmark's ability increase leaves out the ability
  its mark fixes. Not measured: the infusion selects that open at level 6 and above. ~~`Ritual` — 17 uses~~ — **read** (ADR 0047): a spell carries
  `<set name="isRitual">true</set>`, and a kind's `setterTags` (`systems/dnd5e/system.json`) says that a
  setter holding `true` is the tag `Ritual` *for a select's filter only*. It is a named pair and not a rule
  on purpose: one setter in the corpus needs it (the other true-setter names that are filter operands,
  `exotic` and `standard`, are also written as explicit tags, so they witness nothing), the tag is never
  added to the element or written into a save, and a second entry would be the evidence for a general rule.
  Second witness: two samples pick spells through a `Ritual` filter (06's Ritual Caster feat, 30's 2024
  Pact of the Tome) and all four are `isRitual` true. `aurora verify` cannot see it; `ritual-filter.test.ts`
  holds each of the 17 selects to a list read straight from the spells, and removing the declaration empties them all. Driven in the Tauri window on Windows
  (2026-09-24): a Wizard 4's Ritual Caster feat is offered 17 first-level rituals and nothing else, and two picks settle and
  survive a save, restart and reopen with no source.
  ~~`Class` — 15 uses, matching no tag
  on any of the 14,316 elements~~ — a tag on the six `ID_INTERNAL_ASI_*` elements the overlay
  supplies, which is what those 15 filters select. The shell shows "No candidate in the loaded
  content matches this choice" for what is left of these, which is honest but not the whole truth.
- **~~There is no export.~~** Fixed (ADR 0038): "Save a copy…" writes the character on screen to a
  file the user picks. See the paragraph after the commands list above.
- **~~An NPC or legendary creature has no way to set ability scores.~~** Fixed (ADR 0057), and a creature's
  printed scores are where they start, so the budget below is the DM's override, not the only input. Both kinds declared a
  required `abilities` step with `"types": []` and **no `budget`** — the inert shape ADR 0017
  names, which matches no pending choice and reports itself complete. The editor is a budget
  renderer and knows nothing about 5e, so this is one `budget` block per kind in
  `systems/dnd5e/system.json` with `manual` as its only method (a monster's scores are printed,
  not bought). Left unwritten while the phase is about a PC.

ADRs 0007, 0009, 0012, 0014, 0015, 0016, 0017, 0018, 0022, 0023, 0024, 0025, 0026, 0027, 0028, 0029, 0030, 0031, 0033, 0034, 0035, 0036, 0040, 0041, 0046, 0057, 0058, 0059, 0060, 0061, 0062, 0063, 0064, 0065, 0066, 0067, 0068, 0069, 0070, 0071, 0072, 0073, 0074, 0075, 0076, 0077, 0078 and 0083 are implemented, and so is **0032**: a build step may declare `multiple: true`
and is then published as a non-blocking, skippable *set* (`OpenDecision.multiple`,
`SettledPick.multiple`), recorded under `build/<stepId>`. 5e's `options` step is the first — campaign
options, found by type (`Option`) with no id named. Three things to know before touching it: a set is
read from its own key only, where a race is read by what it holds (`top-level-pick.ts`); **since ADR 0080 a set step
may declare `initial`, which `newCharacterOfKind` writes into a new character as its recorded answer** (5e: feats and
multiclassing on), never read again, so a character recording no answer still means none; the overlay's
`ID_INTERNAL_OPTION_ALLOW_MULTICLASSING` is offered, and since ADR 0088 the class control reads it through the levels
step's `multiclassWhen` (no content does); and `aurora verify` cannot see any of it, so the evidence is
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
- **Six Aurora constructs were being silently dropped**: element-level `<supports>`
  (3,611 blocks — *every* support tag in the corpus), element-level `<requirements>` (1,845),
  `<append>` (171), `equipped=` (79, none of which is `"true"`, all read as `false` — fixed by
  ADR 0021), `<spellcasting><list>` (17, fixed by ADR 0030 — the tag
  `$(spellcasting:list)` needs, which had never reached the engine), and a `<sheet>`'s later
  `<description>`s (320 in 220 sheets, gated by `level=`, 11 carrying a usage or action of their own —
  fixed by ADR 0076). Every one was found by counting what the corpus contains rather than by
  reading the format. See docs/AURORA-FORMAT.md, which also counts the inline list items and so
  calls the `<sheet>` one the seventh.

**The builder has no current step** (ADR 0017). `CharacterBuilder` publishes `decisions` — one
flat, always-current list — and `steps` is a grouping with `available`/`blockedBy`, not a
sequence to walk. There is no `goToStep` and no Back button; `focus()` is presentation and
nothing depends on it. A decision opened at level 4 arrives in the same list as every other.
`Character` gained a sixth input, `generation`, recording which method a budgeted step used.
A budget is written through `setBudgetStat`, `adjustBudgetStat`, `rollBudget`, `clearBudgetRolls`
and `setGenerationMethod` — all validated, all on the builder. `setBaseStat` still exists and
bypasses every rule; it is for a caller that has no budget, not for an editor.

**Open decisions are listed by the level they open at, then by step rank** (2026-10-13). Measured first
(`tools/verify/src/decision-order.test.ts`): an Elf Sage taken straight to Fighter 6 listed Martial Archetype (3) and
both improvements ahead of its level 1 Fighting Style and skills, a Wizard 6 its first cantrips and spellbook last, and
the scores and hit points were appended after the sort. The engine publishes `PendingChoice.opensAt` (`arrivalLevels`,
after the fixed point, never fed back): the later of when the select's owner arrived (its grants' `level=`, a pick's
select, back to a seed at 0) and the next slot's level, each a track's level turned into the character's total through
`advancement` — so an Arcane Tradition select naming no level opens at 2, and a Rogue 5 / Wizard 3's wizard 3 at 8.
`OpenDecision.opensAt` carries it (hit points: the first level still to roll); the builder sorts by it, everything at
or before the progression's start being one level, so creation keeps the system's step order (ADR 0034's `priority`).
The phone reads the same list. Driven in the browser build.

**A score in the build shows its modifier, "16 (+3)", read off the sheet's `beside`** (2026-10-13). `statBeside`
(`sheet.ts`) finds the kind's first sheet section listing the stat with a `beside` template and writes that published
stat as the sheet does; `BudgetRow.beside` and `budgetTotalText` carry it to the desktop's editor and settled scores and
the phone's. Nothing in `budget.ts` knows a modifier's formula; a kind whose sheet shows nothing beside a score shows the
total alone. Driven in the browser build.

**A build step may be `advanced`, offered only when the user switches on "Show advanced options"**
([ADR 0115](docs/adr/0115-a-build-step-may-be-advanced-and-how-a-user-likes-the-build-is-a-preference.md)). 5e marks
"Additional features" and "Ability score adjustments" (the maintainer's call; Tasha's optional class features stay
offered). Off, the step opens no decision and has no line, unless something was taken through it, which stays a settled
pick; nothing is declined or written to the character. `CharacterBuilder` takes `showAdvanced` (default off) and
`setShowAdvanced`; `BuilderState.advanced` names the steps. The preference is `build/view` in `Storage`
(`build-preferences.ts`), never `character.json`; the desktop and the phone both have the switch. Validation refuses it on
a step that must be answered. A test that measures what those steps offer passes `{ showAdvanced: true }`. The same
record holds whether the option preview is folded to its title line (`previewCollapsed`, Hide/Show description) and which
of Build's two tabs is open: **Build** (progression, cantrip dice included) and **Equipment & notes** (taken starting
packages, inventory and money, prepared spells, About the character, For reference, Books), `BUILD_TABS`. The command
`switch-build-tab` (View menu, Build only, Ctrl+Shift+H, not yet pressed with real keys in the window) moves between
them. The phone has the switch and not the tabs or the fold.

**Each level's hit points are a card of their own** (2026-10-14, the maintainer's call): a `hitpoints` decision per level
still to record or under review (`OpenDecision.hitPointLevel`, "Hit Points, level 4", `hitPointDecisionLabel`), opening at
that level, so a new level asks for its own roll among its own choices. A roll is not an acceptance: the card stays
until its Done (`confirmHitPoints(stepId, level)`; with no level, every level). `HitPointState.reviewingLevels`; the
desktop's `HitPointEditor` and the phone's `HitPointsView` take `only`. The whole table is in "Values already set" once
any level is not an open card (`settledSteps`).

**Alignment and Deity are skippable picks, and a background's chosen suggestions stand in for the personality text**
([ADR 0116](docs/adr/0116-a-text-field-may-stand-in-with-what-a-character-chose-and-alignment-and-deity-are-picks.md)).
5e's "Details" step offered nothing (not required, a pick or a set); it is two `pick: true` steps now (9 alignments, 296
deities). A freeform field may declare `suggestedBy` (select names): while blank it shows the held elements chosen under
those selects, one per line, on Build and the sheet, stored nowhere (`chosenUnderSelect`, `freeform.ts`). Aurora copies
the same text into the save, so an import shows its own copy. Driven in the browser build.

**Hit points have no oracle in the save file, and a referee on the screen** (ADR 0019, ADR 0044). Aurora's
saves record the per-level rolls and never the total, so `aurora verify` has nothing to diff; the referee is
the maintainer's readout, and `aurora-oracle.test.ts` holds `hp` to it on all 30 samples. Say "agrees with a
person's reading of Aurora's screen", never "verified" beyond that.

> **Update, 2026-09-23 — hit points agree with the readout on all 30 samples and are held to it** ([ADR 0044](docs/adr/0044-hit-points-follow-the-method-the-character-uses.md)):
> the importer files a multiclass save's per-class dice under the character levels that class was taken at (a
> bugfix to the frozen package, the one exception), an item that sets a score is a lower bound on it, a
> single-class character publishes `level:<class>`, and `ID_INTERNAL_OPTION_ALLOW_AVERAGE_HP` decides where the
> dice come from for the whole character. With it on, `hp` is each class's die average per level (the character's
> first level the maximum), read off the class's `hd` by a per-track `setter` expression and `track:first`, and
> the recorded rolls are kept and not read; with it off the recorded rolls are read as before. A build step's
> `levelRoll.fixedWhen` names that option, and while it is on the builder opens no hit points decision. Things to
> know: the flag is a kind `contribution` gated on the option, not a mode of the engine; the maximum for the first
> level belongs to whichever class the advancement's earliest entry names, and a second class's first level is an
> average; and a rolled character switched to the option loses no roll, it stops being read.

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
`type`, so a pending pool offers the union of the candidates of the rules a further pick can reach. Since ADR 0096
picks are placed as a matching and a pick no rule offers is flagged (below). See docs/AURORA-FORMAT.md.

**A pick counts while its slot exists, and a pool's slots are filled as a matching**
([ADR 0096](docs/adr/0096-a-pick-counts-while-its-slot-exists-and-a-pool-s-slots-are-filled-as-a-matching.md)).
Things to know before touching it:

- **Measured first** (`tools/verify/src/pool-slots.test.ts`): 2,703 select pools, 89 with more than one rule; in the
  thirty samples 826 picks, 148 of them under keys no pool owns (Aurora's `ID_LEVEL_1/select:Race|Class|Background`,
  `ID_LEVEL_N/select:Multiclass (Level N)` on rule-less elements, `build/options`), and **0 stale, 0 over, 0 unplaced, 0
  whose own requirements are false**. Reversed, the old level-order fill would have misplaced 19. The oracle is identical.
- **Only a record under a pool content declares can stop counting**: `<element>/select:<name>` where that element carries
  a `select` of that name (`poolOwner`). Its picks count while the element is held with that pool's rules active, and only
  as many as the pool has slots; the rest are `DerivedCharacter.uncounted` (`closed` | `over`), kept in `choices`, never
  seeded, never a repeat (ADR 0035), not a `Problem`, in `summarize()`. Any other key always counts: never widen
  `poolOwner` to "any key with `/select:`", or every import's class and race stop counting.
- **Inside the fixed point**: pass 1 seeds every pick; each pass's own holdings (`makeContext(next, nextStats)`, not
  the previous pass's) decide the next pass's seeds (`countedSeeds`, `countedChoices`); a change keeps the loop going. A
  stale chain costs a pass per link. Two stale picks opening each other's pools keep each other (not seen in content).
- **Placement is `placePicks`** (`packages/core/src/pool-slots.ts`, Kuhn's augmenting paths in record order): a pick
  fits a rule by type and filter only (not its own requirements); an unknown element or a filter with an unresolved
  `$(…)` fits. An open pool offers the union over `available` rules; its `level` is the first `free` rule's. A counted
  pick no slot takes is `choice-unplaced` (warning) and `unplaced` on the pending/answered choice. `over-selected` is
  gone. `poolSlots(derived, index, ruleKey)` reads a pool's rules, fits and slots off a finished derivation.
- **A held pick whose own requirements are now false is `requirement-unmet`** (ADR 0064 amended), once per element.
- **A save embeds a recorded pool's owner for its selects only** (the ADR 0069 text frontier in
  `collectCharacterContent`), or a reopen with no source would count what does not.
- **The builder**: `BuilderState.uncounted` (`uncountedRows`, `packages/ui/src/uncounted.ts`) under "Not counting",
  `forgetUncounted` the only remover; a pool's decision shows `countedPicks`, and `choose` appends the waiting picks
  (`withUncounted`). `SettledPick.unplaced` and `unplacedNote` mark a slot. Desktop `BuilderPane.tsx`, phone
  `BuildView.tsx`; both compute nothing. Driven in the browser build only.

**A 2024 half-caster's prepared count is its spell picks, and an added spell is cast through a block the user names**
([ADR 0097](docs/adr/0097-a-2024-half-caster-s-prepared-count-is-its-spell-picks-and-an-added-spell-is-cast-through-a-block-the-user-names.md)). Two decisions. Things to know before touching either:

- **A: no table in the system definition, on purpose.** Measured (`tools/verify/src/prepared-counts.test.ts`): the 2024
  Paladin's and Ranger's Prepared Spells column (read out of the description by the test only) equals the allowance of
  their block's `Spell (Paladin)` / `Spell (Ranger)` select at all 20 levels, and the 2024 Bard's, Sorcerer's,
  Warlock's, Eldritch Knight's and Arcane Trickster's the same; the 2024 Wizard, Cleric and Druid prepare by a
  `<class>:spellcasting:prepare` table equal to theirs. The builder already owed those counts and none of them has a
  `PreparedBlock`, so "a limit of 0, anything prepared is over" never happened. Do not make them preparing blocks or mark
  their picks "prepared": content's shape is the 2014 Sorcerer's and nothing says the edition.
- **`preparation.minimum`** (system format, optional): a preparing block's limit is never below it. 5e: 1 (the 2014
  book's minimum of one, for every preparing class). No sample's limit is below 1, so it has no referee.
- **B: `Character.additionBlocks`** (added id → lowercased block name, the `prepared` key), **format 10** only when
  recorded (`setAdditionBlock`; `setAdded(…, false)` drops the record); the validator refuses it below 10 and on an id
  not in `additions`. **`additions.blocks`** on a kind (`types` among the addable ones, `label`, `with` with `{name}`,
  `none`; 5e: Spell, "Cast as", "cast as {name}", "cast through no class").
- **The engine** (`resolveAdditionBlocks`) publishes `DerivedCharacter.additionBlocks` (`{ elementId, block }`, block as
  content wrote it; in `summarize()` when non-empty) and attaches each to a preparing block's list as **always prepared**,
  as a grant with the `prepared` marker is. A block nothing held declares is `addition-block-missing`, a type not cast
  `addition-block-not-allowed`; both warnings, cast through none, record kept. A block's DC, attack and slots are its
  stats (ADR 0020), so nothing else in the engine reads a spell's block.
- **The builder** records the only block when an element of a cast type is added to a character holding exactly one
  (`addElement`), never derives "the only one" later; `setAdditionBlock(id, key | undefined)` refuses an element not
  added, a type not cast, a block not held. `AddedRow.block` (`packages/ui/src/additions.ts`, `heldBlocks`, `NO_BLOCK`)
  is the row's choice; desktop `Additions.tsx` a select, phone `BuildExtras.tsx` a picker.
- **The sheet**: `SheetListedElement.cast` (`additionCasting`, `sheet.ts`), written by `listedAside` after the prepared
  mark: "Fireball (Level 3, always prepared, cast as Cleric)". The official form's spell lines write names only.
- Tests: `packages/core/src/addition-blocks.test.ts`, `packages/ui/src/addition-blocks.test.ts`, the minimum in
  `preparation.test.ts`, the validator in `schemas.test.ts`, each failing under its named perturbation. The oracle is
  identical. Driven in the browser build only.

**Starting equipment is a file beside the system, and money is counted in the units the system declares**
([ADR 0087](docs/adr/0087-starting-equipment-is-a-data-file-beside-the-system-and-money-is-counted-in-the-units-the-system-declares.md),
built 2026-10-07; its dated note says what building it changed). Things to know before touching it:

- **Measured first** (`tools/verify/src/starting-equipment-content.test.ts`, report-only): content states starting
  equipment only as prose (0 rules of 29 classes and 118 backgrounds grant or select an item); the 2024 rows are 11 "Choose
  A or B" and the Fighter's "A, B or C"; all thirty samples record 0 of every coin. **`<extract>`**, 44 blocks listing what
  a pack holds (29 of them 2024 "Class/Background Equipment Pack" items), is a construct the parser does not read; the
  test of the file reads the XML itself.
- **`systems/dnd5e/starting-equipment.json`** (schema `schemas/starting-equipment.schema.json`, checker
  `checkStartingEquipment` in `packages/ui/src/starting-equipment.ts`, the only one; both shells' `boot.ts` and
  `node-system.ts`'s `loadShippedStartingEquipment` call it). Not the system format. It names its `kind`, the `step` that
  offers packages, the pick steps they come `from` (the class pick's answer is the first class) and the item types it
  `equip`s. An entry per element id, options of which one is taken: `lines` (a bundle of `items` and `picks`, or `choose`
  among bundles), `coins`, a `wealth` roll alone, `unlisted` text. A pick is a `from` list or `types` + `supports` (content's
  language) + `publications` (the weapon category tags are shared across editions). The file is written by a person; a
  scratch generator is not committed. It covers every class and background whose book lists starting equipment (29 and
  117; the 2014 custom background lists none of its own), by the maintainer's call (2026-10-12, ADR 0087's note).
- **Held by `tools/verify/src/starting-equipment.test.ts`**: every id declared (236), every filtered pick offering
  something, each 2024 package agreeing with its pack item's `<extract>` (129 items; the Guard's light crossbow is an
  upstream id nothing declares). What the file does not cover is reported by book, not asserted.
- **`GameSystem.currency`** (system format, optional): units by id with `label` and `exchangeRate` as the book states it.
  `currencyProblems` (core) refuses rates that disagree, naming both routes, a rate naming an undeclared unit, a unit no
  rate reaches; `currencyWorths` works each unit's worth out (5e cp 1 … pp 1000) and nothing stores it.
- **`Character.money`** (whole counts per unit, zeros dropped, `setMoney`/`addMoney`) and **`Character.startingEquipment`**
  (per class or background: the option, the instance ids and quantities of the entries it added, the coins;
  `setStartingEquipmentTaken`) are **format 11**, only when recorded. **Not a choice**: a choice outside a pool seeds the
  derivation. `validateCharacter(value, schemas, system?)` refuses a unit only when handed the system.
- **The importer reads `<currency>`** (in `<input>`, so it had reached freeform as five numbers): copper/silver/electrum/
  gold/platinum to cp/sp/ep/gp/pp, non-zero only, out of freeform. A bugfix to the frozen package; no sample moves.
- **The builder** takes `{ startingEquipment: files }`, uses the one for its system and kind, and publishes
  `BuilderState.startingEquipment` (sources: unanswered, none, open, taken, used, and a package taken for an earlier class;
  the purse). An open source is a non-blocking `equipment` decision, `startingKey(forId)`. Answers live in a draft the
  builder holds and never saves (`chooseStartingAlternative`, `pickStartingItem`); `takeStartingOption` writes once (items
  of an `equip` type equipped where `resolveEquipment` finds room, in package order, the rest carried; a wealth roll recorded
  under `wealthRollKey` and read again on a retake) and returns a sentence when refused; `returnStartingOption` removes
  exactly what was recorded, only while untouched. Desktop `panes/StartingEquipment.tsx`, phone
  `StartingEquipmentView.tsx`; both compute nothing.
- Tests: `packages/core/src/money.test.ts`, `packages/ui/src/starting-equipment.test.ts`, the validator in `schemas.test.ts`,
  the importer's, `tools/verify/src/starting-equipment-build.test.ts` (a 2014 Fighter through the builder: armour class 18,
  reopened with no source to the same bag and purse), each failing under its named perturbation. The oracle is identical.
- **Not done:** ~~the inventory editor, spending or making change, opening a pack, money on the Sheet and the form~~ (ADR
  0098, below); ~~the other books' classes and backgrounds~~ (2026-10-12). Driven in the browser build only (a 2014 Fighter and Soldier, a
  wealth roll, Take back, a reload); not on a phone or in the Tauri window.

**The bag and the purse are edited in place at any point, and what each item gives is read off the derivation**
([ADR 0098](docs/adr/0098-the-bag-and-the-purse-are-edited-in-place-and-what-an-item-gives-is-read-off-the-derivation.md)).
Things to know before touching it:

- **Measured first** (`tools/verify/src/inventory-editor.test.ts`, report-only): 2,881 items, 83 of them the equip steps'
  families, 8 hidden mounts that are goods; 902 prices are 0 (Aurora's "not for sale") and 32 a dash, none a fraction;
  **214 of 415 adorner filters admit no host unless the host's name is an operand** ("Plate", "Longsword"); every stat a
  sample's item moves is unlabelled (`ac:armored:armor`), so Armor Class is reached only through the kind's formulas.
- **`packages/ui/src/inventory.ts` is the view-model** (`BuilderState.inventory`, `inventoryState`); every write is a pure
  `plan…` returning a character or `{ refused }`, and the builder's methods (`addItem(id, buy)`, `equipItem`, `attuneItem`,
  `attachItem`, `openItem`, `setCoins`, `spendCoins`, `exchangeCoins`, …) return the sentence. Desktop
  `panes/InventoryEditor.tsx` on Build, phone `InventoryView.tsx`; both compute nothing. **No character format change.**
- **System format** (all optional, `formatVersion` 1): `inventory.types` (what can be added), `inventory.adornSetter` (5e
  `type`: an item whose setter names one of those types attaches to a host of it, filtered by its setter named after the
  type, the host's own name an operand here only, never in `matchesSupports`), `inventory.price` (`cost` / `currency`), and
  a sheet section's `bag`. The equip steps' families are never offered or listed in the bag (`takenOnBuild`).
- **Money**: `packages/ui/src/money.ts` (the purse helpers moved there). Buying and spending take only the item's own coin;
  **change is made only by Exchange**, refused unless it comes out whole ("a multiple of 10 gp").
- **What an item gives** (`gives`): the sheet rows it moves (contributions followed through `derive` by name, as ADR 0095),
  a row's section named when two sections show its label, what it grants that a section lists, an attack, or why nothing
  (carried, not attuned). Taking a starting package back follows `packageUntouched` unchanged; a package's entries and
  coins say what editing them does to it.
- **`<extract>` is parsed** as `Element.contents` (the eighth dropped construct; `CONVERTER_VERSION` 2). Open replaces one
  of an entry with its contents and names an id nothing declares.
- **The Sheet lists the bag** (every entry, "Arrows ×20", "(equipped, attuned)", and a Money line) where it used to list
  only equipped items, so every export with a bag changed; the 2014 form's Equipment box flows the bag and CP–PP take the
  purse (form rule `money`).
- Tests: `packages/ui/src/inventory.test.ts` (each case failing under its named perturbation),
  `tools/verify/src/inventory-editor-build.test.ts` (a Fighter from nothing: wealth, buy, equip, attune, Mithral, a pack,
  an exchange; AC 18 → 19, speed 20 → 30; the desktop's file read with the phone's zip, reopened with no source the same).
  The oracle is identical. Driven in the browser build; **not on the phone emulator or in the Tauri window**.

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

**What an offered candidate would grant in turn is marked, not left out** ([ADR 0091](docs/adr/0091-an-offer-that-would-give-what-the-character-already-has-is-marked-and-the-system-says-which-types.md)).
A Sailor background for an Elf who has Perception is still offered; its picker row reads "The character already has
Perception". A kind declares which types are worth naming (`candidateOverlaps`; 5e's `pc`: Proficiency and Language, not
Size, Spell, Vision or internal markers, as measured by `tools/verify/src/candidate-overlaps.test.ts`). The walk
(`packages/ui/src/candidate-overlaps.ts`) follows content's grants without deriving, skipping one gated above the level
the candidate is taken at or whose requirements are false against the character (203 overlaps in the samples exist only
if they are not read). **A settled slot is judged without its own answer** (`overlapsFor(ruleKey, slot)`, one
derivation), or everything the answer gives reads as redundant. Asked for when a picker opens (`overlapNotesFor`), never
carried in the state; the desktop's `CandidatePicker` and the phone's `Picker` show the line and compute nothing. Display
only. The 2014 replacement proficiency is a separate, open question.

**What a user writes about a character is fields a kind declares, kept in `Character.freeform` under the keys the Aurora
importer already writes, and every sheet shows what is written** ([ADR 0092](docs/adr/0092-a-kind-declares-the-text-a-user-writes-about-a-character-and-every-sheet-shows-it.md)).
Things to know before touching it:

- **`freeform` on a kind** (system format, optional, replaced along `extends`): `label`, `description`, `fields` (`key`,
  `label`, `group`, `multiline`); the validator refuses a key twice. 5e's `pc` declares 21 (`player-name`,
  `appearance.age`, `background-traits`, `backstory`, `organization.allies`, `currency.treasure`, `notes.note.left`, …:
  Aurora's own keys, so an import shows with no importer change), `npc` (and so `legendary`) `description` and `notes`,
  Cairn three. **Undeclared on purpose**: coins, `experience`, `attacks.*`, a background feature's text, the faction
  symbol, `list.*`. `freeform-fields.test.ts` holds every declared key to Aurora's vocabulary and every key a sample
  carries to "declared or left out on purpose".
- **`setFreeform` (core) keeps text as typed, drops a blank value, moves no format version**; the builder's `setFreeform`
  keeps the derivation as a play edit does. `BuilderState.freeform` (`freeformState`, `packages/ui/src/freeform.ts`) is
  the editor's state; the desktop's `Freeform.tsx` (Build) and the phone's `FreeformView` (`BuildExtras.tsx`) render it.
- **`SheetDocument.freeform`** (`sheetFreeform`): the fields with text, trimmed, after creatures and before kept texts; a
  print part (`freeform`, `print-omit-freeform`, not in the "kept whole" rule, not a `dl`); the Markdown writes it under
  `##` its label. **`SheetDocumentSource.freeform` is required**: the phone's sheet picked parts and left it out, found on
  the emulator.
- **ADR 0075's check moved**: `sheet-export.test.ts` holds every declared field's text *in* the export and no undeclared
  key's prose out of it.
- **The form map's `{ field, freeform: key, capacity? }` rule** fills fifteen 2014 boxes; with a capacity it writes at that
  size and names text that runs past the box rather than cutting it (two suggested traits do, on 9 samples).

**A character's attacks are its bag's weapons, and the kind declares what each adds up**
([ADR 0093](docs/adr/0093-an-attack-is-a-weapon-in-the-bag-and-the-kind-declares-what-it-adds-up.md)). Things to know
before touching it:

- **Measured by `tools/verify/src/attacks.test.ts`**: 97 weapons, each with a `damage` die (its type an attribute) and a
  `proficiency` setter naming one declared element; melee, ranged, finesse and the 2014 properties are **support tags that
  name no element** (the 2024 masteries and firearm properties are `Weapon Property` elements); a magic weapon is an
  adorner with an `enhancement` setter and no rule. Content adds `ranged:attack` (Archery), `<weapon name>:attack` and
  `<weapon name>:damage` (Blade Mastery, Bracers of Archery). **Aurora writes an `<attacks>` row for every weapon in the
  bag, carried too**, and all eight in the samples agree with the sheet, which the test now asserts.
- **`attacks` on a kind** (system format, optional, replaced along `extends`; `companionScopeKind` drops it): `types`,
  `tagStat`, `bonus`, `damage`, `stats` (contributions `{ stat, value, requirements? }`), `dice`, `damageType`,
  `alternatives`, `range`, `nameSetter`, `properties` (`types` named by element, `labels` for tags naming nothing). The
  validator refuses an undeclared type, a condition that will not parse (placeholders stood in for) and `attacks: true` on a
  section of a kind with none.
- **`deriveAttacks` (`packages/core/src/attacks.ts`) runs once after the fixed point** with the engine's own context:
  every bag entry of the types, carried or equipped, in bag order. Contributions in order, an attack stat read before the
  character's; the attack's tags (element's and adornments' supports and names, lowercased) under `tagStat`; `{name}`
  and `{<setter>}` filled from the element (exact case in a requirement, so `{proficiency}` is "holds this weapon's
  proficiency"); a `setter` expression **`as: "number"`** sums over the element and its adornments, an adornment needing
  attunement on an unattuned entry not read. **No stat of the character moves**; published as `DerivedCharacter.attacks`,
  in `summarize()`. The oracle is identical.
- **5e's `pc`** (`systems/dnd5e/system.json`): ability Strength, Dexterity for a simple or martial ranged tag, the higher
  for finesse; bonus = ability + `proficiency` when `{proficiency}` is held + enhancement + `ranged:attack` (ranged) +
  `{name}:attack`; damage = ability + enhancement + `{name}:damage`; `versatile` is the "two-handed" die; an Attacks section
  after Combat. A held creature's scope labels `companion:attack`/`companion:damage` and shows them ("Added by Its
  Holder", `showWhen`); a creature's actions are prose and are not rewritten.
- **The sheet**: a section with `attacks: true` carries `SheetSectionView.attacks` (`SheetAttack`, `sheetAttack`,
  `attackDamage` in `sheet.ts`: "1d8+3 slashing", the die as content writes it, never parsed). `attackHead`/`attackAside`
  (`sheet-document.ts`) are the one wording; the desktop's `SheetRows`, the phone's `Section` and the Markdown call them.
  The form map's `{ attacks: { section, rows: [{ name, bonus, damage }] } }` rule fills the 2014 weapon rows (the rule that
  wrote the hands' contents is gone), a fourth attack named as left off.
- **A save embeds the `Weapon Property` elements a bag element's supports name, for their names only** (ADR 0069's
  text-only frontier), so Vex survives a reopen with no source; `sheet-export.test.ts` catches it, `self-contained.test.ts`
  does not (its fixtures carry no weapon). Its personal-text check exempts an `attacks.*` freeform value equal to the
  properties the sheet's own attack writes: Aurora copies them there.
- **Rows no item gives, an off-hand row and reach** ([ADR 0110](docs/adr/0110-a-kind-declares-attacks-no-item-gives-an-off-hand-row-and-a-melee-reach.md),
  2026-10-12): `attacks.innate` (5e: Unarmed Strike, Strength or with a Martial Arts die the better of Strength and
  Dexterity, plus proficiency; the Martial Arts or Unarmed Fighting die, else a flat "1"), `attacks.variants` (5e:
  "off-hand" on an equipped Light melee weapon while both hands hold one; no positive ability modifier unless either
  Two-Weapon Fighting is held) and `attacks.reach` (5e: "10 ft" with Reach, else "5 ft", for a weapon writing no range;
  the 2014 Reach weapons write their own). `inventory.tagSupports` makes a slot publish support tags; nothing in content
  asks a slot for one. `DerivedAttack`/`SheetAttack` `instanceId` and `elementId` are optional (an innate row has
  neither) and an alternative may carry its own `damageBonus`. Aurora records no unarmed row: the book is the referee.
  Driven in the browser build (a new Monk with two Shortswords and a 2024 Pike); not the Tauri window or the phone.
- **A cantrip is an attack row** ([ADR 0111](docs/adr/0111-a-cantrip-is-an-attack-row-its-roll-read-from-content-or-chosen-by-the-user.md),
  2026-10-13). Things to know before touching it:
  - **Measured first** (`tools/verify/src/cantrip-attacks.test.ts`): 145 cantrips, 20 tagged `Spell Attack` and 31
    `Spell Saving Throw`; none states its die, type or save ability as a rule (only prose; `keywords` are search words
    and are not read); 53 of 129 cantrip selects attach to no casting block (High Elf, Magic Initiate, feats).
  - **`attacks.spells`** (system format, optional): `types`, `setter`/`values` (5e: `level` "0"), `attack` and `save`
    (a tag and the block stat, `{name}` the block's name), `count` (5e: a table on `level`, 1/2/3/4 at 1/5/11/17), `dice`
    and `damageType` (a setter content may state, as a weapon's: an Incudo-format spell's `dN` scales, any other shape
    is written as it is), `range`, and what the user is offered: `sides`, `damageTypes`, `abilities`.
  - **`Character.spellAttacks`** (by spell id: `sides` one, two, or `[]` for "rolls nothing"; `damageType`; `ability`;
    `block`), **format 13** only when recorded (`setSpellAttack`, core); the validator refuses it below 13. An input:
    the maintainer's calls are that a die nothing states is the user's, a save's ability is the user's, and a cantrip no
    block holds is cast as a class the user names (as ADR 0097's additions).
  - **The engine** (`spellCasting` in `engine.ts`) finds the block holding each held element over *every* declared block
    (a grant or a recorded pick with a `spellcasting`, or an addition's block), and `deriveAttacks` appends a row per
    tagged cantrip after the bag's and the innate rows: `DerivedAttack.spell` (`kind`, `block`, `given`, `dc`,
    `ability`, `dice`: content | chosen | unchosen, `orDice`). No damage bonus is added.
  - **Words** (`sheetSpellAttack`, `sheet.ts`): "Fire Bolt: +6, 2d10 fire (range 120 feet)", "Sacred Flame: DC 13
    Dexterity, 1d8 radiant", "1d8 or 1d12 necrotic", "no damage", and "—" with `SheetAttack.notes` for what is not yet
    chosen, so every renderer (pane, phone, Markdown, form rows) needs no change. The editor's state is
    `packages/ui/src/spell-attacks.ts` (`BuilderState.spellAttacks`, the builder's `setSpellAttack` returns a refusal);
    desktop `panes/SpellAttacks.tsx` (Build, after Inventory), phone `SpellAttacksView` in `BuildExtras.tsx`.
  - **Only regular scaling**, the maintainer's call: Eldritch Blast reads as more dice, Magic Stone scales. Driven in the
    browser build (a Wizard 5's Fire Bolt and Acid Splash); not the Tauri window or the phone.
- **A line under each of a held creature's actions** ([ADR 0112](docs/adr/0112-a-sheet-section-may-write-a-note-under-each-element-it-lists.md),
  2026-10-13): a sheet section may declare `elementNote: { text, showWhen? }`, its `{{stat}}` placeholders filled as a
  sheet line's (ADR 0076); `SheetListedElement.note`, kept apart from content's `text`, written as its own line by the
  desktop's `ListedElement`, the phone's `Listed` and the Markdown. 5e's held creature's Actions section: "If it is an
  attack, its holder adds {{companion:attack}} to the attack roll and {{companion:damage}} to the damage." when
  `companion:attack` is not zero. Measured: 196 Companion Actions, none tagged an attack, and only the 2014 Ranger's
  Companion writes `companion:attack`/`damage`. Driven in the browser build.
- **A 2014 Druid's Wild Shape tier** ([ADR 0113](docs/adr/0113-a-2014-druid-s-wild-shape-tier-is-a-table-in-the-system-definition.md),
  2026-10-13): no engine change. 5e's `pc` declares `wild shape:tier` (unshown, 1 while the 2014 Wild Shape is held),
  `wild shape:max cr` and `wild shape:limits` as gated literal contributions by `[level:druid:N]` (a literal contribution
  is text), the Moon's rating read from content's `circle forms:cr` while Circle Forms is held; a Wild Shape section after
  Senses with `showWhen: "wild shape:tier"`. The 2024 Druid needs nothing: its sheet line states its tier per level.
  `tools/verify/src/wild-shape.test.ts`.
- **Not done:** ~~unarmed strikes and martial arts~~, ~~cantrips as rows~~ (ADR 0111; levelled spells after 1.0), ~~two-weapon
  fighting~~, Dueling (commented out upstream), ~~reach as a distance~~ (ADR 0110), the inventory naming an adorned item by `name-format`.
  Driven in the browser build with no source (two packed samples and a built Beast Master); not the Tauri window, the phone,
  the print dialog or a filled form.

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
after `baseStats`, `advancement` and `generation` each stayed at 1. Readers accept both. *(Readers accept 3 too since
ADR 0060, which only a character with no `progress` or with `removedGrants` is written at, 4 since ADR 0063,
which only a character with `customFeatures` is, 5 since ADR 0064, which only one with `additions` is, 6 since ADR 0065, which only one with a typed
custom feature is, and 7 since ADR 0068, which only one with `references` is.)* Three
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
  *(Since ADR 0057 they read the creature's own `companion:ac` rule: an NPC with no creature reads 0, not 10. Since
  ADR 0059 that rule is where `ac` starts, `default: 0` beneath it, and a value the DM types replaces it.)*

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
