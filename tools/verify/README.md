# tools/verify

The tests that check Incudo against the real world, and the Node adapters they stand on. **It ships
nothing and no package imports it.** It was `tools/incudo`, the CLI, until
[ADR 0039](../../docs/adr/0039-the-cli-is-removed-and-what-it-measured-becomes-tests.md).

`packages/*` may not read a disk or a network (docs/CODE-REUSE-POLICY.md), so anything that needs
the AuroraLegacy corpus, real Aurora saves, or a folder on disk is tested here.

Run everything with `npm test`. **The real-content tests read the current official repository:** run
`npm run corpus:sync` once (it clones AuroraLegacy/elements into `.corpus/`, gitignored, and prints the
commit) and again whenever you want today's content. Without `.corpus/` they skip and say so. CI checks
the same repository out into the same place, always at its head, and runs the whole suite daily too
([ADR 0042](../../docs/adr/0042-the-tests-read-the-current-official-corpus-and-a-moving-corpus-fails-only-what-must-hold-against-any-corpus.md)).

## What is here

| | |
|---|---|
| `corpus.ts`, `corpus.test.ts` | Loads a corpus offline and checks it against its budgets. `resolveCorpus` says which corpus a run reads. Baselines: CLAUDE.md. |
| `corpus-checkout.ts`, `corpus-sync.ts` | Where `.corpus/` is and which commit it is at; `npm run corpus:sync` is the script that fetches it. No flags: a script, not a command line. |
| `real-data.ts` | The one place that reads the environment: the corpus, the saves folder, and why a test is skipped. |
| `aurora-oracle.ts`, `aurora-oracle.test.ts` | Imports each real `.dnd5e`, derives it, and diffs it against the numbers Aurora wrote itself. **Fails the invariants that hold against any corpus** and reports the rest per save (ADR 0042). |
| `derived-summary.ts` | `summarize`: what "the same derived output" means for every test that compares two derivations. |
| `self-contained.test.ts`, `library.test.ts`, `save-copy.test.ts` | ADR 0012 and ADR 0027/0038 over real content and real saves: a save opens with zero sources. |
| `multiclass.test.ts`, `armour-class.test.ts`, `campaign-options.test.ts`, `ability-names.test.ts` | Oracles and perturbation for the 5e rules, which live here because every noun in them is 5e's. |
| `schemas.test.ts`, `user-systems.test.ts`, `workspace.test.ts` | The public formats, and the workspace invariants CLAUDE.md states. |
| `node-platform.ts`, `node-save.ts`, `node-system.ts`, `node-zip.ts` | Fetchers, storage, container reading and writing, schema and system loading — `node:fs` and `node:zlib` behind the ports the shells implement. |
| `fixtures/`, `fixture-character.ts`, `rebuild-fixtures.ts` | A small committed corpus and a golden `.incu`. `npm run fixtures:rebuild` regenerates the golden one after a format change. |

## Where the real data is

**No test names a machine.** With nothing configured a run reads two repository-relative places, and a
test whose data is not there skips and says how to get it:

- **The corpus:** `.corpus/`, made by `npm run corpus:sync`. `repository` layout, always offline.
- **The saves:** `tools/verify/fixtures/saves/`. Until the generic samples of docs/SAMPLE-SAVES.md are in it,
  the tests that need a save skip.

Configuration is for pointing somewhere else, and belongs in an untracked `.env.local` at the repository
root, which `npm test` reads (copy `.env.example`), or in your shell. CI sets some of it in
`.github/workflows/ci.yml`, which is also where a budget moves. **A value that names something that is not
there fails instead of skipping**, because a skipped test is a green one. Never commit a real value: it
names a person's machine, and version-control history is permanent.

| variable | meaning |
|---|---|
| `INCUDO_AURORA_INDEX` | Read this `AuroraLegacy.index` instead of `.corpus/`. CI sets it, so that a missing checkout is a failure and not a skip. **Once set, a missing file fails.** |
| `INCUDO_CORPUS_LAYOUT` | `aurora-folder` (the default when an index is named; an Aurora install, files resolved by name) or `repository` (a git checkout, files resolved by URL path). They are different layouts. |
| `INCUDO_CORPUS_ROOT` | `repository` only: the checkout's root. |
| `INCUDO_MAX_UNRESOLVED`, `INCUDO_MAX_WARNINGS` | Budgets: fail if the corpus has more. |
| `INCUDO_EXPECT_FILES`, `INCUDO_EXPECT_ELEMENTS` | Fail if fewer loaded — a corpus that did not check out loads nothing. |
| `INCUDO_AURORA_SAVES` | A folder of `.dnd5e` saves instead of `tools/verify/fixtures/saves/`. Transitional: it goes when the samples land. **Once set, a missing folder fails.** |
| `INCUDO_REQUIRE_SAVES=1` | An empty saves folder fails instead of skipping. CI sets it once the samples are committed. |
| `INCUDO_ORACLE_DETAIL=1` | Print every difference message the oracle finds, for chasing an `element-extra`. |
| `INCUDO_ORACLE_SNAPSHOT=<file>` | Write every save's differences to a file. |
| `INCUDO_ORACLE_BASELINE=<file>` | **Fail on any difference** from a snapshot written earlier. Snapshot on the base, baseline on your change, same `.corpus/` commit: only an engine change can move it. |

## Rules for this folder

- Nothing personal is printed, and nothing personal is committed. Saves are identified by a fingerprint
  of their bytes (the oracle) or by position, asserted on by counts and kinds, never by name or content;
  a test that needs one particular save finds it by what it is (a class split), not by what it is called.
- A test never asserts how many files a folder holds or where one sorts.
- A check that can be satisfied by loading nothing is a check that must also assert something was
  loaded.
- Do not add a command line. If a question needs asking often, it is a test.
