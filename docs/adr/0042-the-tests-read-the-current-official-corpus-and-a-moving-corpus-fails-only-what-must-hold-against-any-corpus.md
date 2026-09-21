# 0042 — The tests read the current official corpus, and a moving corpus fails only what must hold against any corpus

**Status:** Accepted · 2026-09-21 · amends [0039](./0039-the-cli-is-removed-and-what-it-measured-becomes-tests.md)
(its "the local default is the maintainer's install" and its exact-figures test); builds on
[0005](./0005-aurora-import.md), [0008](./0008-aurora-compatibility-frozen.md),
[0012](./0012-self-contained-saves.md) and [0041](./0041-aurora-records-a-slot-row-per-block-and-the-shared-caster-level-once.md)

## Context

Every real-content test in `tools/verify` used to read an Aurora install: a private copy of the content
that Aurora's own updater rewrites while the app is open (CLAUDE.md records one such rewrite, seven files
and four elements, that moved an exact-count test). Three things followed from it that nobody chose:

- **The tests ran on one machine.** CI checked the official repository out and ran one file against it;
  every other real-content test skipped there, and a skipped test is a green one.
- **"Works with the content" meant "works with this person's copy of it".** Nobody else could reproduce
  the number, and the copy moved without a commit.
- **The `repository` layout, which CI uses, had never been seen to run against a real clone.** ADR 0039
  exercised it on a checkout layout *rebuilt from* the install, and said so.

The maintainer's direction is that every real-content test, in CI and locally, runs against the **current**
AuroraLegacy/elements, so that a green run means "works with today's official content". That is a change
of what green means, and it has a cost this ADR has to face: **the saves are frozen and the corpus is not.**
Each save's `<sum>` was written against the content of the day. Upstream adds a feature, re-gates a level,
renames an id, and the table of differences between Aurora's frozen answer and today's derivation moves
without anything here changing. Per-save pins on those counts would turn red on churn, and a check that
turns red on things nobody here did is a check that gets its numbers updated without being read.

## Decision

### 1. The corpus is a checkout of the official repository, in the same place everywhere

- **`.corpus/` at the repository root, gitignored.** `npm run corpus:sync` (a Node script, not a command
  line: no flags, ADR 0039) clones `AuroraLegacy/elements` shallowly, or fast-forwards an existing checkout,
  and prints the commit it ends at. It refuses to touch a checkout with local changes (it is a cache, not a
  place to work) and clones with `core.autocrlf=false`, so the corpus is the bytes upstream wrote on every
  platform. It warns about an existing checkout that converts line endings.
- **A run reads, in order:** the environment if it names a corpus (`INCUDO_AURORA_INDEX`), else `.corpus/`,
  else nothing, and then every test that needs it skips and says `npm run corpus:sync`. This is
  `resolveCorpus`, a pure function with its own tests. No default is an absolute path.
- **The fail-versus-skip rule is unchanged and now covers both cases.** Something the environment names that
  is not there **fails**. An absent default skips, because a fresh clone has not synced yet. CI *names* its
  corpus (`INCUDO_AURORA_INDEX: .corpus/AuroraLegacy.index`, layout `repository`) so that a checkout that did
  not happen is a failure and not a skip.
- **CI.** The `aurora-corpus` job checks the repository out into `.corpus` **with no `ref:`**, so it is the
  default branch's current head on every run (a guard test fails if someone pins it), prints the commit, and
  runs `npm test`: the whole suite, not one file. A **daily schedule** (and `workflow_dispatch`) runs it while
  this repository is quiet, because an upstream change is exactly what nothing here would otherwise notice.
  The `build` job stays as it was and does not run on the schedule. The job's log names the corpus commit, and
  so do the corpus test's and the oracle's diagnostics (`corpusProvenance`: a commit, never a path).
- **The saves are `tools/verify/fixtures/saves/`**, repository-relative. The install is no longer read by
  anything, and the saves folder is not inferred from its layout. Until the sample saves of
  docs/SAMPLE-SAVES.md are in it, tests that need a save skip and say so. `INCUDO_AURORA_SAVES` still names
  another folder, **transitionally**, and goes when the samples land. `INCUDO_REQUIRE_SAVES=1`, which CI will
  set once the samples are committed, makes an empty folder a failure: a checkout that lost the folder (an
  ignore rule, a bad merge) must not go green on nothing. `.gitignore` keeps ignoring `*.dnd5e` until the
  guard that checks a sample is generic exists, so a stray personal save cannot be committed by accident.

### 2. What fails, and what is only reported

The oracle's per-save pins are retired as gates. **A count is not a gate when the thing counted moves for
reasons outside the repository.** What fails is what holds against *any* corpus, per save, in
`oracleViolations`:

