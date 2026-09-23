/**
 * The corpus regression suite (ADR 0039).
 *
 * CLAUDE.md's baselines — 740 files, 14,320 elements at the time of writing, 1 unresolved reference, 57 warnings — used
 * to be read off `incudo validate`, and CI's `aurora-corpus` job ran that command with budgets.
 * This file is both. It has three layers, and only the last needs a corpus:
 *
 *  1. The budget logic and the environment it is configured through, on inputs written here, so
 *     it is checked on every machine and in every CI job.
 *  2. A small corpus written to a temp folder and loaded through the same loader, so "a grant to
 *     nothing is counted, a requirement to nothing is reported and not budgeted, and a miss in
 *     the mirror is an error rather than a fetch" are each asserted, not remembered.
 *  3. The real thing: the budgets against the current AuroraLegacy/elements (ADR 0042).
 *
 * Where the corpus is comes from `resolveCorpus`: the environment if it names one, else the checkout
 * `npm run corpus:sync` made in `.corpus/`, else nothing, and the third layer skips and says how to get
 * one. A corpus the environment names that is not there **fails**: a skipped test is a green one, and a
 * checkout that did not happen loads nothing.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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
  resolveCorpus,
  type CorpusAnalysis,
  type CorpusBudget,
  type CorpusLocation,
  type LoadedCorpus,
} from './corpus.ts';
import { CORPUS_REPOSITORY } from './corpus-checkout.ts';
import { repoRoot } from './node-system.ts';
import { corpusProvenance, corpusSkip, requireCorpus } from './real-data.ts';

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
  // Nothing says where it is, so nothing is assumed: there is no default path to a machine.
  const unset = corpusFromEnvironment({});
  assert.equal(unset.configured, false);
  assert.equal(unset.location, undefined);

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

test('ci.yml states the same budgets this file falls back to', async () => {
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
  assert.doesNotMatch(workflow, /npm run incudo/, 'the CLI is gone (ADR 0039)');
});

test('the corpus job reads the current official repository, always, and runs the whole suite', async () => {
  const workflow = await readFile(join(repoRoot(), '.github', 'workflows', 'ci.yml'), 'utf8');
  const job = workflow.slice(workflow.indexOf('\n  aurora-corpus:'));
  assert.ok(job.length > 0, 'ci.yml has an aurora-corpus job');

  // The same repository the local sync script fetches: two copies of a name drift.
  assert.match(job, new RegExp(`^\\s*repository:\\s*${CORPUS_REPOSITORY}\\s*$`, 'm'));
  // No pin. A `ref:` here would make the job reproducible and stop it noticing upstream (ADR 0042).
  assert.doesNotMatch(
    job.split('\n').filter((line) => !line.trim().startsWith('#')).join('\n'),
    /^\s*ref:/m,
    'the corpus checkout must not name a ref',
  );
  assert.match(job, /^\s*path:\s*\.corpus\s*$/m, 'the checkout goes where the local sync puts it');
  // Every real-content test, not only the budget file.
  assert.match(job, /^\s*run:\s*npm test\s*$/m, 'the job runs the whole suite');
  // And it requires the samples, so an empty saves folder is a failure and not a skip.
  assert.match(job, /^\s*INCUDO_REQUIRE_SAVES:\s*1\s*$/m, 'the job requires the sample saves');
  // A schedule, so upstream changes are noticed while this repository is quiet.
  assert.match(workflow, /^\s*schedule:\s*$/m);
  assert.match(workflow, /^\s*-\s*cron:\s*'[^']+'\s*$/m);
});

test('a run reads the environment first, the repository checkout second, and otherwise nothing', () => {
  const checkout: CorpusLocation = { index: '/x/.corpus/AuroraLegacy.index', layout: 'repository', root: '/x/.corpus' };

  // Nothing named and nothing synced: no corpus, and not a "configured" one, so it skips.
  assert.deepEqual(resolveCorpus({}, undefined), { location: undefined, configured: false, source: 'none' });

  // The checkout is the default. It is not "configured": an absent one skips, it does not fail.
  assert.deepEqual(resolveCorpus({}, checkout), { location: checkout, configured: false, source: 'checkout' });

  // A named index wins over the checkout, and is configured, so that a missing one fails.
  const named = resolveCorpus({ INCUDO_AURORA_INDEX: 'somewhere/AuroraLegacy.index' }, checkout);
  assert.equal(named.source, 'environment');
  assert.equal(named.configured, true);
  assert.equal(named.location?.index, 'somewhere/AuroraLegacy.index');
  assert.equal(named.location?.layout, 'aurora-folder', 'an environment-named index keeps the layout rules');

  // A bad layout is still refused with a checkout present.
  assert.throws(() => resolveCorpus({ INCUDO_CORPUS_LAYOUT: 'mirror' }, checkout), /one of/);
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

test('an Aurora download folder is read by name, and is not the same layout as a checkout', async () => {
  // Nothing committed runs the `aurora-folder` layout against a real install any more: CI and a default
  // local run read the repository checkout. It stays the way to point a run at an install (ADR 0042),
  // so it is exercised here, on a folder written the way Aurora's downloader writes one: each index
  // gets a folder named after it and its files sit inside by `name`.
  const dir = await mkdtemp(join(tmpdir(), 'incudo-corpus-'));
  try {
    await mkdir(join(dir, 'Mini'));
    await writeFile(
      join(dir, 'Mini.index'),
      `<index><info><name>Mini</name><update version="1.0.0" /></info><files>` +
        `<file name="a.xml" url="${RAW}/somewhere/else/a.xml" /></files></index>`,
    );
    await writeFile(
      join(dir, 'Mini', 'a.xml'),
      `<elements><info><name>A</name><update version="1" /></info>
        <element name="One" type="Thing" source="Mini" id="ID_ONE" /></elements>`,
    );
    const index = join(dir, 'Mini.index');

    const byName = analyseCorpus(await loadCorpus({ index, layout: 'aurora-folder' }));
    assert.equal(byName.files, 1);
    assert.equal(byName.elements, 1);
    assert.deepEqual(byName.errors, []);

    // The same folder read as a checkout looks for `a.xml` at the URL's path and does not find it: the
    // two layouts are not interchangeable, and mixing them is an error and never a fetch.
    const asCheckout = analyseCorpus(await loadCorpus({ index, layout: 'repository', root: dir }));
    assert.equal(asCheckout.files, 0);
    assert.equal(asCheckout.errors.length, 1);
    assert.match(asCheckout.errors[0]!.message, /refused to fetch/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// --- 3. the real corpus ----------------------------------------------------

/**
 * The overlay is a fixed table in the importer, and CLAUDE.md counts it. It is a property of the code
 * and reads no corpus, so it is asserted here where anyone can run it.
 */
test('the overlay is the 83 elements Aurora materializes at runtime', () => {
  assert.equal(auroraGeneratedElements().length, 83);
});

/**
 * The budgets against whatever corpus the environment names, which in CI is a checkout of the content
 * repository and on a maintainer's machine is their own install. There are no exact figures here on
 * purpose: an earlier version pinned the element total of one person's Aurora install, and Aurora's own
 * updater rewrote that install while it was open. What that test guarded (that the loader still
 * finds inline lists, and still mints the ids it used to) is held by unit tests that read no corpus,
 * which fail when the id shape changes and when the items stop being read.
 */
test(
  'the Aurora corpus stays within its budget',
  { skip: corpusSkip },
  async (t) => {
    const location = requireCorpus();
    const budget = budgetFromEnvironment(process.env);

    const loadedCorpus = await loadCorpus(location);
    const found = analyseCorpus(loadedCorpus);
    t.diagnostic(corpusProvenance());
    for (const line of describeCorpus(found, loadedCorpus.elapsedMs)) t.diagnostic(line);

    const failures = checkBudget(found, budget);
    assert.deepEqual(failures, [], `Baseline not met:\n  ${failures.join('\n  ')}`);
  },
);
