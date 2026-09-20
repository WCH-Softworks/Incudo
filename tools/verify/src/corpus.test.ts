/**
 * The corpus regression suite (ADR 0039).
 *
 * CLAUDE.md's baselines — 740 files, 14,316 elements, 1 unresolved reference, 57 warnings — used
 * to be read off `incudo validate`, and CI's `aurora-corpus` job ran that command with budgets.
 * This file is both. It has three layers, and only the last needs a corpus:
 *
 *  1. The budget logic and the environment it is configured through, on inputs written here, so
 *     it is checked on every machine and in every CI job.
 *  2. A small corpus written to a temp folder and loaded through the same loader, so "a grant to
 *     nothing is counted, a requirement to nothing is reported and not budgeted, and a miss in
 *     the mirror is an error rather than a fetch" are each asserted, not remembered.
 *  3. The real thing: the budgets against a real AuroraLegacy, and exact figures against the
 *     maintainer's frozen install.
 *
 * Where the corpus is comes from the environment (see `corpusFromEnvironment`). Left unset, a
 * machine without an Aurora install skips the third layer. Set, a missing index **fails**: a
 * skipped test is a green one, and a checkout that did not happen loads nothing.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { auroraGeneratedElements } from '@incudo/aurora-import';

import {
  BUDGET_VARIABLE_NAMES,
  RECORDED_BUDGET,
  analyseCorpus,
  budgetFromEnvironment,
  checkBudget,
  corpusFromEnvironment,
  describeCorpus,
  loadCorpus,
  type CorpusAnalysis,
  type CorpusBudget,
  type LoadedCorpus,
} from './corpus.ts';
import { repoRoot } from './node-system.ts';

// --- 1. the budget, and the environment ------------------------------------

function analysis(patch: Partial<CorpusAnalysis> = {}): CorpusAnalysis {
  return {
    files: 740,
    elements: 14316,
    generated: 229,
    size: 14541,
    synthesizedFromText: 2258,
    errors: [],
    warnings: new Array(57).fill({ level: 'warning', message: 'w' }),
    unresolved: ['ID_ONE'],
    unmetRequirements: [],
    ...patch,
  };
}

test('a corpus exactly at its budget passes, and better than its budget passes too', () => {
  assert.deepEqual(checkBudget(analysis(), RECORDED_BUDGET), []);
  // The day upstream fixes the typo the unresolved count reads 0, and that must not fail.
  assert.deepEqual(checkBudget(analysis({ unresolved: [] }), RECORDED_BUDGET), []);
});

test('each of the four budgets fails on its own, and names itself', () => {
  const failing: Array<[Partial<CorpusAnalysis>, RegExp]> = [
    [{ unresolved: ['ID_ONE', 'ID_TWO'] }, /2 unresolved references, budget 1\. 1 more than expected/],
    [
      { warnings: new Array(58).fill({ level: 'warning', message: 'w' }) },
      /58 warnings, budget 57/,
    ],
    [{ files: 739 }, /only 739 files loaded, expected at least 740/],
    [{ elements: 14315 }, /only 14315 elements loaded, expected at least 14316/],
  ];
  for (const [patch, expected] of failing) {
    const failures = checkBudget(analysis(patch), RECORDED_BUDGET);
    assert.equal(failures.length, 1, JSON.stringify(patch));
    assert.match(failures[0]!, expected);
  }
});

test('any error fails, whatever the budgets say', () => {
  const failures = checkBudget(
    analysis({ errors: [{ level: 'error', message: 'bad xml' }] }),
    { maxUnresolved: Infinity, maxWarnings: Infinity, expectFiles: 0, expectElements: 0 },
  );
  assert.equal(failures.length, 1);
  assert.match(failures[0]!, /never a baseline/);
});

test('a corpus that loaded nothing does not pass on having nothing wrong with it', () => {
  // The reason --expect-files and --expect-elements exist: an empty corpus has no unresolved
  // references and no warnings, so the two budgets above them wave it through.
  const empty = analysis({ files: 0, elements: 0, generated: 0, size: 0, warnings: [], unresolved: [] });
  const failures = checkBudget(empty, RECORDED_BUDGET);
  assert.equal(failures.length, 2);
  assert.ok(failures.some((f) => /0 files loaded/.test(f)));
  assert.ok(failures.some((f) => /0 elements loaded/.test(f)));
});

test('budgets come from the environment, fall back to the recorded ones, and refuse nonsense', () => {
  assert.deepEqual(budgetFromEnvironment({}), RECORDED_BUDGET);
  assert.deepEqual(
    budgetFromEnvironment({
      INCUDO_MAX_UNRESOLVED: '0',
      INCUDO_MAX_WARNINGS: '3',
      INCUDO_EXPECT_FILES: '10',
      INCUDO_EXPECT_ELEMENTS: '20',
    }),
    { maxUnresolved: 0, maxWarnings: 3, expectFiles: 10, expectElements: 20 },
  );
  // One variable set leaves the other three alone.
  assert.deepEqual(budgetFromEnvironment({ INCUDO_MAX_WARNINGS: '58' }), {
    ...RECORDED_BUDGET,
    maxWarnings: 58,
  });

  // A typo in ci.yml must stop the job, not quietly become 0 or NaN — NaN compares false with
  // everything, so a NaN budget would let anything through.
  for (const bad of ['', ' ', 'many', '-1', 'NaN']) {
    assert.throws(() => budgetFromEnvironment({ INCUDO_MAX_UNRESOLVED: bad }), /non-negative number/);
  }
});

test('the corpus location is configured only when someone said where it is', () => {
  const unset = corpusFromEnvironment({});
  assert.equal(unset.configured, false);
  assert.equal(unset.location.layout, 'aurora-folder');

  const ci = corpusFromEnvironment({
    INCUDO_AURORA_INDEX: '.corpus/AuroraLegacy.index',
    INCUDO_CORPUS_LAYOUT: 'repository',
    INCUDO_CORPUS_ROOT: '.corpus',
  });
  assert.equal(ci.configured, true);
  assert.deepEqual(ci.location, {
    index: '.corpus/AuroraLegacy.index',
    layout: 'repository',
    root: '.corpus',
  });

  assert.throws(() => corpusFromEnvironment({ INCUDO_CORPUS_LAYOUT: 'mirror' }), /one of/);
  // The two layouts are not interchangeable, and a root on an install is the way to mix them up.
  assert.throws(() => corpusFromEnvironment({ INCUDO_CORPUS_ROOT: '.corpus' }), /repository/);
});

test('ci.yml states the same budgets this file falls back to, and runs this file', async () => {
  // Two copies of a number drift. CI's copy is the one that decides whether a build passes, and
  // this one is what `npm test` measures locally; they may not disagree.
  const workflow = await readFile(join(repoRoot(), '.github', 'workflows', 'ci.yml'), 'utf8');
  const expected: Record<string, number> = {
    INCUDO_MAX_UNRESOLVED: RECORDED_BUDGET.maxUnresolved,
    INCUDO_MAX_WARNINGS: RECORDED_BUDGET.maxWarnings,
    INCUDO_EXPECT_FILES: RECORDED_BUDGET.expectFiles,
    INCUDO_EXPECT_ELEMENTS: RECORDED_BUDGET.expectElements,
  };

  assert.deepEqual([...BUDGET_VARIABLE_NAMES].sort(), Object.keys(expected).sort());
  for (const [name, value] of Object.entries(expected)) {
    const found = [...workflow.matchAll(new RegExp(`^\\s*${name}:\\s*(\\S+)\\s*$`, 'gm'))];
    assert.equal(found.length, 1, `ci.yml should set ${name} exactly once`);
    assert.equal(Number(found[0]![1]), value, `ci.yml's ${name} differs from RECORDED_BUDGET`);
  }

  assert.match(workflow, /^\s*INCUDO_AURORA_INDEX:\s*\S+/m, 'ci.yml points the check at the checkout');
  assert.match(workflow, /^\s*INCUDO_CORPUS_LAYOUT:\s*repository\s*$/m);
  assert.match(workflow, /corpus\.test\.ts/, 'ci.yml no longer runs the corpus check');
  assert.doesNotMatch(workflow, /npm run incudo/, 'the CLI is gone (ADR 0039)');
});

// --- 2. a small corpus, through the real loader ----------------------------

const RAW = 'https://raw.githubusercontent.com/example/mini/master';

/**
 * A repository-layout checkout with exactly one of everything the check distinguishes: a grant
 * to nothing, a requirement naming nothing, a grant with no id, and an id declared twice.
 */
