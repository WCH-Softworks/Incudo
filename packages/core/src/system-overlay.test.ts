/**
 * A system overlay applied to its parent and validated as the system it makes — ADR 0102.
 *
 * Each case names the perturbation that fails it. The schema is the repository's own, read the way
 * `packages/ui/src/starting-equipment.test.ts` reads its: the point is that an overlay goes through the published contract.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import type { JsonSchema } from './json-schema.ts';
import { validateGameSystem, type SchemaBundle } from './schema.ts';
import { applySystemOverlay, OVERLAY_KEYED_ARRAYS, OVERLAY_REMOVE, type OverlayChange } from './system-overlay.ts';
import { resolveCharacterKind, type GameSystem } from './system.ts';

const systemSchema = JSON.parse(readFileSync(new URL('../../../schemas/system.schema.json', import.meta.url), 'utf8')) as JsonSchema;
const schemas = { system: systemSchema, character: true, manifest: true } as SchemaBundle;

function parent(patch: Partial<GameSystem> = {}): GameSystem {
  return {
    formatVersion: 1,
    id: 'base',
    name: 'Base Game',
    version: '1.0.0',
    elementTypes: [{ name: 'Class' }, { name: 'Feat' }, { name: 'Spell' }],
    stats: [
      { name: 'might', label: 'Might', default: 10 },
      { name: 'wits', label: 'Wits', default: 10 },
      { name: 'guard', label: 'Guard', default: 12 },
    ],
    characterKinds: [
      {
        id: 'pc',
        name: 'Player Character',
        default: true,
        progression: { kind: 'level', min: 1, max: 20 },
        elementTypes: ['Class', 'Feat'],
        buildSteps: [
          { id: 'class', label: 'Class', types: ['Class'], required: true },
          { id: 'feats', label: 'Feats', types: ['Feat'] },
        ],
        sheet: {
          sections: [
            { id: 'scores', label: 'Scores', stats: ['might', 'wits'] },
            { id: 'defence', label: 'Defence', stats: ['guard'] },
          ],
        },
      },
      { id: 'veteran', name: 'Veteran', extends: 'pc', elementTypes: ['+Spell'] },
    ],
    ...patch,
  } as GameSystem;
}

function validate(overlay: unknown, base: GameSystem = parent()) {
  return validateGameSystem(overlay, schemas, { parent: (id) => (id === base.id ? base : undefined) });
}

function overlay(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return { formatVersion: 1, id: 'house', name: 'Our Table', version: '1.0.0', extends: 'base', ...patch };
}

function words(changes: OverlayChange[]): string[] {
  return changes.map((c) => `${c.action} ${c.path.map((s) => (s.entry === undefined ? s.field : `${s.field}:${s.entry}`)).join(' > ')}`);
}

// Perturbation: validateGameSystem not branching on `extends` (the overlay is validated as a complete system and
// refused for its missing elementTypes and characterKinds).
test('the ADR example is applied to its parent and validates as a complete system', () => {
  const result = validate(
    overlay({
      stats: [{ name: 'sanity', label: 'Sanity', default: 10 }],
      characterKinds: [{ id: 'pc', progression: { max: 30 } }],
    }),
  );
  assert.deepEqual(result.errors, []);
  const system = result.value!;
  assert.equal(system.id, 'house');
  assert.equal(system.name, 'Our Table');
  assert.equal(system.extends, 'base');
  assert.deepEqual(system.characterKinds[0]!.progression, { kind: 'level', min: 1, max: 30 });
  assert.deepEqual(
    system.stats.map((s) => s.name),
    ['might', 'wits', 'guard', 'sanity'],
  );
  assert.deepEqual(words(result.overlay!.changes), ['added stats:sanity', 'changed characterKinds:pc > progression']);
  assert.equal(result.overlay!.parent.id, 'base');
});

// Perturbation: replacing an identified array whole (the other stats, kinds and steps are lost and the sheet's
// references fail).
test('an identified entry is merged in place and every other entry is kept, in the parent order', () => {
  const result = validate(overlay({ stats: [{ name: 'wits', default: 8 }], characterKinds: [{ id: 'pc', buildSteps: [{ id: 'feats', required: true }] }] }));
  assert.deepEqual(result.errors, []);
  const system = result.value!;
  assert.deepEqual(system.stats, [
    { name: 'might', label: 'Might', default: 10 },
    { name: 'wits', label: 'Wits', default: 8 },
    { name: 'guard', label: 'Guard', default: 12 },
  ]);
  const steps = system.characterKinds[0]!.buildSteps!;
  assert.deepEqual(steps.map((s) => s.id), ['class', 'feats']);
  assert.deepEqual(steps[1], { id: 'feats', label: 'Feats', types: ['Feat'], required: true });
  assert.equal(system.characterKinds.length, 2);
  assert.deepEqual(words(result.overlay!.changes), ['changed stats:wits > default', 'changed characterKinds:pc > buildSteps:feats > required']);
});

// Perturbation: applying the overlay once and keeping the result (a parent fixed after the overlay was written does
// not reach it). This is what ADR 0102 means by "upstream fixes still arrive".
test('a fix to the parent the overlay does not touch is in the result', () => {
  const house = overlay({ characterKinds: [{ id: 'pc', progression: { max: 30 } }] });
  const fixed = parent({ stats: [{ name: 'might', label: 'Might', default: 10 }, { name: 'wits', label: 'Wits', default: 10 }, { name: 'guard', label: 'Guard', default: 11 }] });
  const before = validate(house).value!;
  const after = validate(house, fixed).value!;
  assert.equal(before.stats.find((s) => s.name === 'guard')!.default, 12);
  assert.equal(after.stats.find((s) => s.name === 'guard')!.default, 11);
  assert.equal(after.characterKinds[0]!.progression!.kind === 'level' && after.characterKinds[0]!.progression!.max, 30);
});

// Perturbation: ignoring `remove` (the step stays, and is merged with a field the format does not have, which fails).
test('"remove": true removes the parent entry, and one naming nothing is reported, not refused', () => {
  const result = validate(overlay({ characterKinds: [{ id: 'pc', buildSteps: [{ id: 'feats', [OVERLAY_REMOVE]: true }, { id: 'gone', [OVERLAY_REMOVE]: true }] }] }));
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.value!.characterKinds[0]!.buildSteps!.map((s) => s.id), ['class']);
  assert.deepEqual(words(result.overlay!.changes), ['removed characterKinds:pc > buildSteps:feats', 'absent characterKinds:pc > buildSteps:gone']);
  assert.equal(result.overlay!.changes[0]!.path[1]!.label, 'Feats');
});

// Perturbation: treating null as a value (the schema refuses a null progression, or the kind keeps its own).
test('null removes a field the parent has', () => {
  const base = parent();
  (base.characterKinds[0]! as unknown as Record<string, unknown>)['description'] = 'Someone at the table.';
  const result = validate(overlay({ characterKinds: [{ id: 'pc', description: null }] }), base);
  assert.deepEqual(result.errors, []);
  assert.equal('description' in result.value!.characterKinds[0]!, false);
  assert.deepEqual(words(result.overlay!.changes), ['removed characterKinds:pc > description']);
});

// Perturbation: replacing a kind's element types whole when written as a delta (the kind loses Class and Feat, and its
// build steps no longer validate); and flattening the inheriting kind's own delta (it loses the parent kind's types).
test("a kind's element types written as a delta are applied to the parent's list", () => {
  const result = validate(
    overlay({
      elementTypes: [{ name: 'Boon' }],
      characterKinds: [
        { id: 'pc', elementTypes: ['+Boon', '-Feat'], buildSteps: [{ id: 'feats', [OVERLAY_REMOVE]: true }] },
        { id: 'veteran', elementTypes: ['-Spell'] },
      ],
    }),
  );
  assert.deepEqual(result.errors, []);
  const system = result.value!;
  assert.deepEqual(system.characterKinds[0]!.elementTypes, ['Class', 'Boon']);
  assert.deepEqual(resolveCharacterKind(system, 'veteran').elementTypes, ['Class', 'Boon']);
});

// Perturbation: validating only the overlay's shell (a patch that breaks a reference loads).
test('the applied system is checked as a complete one, references included', () => {
  const result = validate(overlay({ characterKinds: [{ id: 'pc', sheet: { sections: [{ id: 'scores', stats: ['might', 'luck'] }] } }] }));
  assert.equal(result.value, undefined);
  // Once for the kind and once for the kind that extends it: both would show the section.
  assert.deepEqual(result.errors.map((e) => e.path), ['characterKinds[0].sheet', 'characterKinds[1].sheet']);
  for (const error of result.errors) assert.match(error.message, /"luck", which is not declared/);
});

// Perturbation: dropping `$defs/overlay`'s required list or its additionalProperties.
test("an overlay's own shell is checked, with the format's words", () => {
  const { name: _name, ...nameless } = overlay();
  assert.deepEqual(
    validate({ ...nameless, nmae: 'Our Table' }).errors.map((e) => `${e.path} ${e.message}`),
    ['name is required', 'nmae is not a known field — did you mean "name"?'],
  );
  assert.deepEqual(validate(overlay({ stats: { add: [] } })).errors.map((e) => `${e.path} ${e.message}`), ['stats must be an array, not an object']);
});

// Perturbation: resolving a parent that is missing, an overlay, or the overlay itself.
test('an overlay needs a complete parent Incudo has, and an id of its own', () => {
  assert.deepEqual(validate(overlay({ extends: 'elsewhere' })).errors, [
    { path: 'extends', message: 'names "elsewhere", which is not a system Incudo has' },
  ]);
  assert.match(validate(overlay(), parent({ extends: 'older' })).errors[0]!.message, /changes another system itself/);
  assert.match(validate(overlay({ id: 'base' })).errors[0]!.message, /needs an id of its own/);
  // With no way to find a parent at all, as every caller before ADR 0102 calls it.
  assert.equal(validateGameSystem(overlay(), schemas).value, undefined);
});

// Perturbation: reporting every field the overlay writes (a value equal to the parent's reads as a change).
test('a value equal to the parent is not a change', () => {
  const result = validate(overlay({ stats: [{ name: 'guard', default: 12 }], characterKinds: [{ id: 'pc', progression: { max: 20 } }] }));
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.overlay!.changes, []);
});

test('applying leaves the parent and the overlay as they were', () => {
  const base = parent();
  const before = JSON.stringify(base);
  const house = overlay({ stats: [{ name: 'wits', default: 8 }], characterKinds: [{ id: 'pc', buildSteps: [{ id: 'feats', [OVERLAY_REMOVE]: true }] }] });
  const written = JSON.stringify(house);
  const applied = applySystemOverlay(base, house);
  (applied.system.stats[0] as { default: number }).default = 99;
  assert.equal(JSON.stringify(base), before);
  assert.equal(JSON.stringify(house), written);
});

// --- guards: the merge table and the published format cannot drift apart --------------------------------------------

type Node = Record<string, unknown>;

function resolve(node: unknown): Node | undefined {
  if (typeof node !== 'object' || node === null) return undefined;
  const ref = (node as Node)['$ref'];
  if (typeof ref === 'string') return resolve(ref.split('/').slice(1).reduce<unknown>((at, key) => (at as Node)[key], systemSchema));
  return node as Node;
}

/** Every array of objects in the format, by overlay path, with the identity its entries require. */
function identifiedArrays(): Map<string, string | undefined> {
  const found = new Map<string, string | undefined>();
  const walk = (raw: unknown, path: string, depth: number): void => {
    const node = resolve(raw);
    if (!node || depth > 8) return;
    if (node['type'] === 'array' && node['items']) {
      const item = resolve(node['items']);
      if (item && item['type'] === 'object') {
        const required = (item['required'] as string[] | undefined) ?? [];
        found.set(path, ['id', 'name', 'key'].find((key) => required.includes(key)));
      }
      walk(node['items'], `${path}[]`, depth + 1);
      return;
    }
    for (const [key, value] of Object.entries((node['properties'] as Node | undefined) ?? {})) walk(value, path ? `${path}.${key}` : key, depth + 1);
    for (const combinator of ['anyOf', 'oneOf', 'allOf']) for (const branch of (node[combinator] as unknown[] | undefined) ?? []) walk(branch, path, depth + 1);
  };
  walk(systemSchema, '', 0);
  return found;
}