1. It imports without an error.
2. **0 `stat-mismatch` and 0 `spell-missing`.** A number both sides computed, differently; a spell Aurora
   listed that Incudo did not derive.
3. **Every `element-missing` is an Aurora-app marker.** The allowlist is `ID_INTERNAL_MULTICLASS_LEVEL_N`,
   the marker naming the character level a second class began at, which no content file declares and no rule
   depends on. It is one pattern, a test asserts that it is one, and adding to it is a decision.
4. **Nothing Aurora recorded went uncompared.** Every spellcasting block has its slot row, save DC and attack
   bonus compared, and the shared caster level is compared exactly when the save records one. The rows are
   *measured* by breaking each (ADR 0039), and the relation "rows compared equals blocks recorded" depends on
   the save and the engine and on nothing upstream does.
5. Alongside the oracle: **a builder rebuild equals the import, a save opens with zero sources, and the
   corpus budgets hold.** These were never pins on a corpus's contents, and are unchanged.

Everything else, `element-extra`, `content-missing`, `not-modelled` and the count of problems in a
derivation, is **printed per save and fails nothing.** The table each save had when it was last understood is
kept in the test as a *recorded* table (confirmed at the commit named beside it), and a difference from it is
a `MOVED` line: "was 4 element-extra, now 6". Updating a recorded table is not a decision and needs no
reason in a commit; reading a `MOVED` line is the point of printing it.

### What a regression looks like, and what churn looks like

| signal | an engine regression looks like | upstream churn looks like | |
|---|---|---|---|
| import error | the parser or importer broke | upstream shipped malformed XML (`corpus.test.ts` errors too) | **fails** |
| `stat-mismatch` / `spell-missing` | wrong arithmetic; a list stopped resolving | upstream re-tabled a class or moved a spell, so Aurora's frozen number is stale: re-save the sample | **fails** |
| `element-missing`, not a marker | a grant stopped firing: the canary for the reachability bugs CLAUDE.md records (the cache that dropped `<append>`) | upstream re-gated a feature or moved its level: re-save the sample | **fails** |
| rows compared ≠ blocks | a comparison silently stopped | nothing | **fails** |
| corpus budgets | the loader regressed | a new dangling grant or warning upstream: look, then edit `ci.yml` | **fails** |
| `element-extra` count | a gate that should hold stopped holding | content added after the save was written (52 of the 55 across the first nine saves) | reported |
| `content-missing` | | an element removed or renamed upstream | reported |
| `not-modelled` | | Aurora-app behaviour Incudo does not model | reported |

`element-missing` outside the allowlist fails even though upstream can cause it, and that is a judgement,
not a derivation. `compareWithAurora` already sends an element upstream *removed* to `content-missing` by
walking the save's own tree to an absent ancestor, so what is left is an element that exists and was not
granted. That is the one place a real regression shows up as *fewer* things, which counts do not catch, and a
false alarm there costs ten minutes in Aurora (update, reopen, re-save the sample) where a missed one costs
a release that writes short saves.

### 3. What that costs, and the only thing that gets it back

**An engine change that over-grants a few elements used to fail a pin. It now fails nothing here.** It shows
up as a `MOVED` line, and only for someone who reads it. This was measured, not argued: with one extra
element added to every character's baseline in `systems/dnd5e/system.json`, the oracle stayed green and
printed `MOVED` on every save, which is exactly the loss.

The only thing that separates an engine change from an upstream change is the same corpus and two versions of
the engine, so the test can do that without a second run of anything by itself. `INCUDO_ORACLE_SNAPSHOT=<file>`
writes every save's differences; `INCUDO_ORACLE_BASELINE=<file>` **fails on any difference** from a snapshot
written earlier. Snapshot on the base, baseline on the change, same `.corpus/` commit. With the same
perturbation the baseline run fails and names `now: element-extra:ID_SIZE_COLOSSAL`. **This is manual today.**
Running it on every pull request (a second worktree at the base, one snapshot each side) is the right
follow-up and is not built.

### 4. The `aurora-folder` layout stays, demoted

**Nothing committed runs it against a real install any more:** CI and a default run read a checkout.
It is not deleted because it is still the only way to point a run at an Aurora install, and because its option
(`resolveByName`) lives in `packages/content` and in `packages/aurora-import`, which is frozen (ADR 0008) and
where removing an option is not a bugfix. The risk of keeping an unexercised branch is bit-rot, so a small test
builds a download folder in a temp directory, the way Aurora's downloader writes one, loads it by name, and
asserts the same folder read as a checkout fails with a named error and never a fetch.

### 5. The budgets stay, and now move against a moving corpus

`ci.yml`'s four numbers (1 unresolved reference, 57 warnings, at least 740 files and 14,316 elements) are kept.
The first two are ceilings and can go red because **upstream** added a dangling grant or a warning: that is the
signal and the response is to look at what changed and then edit the number. The last two are floors against
"the checkout loaded nothing" and are deliberately a little *below* what the corpus holds (14,320 today), so an
upstream removal does not fail them.

