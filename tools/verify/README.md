# tools/verify

The tests that check Incudo against the real world, and the Node adapters they stand on. **It ships
nothing and no package imports it.** It was `tools/incudo`, the CLI, until
[ADR 0039](../../docs/adr/0039-the-cli-is-removed-and-what-it-measured-becomes-tests.md).

`packages/*` may not read a disk or a network (docs/CODE-REUSE-POLICY.md), so anything that needs
the 740-file AuroraLegacy corpus, the nine real Aurora saves, or a folder on disk is tested here.

Run everything with `npm test`. Real-corpus tests skip on a machine with no Aurora install and run
where there is one.

## What is here

| | |
|---|---|
| `corpus.ts`, `corpus.test.ts` | Loads a corpus offline and checks it against its budgets — the regression suite CI's `aurora-corpus` job runs. Baselines: CLAUDE.md. |
| `aurora-oracle.ts`, `aurora-oracle.test.ts` | Imports each real `.dnd5e`, derives it, and diffs it against the numbers Aurora wrote itself; pins the whole table and how many rows were compared. Local only: the saves are personal data. |
| `derived-summary.ts` | `summarize`: what "the same derived output" means for every test that compares two derivations. |
| `self-contained.test.ts`, `library.test.ts`, `save-copy.test.ts` | ADR 0012 and ADR 0027/0038 over real content and real saves: a save opens with zero sources. |
| `multiclass.test.ts`, `armour-class.test.ts`, `campaign-options.test.ts`, `ability-names.test.ts` | Oracles and perturbation for the 5e rules, which live here because every noun in them is 5e's. |
| `schemas.test.ts`, `user-systems.test.ts`, `workspace.test.ts` | The public formats, and the workspace invariants CLAUDE.md states. |
| `node-platform.ts`, `node-save.ts`, `node-system.ts`, `node-zip.ts` | Fetchers, storage, container reading and writing, schema and system loading — `node:fs` and `node:zlib` behind the ports the shells implement. |
| `fixtures/`, `fixture-character.ts`, `rebuild-fixtures.ts` | A small committed corpus and a golden `.incu`. `npm run fixtures:rebuild` regenerates the golden one after a format change. |

## Pointing the corpus tests somewhere

**No test names a machine.** Where the real data lives is configuration and there is no default: with
nothing set, the tests that need it skip. CI sets these in `.github/workflows/ci.yml`, and that file is
where a budget moves. Locally, put them in an untracked `.env.local` at the repository root, which
`npm test` reads (copy `.env.example`), or set them in your shell. Never commit a real path: it names a
person's machine, and version-control history is permanent.

A test that needs your saves cannot run in CI, because saves are personal data. Those tests say so in
their headers and are checks you run, not regression tests the pipeline can run for you.

| variable | meaning |
|---|---|
| `INCUDO_AURORA_INDEX` | The `AuroraLegacy.index` to read. **No default. Once set, a missing file fails** instead of skipping, because a skipped test is a green one. |
| `INCUDO_CORPUS_LAYOUT` | `aurora-folder` (default; an Aurora install, files resolved by name) or `repository` (a git checkout, files resolved by URL path). They are different layouts. |
| `INCUDO_CORPUS_ROOT` | `repository` only: the checkout's root. |
| `INCUDO_MAX_UNRESOLVED`, `INCUDO_MAX_WARNINGS` | Budgets: fail if the corpus has more. |
| `INCUDO_EXPECT_FILES`, `INCUDO_EXPECT_ELEMENTS` | Fail if fewer loaded — a corpus that did not check out loads nothing. |
| `INCUDO_AURORA_SAVES` | The folder of `.dnd5e` saves. Defaults, for an `aurora-folder` index, to the folder above `custom/`; a `repository` checkout has none. **Once set or inferred, a missing folder fails.** |
| `INCUDO_ORACLE_DETAIL=1` | Print every difference message the oracle finds, for chasing an `element-extra`. |

## Rules for this folder

- Nothing personal is printed, and nothing personal is committed. Saves are identified by a fingerprint
  of their bytes (the oracle) or by position, asserted on by counts and kinds, never by name or content;
  a test that needs one particular save finds it by what it is (a class split), not by what it is called.
- A test never asserts how many files a folder holds or where one sorts.
- A check that can be satisfied by loading nothing is a check that must also assert something was
  loaded.
- Do not add a command line. If a question needs asking often, it is a test.