async function miniCorpus(dir: string, options: { missingFile?: boolean } = {}): Promise<string> {
  const files = [`<file name="a.xml" url="${RAW}/a.xml" />`, `<file name="b.xml" url="${RAW}/b.xml" />`];
  if (options.missingFile) files.push(`<file name="gone.xml" url="${RAW}/gone.xml" />`);

  await writeFile(
    join(dir, 'Mini.index'),
    `<index><info><name>Mini</name><update version="1.0.0" /></info><files>${files.join('')}</files></index>`,
  );
  await writeFile(
    join(dir, 'a.xml'),
    `<elements><info><name>A</name><update version="1" /></info>
      <element name="One" type="Thing" source="Mini" id="ID_ONE"><rules>
        <grant type="Thing" id="ID_DECLARED_NOWHERE" />
        <grant type="Thing" id="ID_TWO" requirements="ID_NEVER_DECLARED" />
        <grant type="Thing" />
      </rules></element>
      <element name="Two" type="Thing" source="Mini" id="ID_TWO" />
    </elements>`,
  );
  await writeFile(
    join(dir, 'b.xml'),
    `<elements><info><name>B</name><update version="1" /></info>
      <element name="Two again" type="Thing" source="Mini" id="ID_TWO" />
    </elements>`,
  );
  return join(dir, 'Mini.index');
}