## Consequences

- **CI can go red with no commit here.** The scheduled run exists to say so. A pull request can also go red
  because the corpus moved since its base was green, and the pull request's author did nothing. The response
  is the table above: read the corpus commit, `git -C .corpus log` what changed, decide regression or churn.
- **The maintainer's install is no longer part of any run.** A `.env.local` that names it still works
  (`INCUDO_AURORA_INDEX`, default layout `aurora-folder`), and nothing verifies that path any more.
- **CI runs every real-content test except the ones that need a save**, which skip until the samples exist.
  That is a visible hole and it is named here: the oracle, the builder rebuild and the library round trips over
  real saves still run only where saves are.
- **The figures in CLAUDE.md are a record of a moment**, the one at `c28ce6c`. ADRs that cite a per-save count
  cite a table of a frozen save against the content of its day.

## Alternatives considered

- **Pin the corpus to a commit and bump it on purpose.** Reproducible, and a pull request can never go red
  for someone else's reason. It would also make CI unable to do the one thing it is for: say that upstream
  moved. The hybrid (a pinned job for pull requests, an unpinned scheduled one) keeps both and costs a second
  job and a bump ritual. Rejected on the maintainer's direction that a green run means *today's* content, and
  revisitable if red-because-upstream turns out to be common.
- **Commit a converted copy of the content.** Never: the original content and any converted copy of it are not
  committed. The corpus comes from the official public repository.
- **Keep the per-save pins and update them when they move.** Rejected: that is the failure this ADR describes.
  An assertion that is updated without being understood is a comment.
- **Report everything and fail nothing.** Rejected: `stat-mismatch`, `spell-missing`, an unexplained
  `element-missing` and an uncompared row are exactly the signals that have caught real bugs (a negated stat
  read as a stat, a shared pool read as a per-block row, the third-caster marker in no track).
- **Fail on a pinned table only when the corpus is at the commit it was recorded at.** Exact where it can be,
  quiet otherwise. Rejected: the corpus moves daily, so it would be strict for one day per recording and the
  machinery would outlast its use.
- **Make `element-missing` a report too.** Rejected for the reason in the table: it is the canary for the bug
  class that counts do not see.
- **Delete `aurora-folder` now.** Rejected (decision 4).

## Evidence

Measured on 2026-09-21 against AuroraLegacy/elements at `c28ce6cd77ff` (committed 2026-09-19), a shallow clone
by `npm run corpus:sync` (about 27 s, 159 MB on disk).

- **The `repository` layout, on a real clone for the first time, loads it with no change to the loader:**
  740 files, **14,320 elements** (+229 generated), 0 errors, 57 warnings, 1 unresolved, 23 requirements that
  can never be met, 2,258 synthesized from inline text. A byte-exact checkout (`core.autocrlf=false`) and one
  whose line endings Git for Windows had converted gave the same figures and, per save, the same ten tables.
- **The whole suite: 691 tests, 0 failed, 0 skipped**, against that clone with the maintainer's ten personal
  saves supplied through the environment (kept out of every file). All ten per-save tables match the tables
  recorded before this change, so nothing had drifted at this commit.
- **Skip and fail, by running each:** no `.corpus/` skips with the message naming `corpus:sync`; an
  `INCUDO_AURORA_INDEX` pointing at nothing **fails**; an empty saves folder skips and says so.
- **Perturbed, so that green means something:**

| broken | result |
|---|---|
| the engine gives every character one extra baseline element | oracle **green**, a `MOVED` line on every save; with `INCUDO_ORACLE_BASELINE`, **fails** naming the element |
| the allowlist narrowed so the multiclass marker is not excused | fails on the two saves that carry it, naming the marker |
| the DC row family made to match nothing | fails: `0 dc row(s) compared for 1 spellcasting block(s)`, per save |
| the checkout pinned with a `ref:` in `ci.yml` | fails the guard test |
| the same download folder read as a checkout | one error naming the URL refused; never a fetch |

### What was not verified

- **The GitHub Actions run.** Nothing was pushed. The workflow's commands were run locally, but `actions/checkout`
  into `.corpus`, the `schedule` trigger (which only fires from the default branch) and the step summary have
  not executed.
- **A Linux runner.** Everything above ran on Windows. Paths go through `node:path`, but CI reads
  `.corpus/AuroraLegacy.index` relative to the working directory on Ubuntu, and that has not been seen.
- **macOS.**
- **A corpus that moved.** One commit was measured. What upstream churn does to the tables is the reasoning
  of the decision above plus the four-element drift CLAUDE.md records, not a series of observations.
- **`npm ci` from a clean checkout**, and the maintainer's own install through a `.env.local` after this change.