// Perturbation: deleting an entry of OVERLAY_KEYED_ARRAYS (that array would be replaced whole by an overlay).
test('every array whose entries have an identity is merged by it', () => {
  const arrays = identifiedArrays();
  const identified = [...arrays].filter(([, key]) => key !== undefined).map(([path]) => path).sort();
  assert.deepEqual(identified, Object.keys(OVERLAY_KEYED_ARRAYS).sort());
  // A suggested source requires a name, and is keyed by its url: ADR 0031 decision 4.
  assert.ok(arrays.has('suggestedSources'));
  for (const [path, key] of Object.entries(OVERLAY_KEYED_ARRAYS)) {
    if (path === 'suggestedSources') continue;
    assert.equal(arrays.get(path), key, path);
  }
});

// Perturbation: adding a field called "remove" to an identified entry's schema.
test('no identified entry of the format has a field called remove', () => {
  const walk = (raw: unknown, path: string, depth: number): void => {
    const node = resolve(raw);
    if (!node || depth > 8) return;
    if (node['type'] === 'array' && node['items']) {
      const item = resolve(node['items']);
      if (item && path in OVERLAY_KEYED_ARRAYS) assert.equal(OVERLAY_REMOVE in ((item['properties'] as Node | undefined) ?? {}), false, path);
      walk(node['items'], `${path}[]`, depth + 1);
      return;
    }
    for (const [key, value] of Object.entries((node['properties'] as Node | undefined) ?? {})) walk(value, path ? `${path}.${key}` : key, depth + 1);
  };
  walk(systemSchema, '', 0);
});

