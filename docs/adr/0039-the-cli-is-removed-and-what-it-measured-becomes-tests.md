# 0039 — The CLI is removed, and what it measured becomes tests

**Status:** Accepted · 2026-09-20 · amends [0011](./0011-user-systems.md) (its CLI half); builds on
[0005](./0005-aurora-import.md), [0008](./0008-aurora-compatibility-frozen.md) and
[0012](./0012-self-contained-saves.md)

## Context

`tools/incudo` was written in Phase 0 as the engine's first consumer, before any UI existed, so that
no UI assumption could hide in the model. That job is done. The app is the product: a player builds
a character in the desktop window, not in a terminal, and a command line over the same engine is a
second surface to keep in step with it for people the project does not have. Every change to the
system format, the save format or the builder has meant touching a command nobody types.

It is not a folder to delete, because three different things live in it:

1. **The commands** — `validate | types | inspect | system | content | character | aurora`, the
   usage text, the flag parser. This is the CLI.
2. **The measurements.** CLAUDE.md's baselines are *read off* command output: 740 files, 14,316
   elements, 1 unresolved reference, 57 warnings from `validate`; the nine-save table from
   `aurora verify`. CI's `aurora-corpus` job is `incudo validate` with budgets. Deleting the
   command deletes the measurement, and nothing would say so.
3. **Test infrastructure.** Eleven test files (self-containment against the real corpus, the
   multiclass and armour-class oracles, the library and save-copy round trips over the nine saves,
   the schemas) and the Node adapters they stand on: `NodeFetcher`, `LocalMirrorFetcher`,
   `NodeStorage`, `node-zip`, the `node:fs` container reader, the golden fixture and its
   regenerator. None of it is a command, and all of it needs a place that says what it is.

Two facts found while reading the code shape the decision:

- **The classification logic was never in the CLI.** `compareWithAurora` and
  `summarizeDifferences` are in `packages/aurora-import`. What `aurora verify` added was
  orchestration (parse the save, import it, overlay the elements Aurora generated, load the
  system, derive, compare) and printing.
- **"8 spell slot rows, 8 save DC rows and 8 attack rows compared" was never printed by anything.**
  `AuroraComparison` reports differences; a row that is compared and agrees leaves no trace, and a
  row that is silently skipped leaves none either. The claim was established once, by hand, and
  written down. A test that pins `stat-mismatch: 0` cannot tell "compared and agrees" from "not
  compared" — which is exactly the reachability failure CLAUDE.md records several times, where the
  counts stayed green while the behaviour was gone.

## Decision

### 1. The corpus check is a test, configured by environment, with its budgets in `ci.yml`

`corpus.test.ts` loads an Aurora index through the same content layer the app uses and applies the
same four checks `validate` did: no errors, unresolved grants and warnings within a budget, and at
least this many files and elements. The functions behind it (`loadCorpus`, `analyseCorpus`,
`checkBudget`) are ordinary exports and are unit-tested on a small index the test writes, so the
budget logic itself is checked in every CI run and not only when a corpus is present.

- **Environment, not flags.** `INCUDO_AURORA_INDEX`, `INCUDO_CORPUS_LAYOUT` (`aurora-folder`, the
  default, or `repository`) and `INCUDO_CORPUS_ROOT` say where the corpus is;
  `INCUDO_MAX_UNRESOLVED`, `INCUDO_MAX_WARNINGS`, `INCUDO_EXPECT_FILES` and `INCUDO_EXPECT_ELEMENTS`
  are the budgets. `.github/workflows/ci.yml` sets all of them on the step that runs the file, so
  moving a number is still a deliberate edit to that file. `--aurora-folder` and `--local --root`
  become the two layouts, with the same meaning (docs/AURORA-FORMAT.md): they are different
  layouts and one must not be used for the other.
- **Skip when nothing is configured; fail when something is configured and absent.** Every other
  real-corpus test skips where the Aurora install is not on the machine, and this one does too *when
  it was not told where to look*. Once `INCUDO_AURORA_INDEX` is set, a missing index is a failure.
  This is the `--expect-files` argument again in a new form: a corpus that failed to check out
  loads nothing, and a test that skips on nothing passes. `node --test` reports a skip as green.
- **Offline is not optional.** The check is always offline: a miss in the mirror is a named error
  giving both the URL refused and the path checked, exactly as `--offline` was. There is no mode
  in which it quietly fetches.
- **The local defaults are the recorded baseline, and a guard keeps them honest.** With no
  environment the test uses the maintainer's install and the numbers in CLAUDE.md, so `npm test`
  measures the same thing CI does. Two copies of a number drift, so a test reads `ci.yml` and
  fails if its four budgets differ from the ones in the test.
