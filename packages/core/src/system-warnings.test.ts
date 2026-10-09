/**
 * A stat name one slip from a declared one is a warning when a system loads — ADR 0105.
 *
 * Each case names the perturbation that fails it. The shipped systems are held to no warning in
 * `tools/verify/src/system-warnings.test.ts`, which is what keeps the rule from firing on names content supplies.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import type { JsonSchema } from './json-schema.ts';
import { validateGameSystem, type SchemaBundle } from './schema.ts';
import { systemWarnings } from './system-warnings.ts';
import type { GameSystem } from './system.ts';

const systemSchema = JSON.parse(readFileSync(new URL('../../../schemas/system.schema.json', import.meta.url), 'utf8')) as JsonSchema;
const schemas = { system: systemSchema, character: true, manifest: true } as SchemaBundle;

const ref = (stat: string) => ({ kind: 'ref' as const, stat });

function game(edit: (system: GameSystem) => void = () => {}): GameSystem {
  const system: GameSystem = {
    formatVersion: 1,
    id: 'game',
    name: 'Game',
    version: '1.0.0',
    elementTypes: [{ name: 'Trait' }],
    stats: [
      { name: 'might', label: 'Might', default: 10 },
      { name: 'agility', label: 'Agility', default: 10 },
    ],
    generationMethods: [{ id: 'entered', label: 'Enter', min: 1, max: 20 }],
    characterKinds: [
      {
        id: 'hero',
        name: 'Hero',
        default: true,
        progression: { kind: 'level', min: 1, max: 10, stat: 'level' },
        elementTypes: ['Trait'],
        stats: [
          { name: 'level', label: 'Level', default: 1 },
          { name: 'health', label: 'Health', default: 0, derive: { kind: 'binary', op: '+', left: ref('might'), right: ref('level') } },
        ],
        buildSteps: [
          { id: 'scores', label: 'Scores', types: [], required: true, budget: { stat: 'points', targets: ['might', 'agility'], methods: ['entered'] } },
        ],
        sheet: { sections: [{ id: 'scores', label: 'Scores', stats: ['might', 'agility', 'health'] }] },
      },
    ],
  };
  edit(system);
  return system;
}

const hero = (system: GameSystem) => system.characterKinds[0]!;

test('a correct system has no warning', () => {
  const result = validateGameSystem(game(), schemas);
  assert.equal(result.valid, true);
  assert.deepEqual(result.warnings, []);
});

// Perturbation: drop the ref walk (`refs`) and Health's slip validates silently again.
test('a slip in a derive is a warning naming the stat it is close to, and the file still validates', () => {
  const result = validateGameSystem(
    game((s) => {
      hero(s).stats![1]!.derive = { kind: 'binary', op: '+', left: ref('mght'), right: ref('level') };
    }),
    schemas,
  );
  assert.equal(result.valid, true);
  assert.deepEqual(result.warnings, [
    {
      path: 'characterKinds[0].stats[1].derive.left.stat',
      message: 'names "mght", which this system does not declare; did you mean "might"? A stat nothing declares reads as 0 unless content adds to it.',
    },
  ]);
});

// Perturbation: compare names without lowercasing and `Might` is reported as a slip of `might`.
test('case is not a slip: stat names are read ignoring case', () => {
  const system = game((s) => {
    hero(s).stats![1]!.derive = ref('Might');
  });
  assert.deepEqual(systemWarnings(system), []);
});

// Perturbation: allow two edits for every name and `hp` is taken for a slip of `ac`.
test('a short name is a slip only one letter off, so a name content supplies is not mistaken for one', () => {
  const system = game((s) => {
    s.stats.push({ name: 'ac', label: 'Armour' });
    hero(s).stats![1]!.derive = { kind: 'binary', op: '+', left: ref('hp'), right: ref('agility:misc') };
  });
  assert.deepEqual(systemWarnings(system), []);
});

// Perturbation: leave the budget's targets unread.
test('a budget target, a contribution, a per-track stat and a start are read', () => {
  const system = game((s) => {
    const kind = hero(s);
    kind.buildSteps![0]!.budget!.targets = ['might', 'agilty'];
    kind.contributions = [{ stat: 'helth', value: ref('levl') }];
    kind.trackStats = [{ stat: 'healht', value: { kind: 'binary', op: '*', left: ref('track:progress'), right: ref('migt') } }];
    kind.stats!.push({ name: 'guard', label: 'Guard', startsFrom: 'mihgt' });
  });
  assert.deepEqual(
    systemWarnings(system).map((w) => [w.path, w.message.match(/"([^"]+)".*"([^"]+)"/)!.slice(1).join(' → ')]),
    [
      ['characterKinds[0].stats[2].startsFrom', 'mihgt → might'],
      ['characterKinds[0].contributions[0].stat', 'helth → health'],
      ['characterKinds[0].contributions[0].value.stat', 'levl → level'],
      ['characterKinds[0].trackStats[0].stat', 'healht → health'],
      ['characterKinds[0].trackStats[0].value.right.stat', 'migt → might'],
      ['characterKinds[0].buildSteps[0].budget.targets[1]', 'agilty → agility'],
    ],
  );
});

// Perturbation: drop the `{` check and a per-track template one slip from a declared name is read as a slip.
test('a template is not read', () => {
  const system = game((s) => {
    s.stats.push({ name: 'names', label: 'Names' });
    hero(s).trackStats = [{ stat: '{name}', value: ref('track:first') }];
  });
  assert.deepEqual(systemWarnings(system), []);
});

// Perturbation: report per kind rather than per path, and the system's own slip is listed twice.
test('a slip in the system\'s own stats is reported once, whatever the number of kinds', () => {
  const system = game((s) => {
    s.stats.push({ name: 'guard', label: 'Guard', derive: ref('agilit') });
    s.characterKinds.push({ id: 'rival', name: 'Rival', extends: 'hero' });
  });
  assert.deepEqual(
    systemWarnings(system).map((w) => w.path),
    ['stats[2].derive.stat'],
  );
});

// Perturbation: compute warnings on a refused file and it comes back with both.
test('a file that does not validate has errors and no warnings', () => {
  const result = validateGameSystem(
    game((s) => {
      delete (s as Partial<GameSystem>).version;
      hero(s).stats![1]!.derive = ref('mght');
    }),
    schemas,
  );
  assert.equal(result.valid, false);
  assert.deepEqual(result.warnings, []);
});

// Perturbation: compute an overlay's warnings on the overlay's text rather than the system it makes.
test('an overlay\'s warnings are about the system it makes', () => {
  const parent = game();
  const result = validateGameSystem(
    {
      formatVersion: 1,
      id: 'house',
      name: 'House',
      version: '0.1.0',
      extends: 'game',
      // The same shape as the parent's: an expression is an object, so it merges key by key with the one it replaces.
      characterKinds: [{ id: 'hero', stats: [{ name: 'health', derive: { kind: 'binary', op: '*', left: ref('migth'), right: ref('level') } }] }],
    },
    schemas,
    { parent: (id) => (id === 'game' ? parent : undefined) },
  );
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.warnings.map((w) => w.path), ['characterKinds[0].stats[1].derive.left.stat']);
});