// Perturbation: adding a root field to the format and not to $defs/overlay.
test("an overlay may write every root field of the format, and nothing else", () => {
  const root = Object.keys((systemSchema as Node)['properties'] as Node).sort();
  const shell = Object.keys(((((systemSchema as Node)['$defs'] as Node)['overlay'] as Node)['properties'] as Node)).sort();
  assert.deepEqual(shell, root);
});

// --- ADR 0103: an identity twice is refused in every identified array ------------------------------------------------

const shipped5e = (): Record<string, unknown> =>
  JSON.parse(readFileSync(new URL('../../../systems/dnd5e/system.json', import.meta.url), 'utf8')) as Record<string, unknown>;

/** The first array in `document` that `pattern` names and that holds an entry, walked as the table's patterns are. */
function firstArray(document: unknown, pattern: string): unknown[] | undefined {
  let at: unknown[] = [document];
  for (const segment of pattern.split('.')) {
    const many = segment.endsWith('[]');
    const name = many ? segment.slice(0, -2) : segment;
    at = at.flatMap((value) => {
      const child = (value as Record<string, unknown> | undefined)?.[name];
      if (child === undefined) return [];
      return many ? (Array.isArray(child) ? child : []) : [child];
    });
  }
  return at.find((value): value is unknown[] => Array.isArray(value) && value.length > 0);
}