- **Exact numbers are pinned only where the corpus cannot move.** CI reads upstream's `HEAD`, which
  moves, so CI gets budgets and only budgets. The maintainer's install is a frozen snapshot, so a
  second test there pins the exact figures — files, elements, generated (83 overlay + 146 derived),
  the 2,258 synthesized from inline text, unresolved, the 23 unmeetable requirements, warnings —
  because a budget only catches "worse" and the baselines are also a statement of what the loader
  should find. That test does not run in CI, and says so when it skips.

### 2. The nine-save oracle is a test, and the classification stays where it was

`aurora-oracle.test.ts` runs the differential check over every `.dnd5e` beside the install and
pins the result: 9 import, then the count of each difference kind (1 `element-missing`, 0
`spell-missing`, 0 `stat-mismatch`, 55 `element-extra`, 13 `content-missing`, 3 `not-modelled`) and
the one recorded problem in a derivation. The sequence between the file and the comparison moves to
`aurora-oracle.ts`, a plain function; `compareWithAurora` is untouched and `packages/aurora-import`
stays frozen (ADR 0008).

- **Rows compared are measured by perturbation.** For each of the three families (slot rows, save
  DC rows, attack rows) the test shifts every stat the system publishes for that family by one and
  counts the `stat-mismatch` differences that appear. A row that was never compared cannot
  mismatch, so the count *is* the number of rows compared, taken through the public API with none
  of `verify-character.ts`'s logic copied. The test pins 8, 8 and 8.
- **Nothing personal is asserted or printed.** Saves are identified by their position in the sorted
  folder listing, never by name; every assertion is on counts and kinds. A failure lists the
  differences that broke a pin as kind plus element id, and the messages behind them name content
  (elements, spells, stats) and never the character.
- **It cannot run in CI, and never could.** The saves are personal data and stay on the maintainer's
  machine. `aurora-corpus` in CI validated the corpus and never ran `aurora verify`; that does not
  change, and this ADR does not pretend it does. What changes is that the oracle is now part of
  `npm test` on the one machine that has the saves, instead of a command someone had to remember.
- **The output is a test report.** `verify` printed a counts block and up to thirty differences per
  file. The test emits the same per-kind counts as `t.diagnostic()` lines, which every `node:test`
  reporter shows, and `INCUDO_ORACLE_DETAIL=1` adds every difference message for someone chasing
  an extra. That is a debugging switch on a test, not a command; it exists because "why is there a
  56th extra" is the question this check is for and answering it should not need a new script.

### 3. The home is `tools/verify`, and it is `@incudo/verify`

Everything in item 3 of the context moves under one name that says what it is: the package that
checks the engine against the real world (the corpus, the nine saves, files on disk) and holds the
Node-side adapters that checking stands on. It ships nothing, imports nothing that ships, and is
`"private": true` like every package. It stays under `tools/` so the workspace glob, the `npm test`
glob, `tsconfig.base.json`'s relative path and `repoRoot()`'s three-levels-up all stay true; the
rename is its own commit because it touches workspaces, tsconfig references, imports, CI and the
lockfile, and a commit that does that and something else is one that cannot be reverted cleanly.

`tools/verify/README.md` states the two rules that make the folder make sense: what is here may read
a disk and a network, and nothing outside it may import from it.

### 4. What goes, and what stands in for each command

| was | now |
|---|---|
| `validate <index> [budgets]` | `corpus.test.ts` (item 1) |
| `aurora verify <save> --index …` | `aurora-oracle.test.ts` (item 2) |
| `character verify` | `self-contained.test.ts`, which already derived with and without sources and demanded identical output; `accountedFor`, the escape hatch that only this command called, goes with it |
| `character show <file>` | open the file in the app; `summarize` (below) is what tests print and compare |
| `character new / choose / set` | the app; `CharacterBuilder` in tests |
| `character pack / unpack` | any zip tool: a `.incu` is a plain zip (ADR 0012), and the library scan still reads the unpacked folder form |
| `aurora import` | *Import from Aurora…* in the app, and `importAuroraSavesIntoLibrary`, which `library.test.ts` drives over the nine saves |
| `aurora inspect` | nothing. It counted the parts of one save and no test or document depended on it |
| `system validate` | *Add a system…* in the app, through `UserSystemStore` and the same `validateGameSystem`; `schemas.test.ts` and `user-systems.test.ts` |
| `types`, `inspect <id>`, `content bundle`, `content show` | nothing. Read a corpus in a test if you need to look. `packContentBundle` and `readContentBundle` stay in core, unchanged |
| `system new` (Phase 7) | scaffolding belongs in the app's system flow; ROADMAP Phase 7 says so |