async function withMini<T>(
  options: { missingFile?: boolean },
  body: (corpus: LoadedCorpus) => Promise<T>,
): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'incudo-corpus-'));
  try {
    const index = await miniCorpus(dir, options);
    return await body(await loadCorpus({ index, layout: 'repository', root: dir }));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('a grant to nothing is budgeted; a requirement naming nothing is reported and is not', async () => {
  await withMini({}, async (corpus) => {
    const found = analyseCorpus(corpus);

    assert.equal(found.files, 2);
    assert.equal(found.elements, 3, 'two in one file, one in the other');
    assert.deepEqual(found.errors, []);
    // The grant with no id, and the id declared twice.
    assert.equal(found.warnings.length, 2);
    assert.equal(found.generated, auroraGeneratedElements().length, 'an Aurora source gets the overlay');

    // "Includes", not "equals": the overlay Aurora sources get names languages that only real
    // content declares, so a small corpus has a few dangling references that are not its own.
    assert.ok(found.unresolved.includes('ID_DECLARED_NOWHERE'), 'a grant to nothing is unresolved');
    assert.ok(found.unmetRequirements.includes('ID_NEVER_DECLARED'), 'a requirement to nothing is reported');
    assert.ok(
      !found.unresolved.includes('ID_NEVER_DECLARED'),
      'and is not counted with the grants — that is the whole point of keeping the two apart',
    );

    const within: CorpusBudget = {
      maxUnresolved: found.unresolved.length,
      maxWarnings: 2,
      expectFiles: 2,
      expectElements: 3,
    };
    assert.deepEqual(checkBudget(found, within), []);

    // Perturbation, kept: each budget one notch tighter must fail, or a green run means nothing.
    assert.equal(checkBudget(found, { ...within, maxUnresolved: within.maxUnresolved - 1 }).length, 1);
    assert.equal(checkBudget(found, { ...within, maxWarnings: 1 }).length, 1);
    assert.equal(checkBudget(found, { ...within, expectFiles: 3 }).length, 1);
    assert.equal(checkBudget(found, { ...within, expectElements: 4 }).length, 1);

    const report = describeCorpus(found).join('\n');
    assert.match(report, /MISSING {2}ID_DECLARED_NOWHERE/);
    assert.match(report, /UNMET-REQ {2}ID_NEVER_DECLARED/);
  });
});

test('a file the mirror does not have is an error naming both places, never a fetch', async () => {
  await withMini({ missingFile: true }, async (corpus) => {
    const found = analyseCorpus(corpus);

    assert.equal(found.files, 2, 'the two that exist still load');
    assert.equal(found.errors.length, 1);
    const message = found.errors[0]!.message;
    assert.match(message, /refused to fetch https:\/\/raw\.githubusercontent\.com\/example\/mini\/master\/gone\.xml/);
    assert.match(message, /the mirror has no .*gone\.xml/);
    assert.equal(checkBudget(found, { maxUnresolved: 9, maxWarnings: 9, expectFiles: 0, expectElements: 0 }).length, 1);
  });
});

// --- 3. the real corpus ----------------------------------------------------

const { location, configured } = corpusFromEnvironment(process.env);
const present = existsSync(location.index);
const missing =
  `INCUDO_AURORA_INDEX is set to ${location.index}, which does not exist. A corpus that did not ` +
  `check out loads nothing, and nothing has no unresolved references — so this fails instead of skipping.`;

let loaded: Promise<LoadedCorpus> | undefined;
const corpus = (): Promise<LoadedCorpus> => (loaded ??= loadCorpus(location));

test(
  'the Aurora corpus stays within its budget',
  { skip: !configured && !present ? `no Aurora install at ${location.index}` : false },
  async (t) => {
    assert.ok(present, missing);
    const budget = budgetFromEnvironment(process.env);

    const loadedCorpus = await corpus();
    const found = analyseCorpus(loadedCorpus);
    for (const line of describeCorpus(found, loadedCorpus.elapsedMs)) t.diagnostic(line);

    const failures = checkBudget(found, budget);
    assert.deepEqual(failures, [], `Baseline not met:\n  ${failures.join('\n  ')}`);
  },
);

/**
 * The exact figures, for the one corpus this project can hold still for a while.
 *
 * A budget only catches "worse". CLAUDE.md's baselines are also a statement about what the loader
 * *finds*: 2,258 elements from inline text, 229 generated, 23 requirements nothing can meet. CI
 * reads upstream's HEAD, which moves, so CI gets budgets and only budgets; the maintainer's install
 * is a snapshot, and against it any change at all is a change in Incudo. The unresolved id
 * is named on purpose: the day upstream fixes the spelling this fails, and the edit that follows
 * is the one CLAUDE.md says should happen.
 *
 * **The snapshot is not frozen, because Aurora rewrites it.** Its own content updater replaced seven
 * files while the maintainer had the app open (the Rogue and 2024 class files, `internal.xml` and one
 * supplement), and the element total went from 14,316 to 14,320 with the same 740 files and every
 * other figure here unchanged. So a failure on `elements` and `size` alone is almost certainly
 * that, not Incudo: look at the modification times under `custom/AuroraLegacy` first, and re-record
 * the two numbers once nothing else has moved.
 */
const EXACT = {
  files: 740,
  elements: 14320,
  size: 14545,
  overlay: 83,
  improvementOptions: 146,
  synthesizedFromText: 2258,
  errors: 0,
  warnings: 57,
  unresolved: ['ID_INTERNAL_CONDITION_DAMAGE_VULNERAILITY_BLUDGEONING'],
  unmetRequirements: 23,
};

test(
  "the maintainer's Aurora install reads exactly the recorded baseline",
  {
    skip: configured
      ? "exact figures belong to the maintainer's frozen install; a configured corpus is judged by budget"
      : !present
        ? `no Aurora install at ${location.index}`
        : location.layout !== 'aurora-folder',
  },
  async () => {
    const found = analyseCorpus(await corpus());

    assert.deepEqual(
      {
        files: found.files,
        elements: found.elements,
        size: found.size,
        generated: found.generated,
        synthesizedFromText: found.synthesizedFromText,
        errors: found.errors.length,
        warnings: found.warnings.length,
        unresolved: found.unresolved,
        unmetRequirements: found.unmetRequirements.length,
      },
      {
        files: EXACT.files,
        elements: EXACT.elements,
        size: EXACT.size,
        generated: EXACT.overlay + EXACT.improvementOptions,
        synthesizedFromText: EXACT.synthesizedFromText,
        errors: EXACT.errors,
        warnings: EXACT.warnings,
        unresolved: EXACT.unresolved,
        unmetRequirements: EXACT.unmetRequirements,
      },
    );
    // The two halves of "generated" move for different reasons: the overlay is a fixed table in
    // the importer, the improvement options depend on what is loaded.
    assert.equal(auroraGeneratedElements().length, EXACT.overlay);
  },
);