// Perturbation: dropping duplicateIdentities from checkSystemReferences, or adding a table path to CHECKED_ELSEWHERE that
// no check covers.
test('every identified array refuses an identity twice, with one error naming it', () => {
  assert.deepEqual(validateGameSystem(shipped5e(), schemas).errors, []);
  for (const [pattern, key] of Object.entries(OVERLAY_KEYED_ARRAYS)) {
    const system = shipped5e();
    const array = firstArray(system, pattern);
    assert.ok(array, `5e has an entry in ${pattern}`);
    const copy = JSON.parse(JSON.stringify(array[0])) as Record<string, unknown>;
    // A copy with only its identity kept the same, so nothing else about it is what is refused.
    array.push(copy);
    const errors = validateGameSystem(system, schemas).errors;
    assert.ok(errors.length >= 1, `${pattern}: ${JSON.stringify(errors)}`);
    assert.ok(errors.every((e) => e.message.includes(String(copy[key]))), `${pattern}: ${JSON.stringify(errors)}`);
  }
});

// Perturbation: comparing stat names exactly (resolution lowercases, so "Might" and "might" are one stat).
test('two stats whose names differ only by case are one stat twice', () => {
  const errors = validateGameSystem(parent({ stats: [...parent().stats, { name: 'Might', default: 3 }] }), schemas).errors;
  assert.deepEqual(errors, [{ path: 'stats[3].name', message: '"Might" is already used in this stats list; each entry needs its own, or remove one' }]);
});

// Perturbation: removing the min/max comparison.
test('a generation method whose min is above its max is refused', () => {
  const errors = validateGameSystem(parent({ generationMethods: [{ id: 'roll', label: 'Roll', min: 18, max: 3 }] } as Partial<GameSystem>), schemas).errors;
  assert.deepEqual(errors, [{ path: 'generationMethods[0].min', message: 'is 18, above the max of 3, so no value could be chosen' }]);
});