`renderSheetSection` is shared with `SheetPane` and stays in `packages/core`. So does every
function the commands called: the CLI removal deletes callers, not engine.

### 5. `summarize` stays, and means the same thing

`summarize` in `character-commands.ts` is the definition of *derived output* that
`self-contained.test.ts`, `library.test.ts`, `save-copy.test.ts` and `multiclass.test.ts` compare:
sorted elements, stats as text or value, pending choices, problems, and **not** candidate lists,
which depend on what content is loaded (ADR 0012). It moves unchanged to `derived-summary.ts` in
the same package, with the comment that says why candidates are excluded. It is a test's definition
of "the same output", not product code, and that is why it lives beside the tests and not in a
package an app could import.

### 6. Instructions that named a command are rewritten; accepted ADRs keep their record

README, CONTRIBUTING, AGENTS, `systems/README.md`, `apps/desktop/README.md`, CLAUDE.md's Commands
and Baselines sections and the how-to parts of `docs/` stop telling anyone to type a command. An
accepted ADR, and evidence dated to a run, keep saying what was run at the time, because that is
what they are for; the table above translates them. Comments in code that name a command are
corrected, because a comment is read as a description of now.

## Consequences

- **A person can no longer validate a third-party index, look up one element, or bundle a corpus
  from a terminal without writing code.** Nothing in the project depended on it, and the in-app
  equivalents are Phase 7 (validation with errors a non-programmer can act on) and Phase 8
  (authoring), where they belong. This is a real loss for someone hand-maintaining a content
  repository, and it is the price of one surface instead of two.
- **CLAUDE.md's baselines are now asserted, not read off a screen.** Changing one is an edit to a
  test or to `ci.yml`, and the diff says which.
- **The oracle's "rows compared" guarantee is new.** It was a claim in prose; it is now a number
  that goes red if a row silently stops being compared.
- **Nothing published changes.** No format moves, no package is versioned, nothing was ever on npm.
  The `generator` string the CLI wrote (`incudo-cli`) disappears from new files; readers ignore it.
- **CI's shape changes by one line.** `aurora-corpus` runs `node --test` on one file with the same
  numbers as environment instead of flags. Before anything was removed, both were run against the
  same corpus and their outputs compared; see the evidence below.

## Alternatives considered

- **Keep a tiny dev-only CLI: `validate` and `aurora verify`, nothing else.** The most tempting
  option, because it is the smallest diff and every current command line keeps working. Rejected.
  It keeps the parts that cost something — a flag parser, usage text, exit-code conventions,
  a place for CLAUDE.md to tell the next agent to type something — and drops only the parts that
  cost nothing. The measurement it preserves is worse than a test's: it prints a table for a person
  to read, where a test asserts it. And "dev-only" does not last; a command that CI runs is a
  command someone will extend.
- **Leave the CLI in place and stop maintaining it.** A frozen program that still has to compile
  against an engine that keeps changing is not frozen. It stops working silently the first time
  someone changes a signature, and nobody notices because nobody runs it.
- **A `scripts/corpus.mjs` with flags.** A CLI with fewer subcommands and no tests behind it.
- **Budgets in a JSON file next to the test.** Neater to read and it would remove the duplication
  guard. Rejected because the roadmap item, and CLAUDE.md before it, put the budgets in `ci.yml` so
  that moving one is visible in the file that decides whether the build passes, and because a JSON
  file the test reads and CI does not is a file CI's own log never mentions.
- **Put the verify orchestration in `packages/aurora-import`.** It would make it reusable, but the
  package is frozen, and the step that loads a system definition from disk is filesystem code the
  package must never contain. The one caller is a test.
- **Report rows-compared from `compareWithAurora`.** The honest place for the number, and a change
  to a frozen package to add a field whose only reader is one test. Perturbation gets the same
  number through the existing public surface.
- **A different home.** `tests/` at the root: nearly right, but it moves the package one level up,
  and every relative path in the folder (`repoRoot()`, the tsconfig extends, the test glob) assumes
  three levels. `tools/oracle`: the corpus check is not an oracle, it is a budget. Keeping
  `tools/incudo`: the name is the CLI's, and a folder named for something that no longer exists
  is how the next agent goes looking for it. `packages/…`: it would suggest the Node adapters are
  part of the product; the apps have their own platform files and never import these.
- **Make the corpus test unconditional.** It would fail on every machine without the corpus,
  including CI's `build` job. Skip-when-unconfigured, fail-when-configured is the smallest rule that
  does not let a failed checkout go green.
