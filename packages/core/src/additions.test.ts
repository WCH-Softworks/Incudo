/**
 * Elements a user adds to one character from loaded content — ADR 0064.
 *
 * The fixture has no game in it: a hero whose kind lets Knacks and Marks be added and not Boons. A Knack adds to
 * "might", grants a Mark and asks for one more; another asks for might 15; another asks not to be held already. Each
 * test names the change that fails it, and each was run.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { deriveCharacter } from './engine.ts';
import { collectCharacterContent } from './container.ts';
import { createCharacter, setAdded, type Character } from './character.ts';
import { MapElementIndex, type Element, type Rule } from './model.ts';
import { resolveCharacterKind, type AdditionsDef, type GameSystem } from './system.ts';
import type { RequirementExpr } from './requirements.ts';

function element(id: string, type: string, rules: Rule[] = [], requirements?: RequirementExpr): Element {
  return {
    id,
    type,
    name: id,
    source: 'test',
    setters: {},
    rules,
    supports: [],
    ...(requirements ? { requirements } : {}),
    origin: { sourceId: 'test', format: 'incudo' },
  };
}

const might = (value: number): Rule => ({ kind: 'stat', key: `might:${value}`, name: 'might', value: { kind: 'number', value } });

function system(additions: AdditionsDef | null = { types: ['Knack', 'Mark'] }): GameSystem {
  return {
    formatVersion: 1,
    id: 'test',
    name: 'Test System',
    version: '1.0.0',
    elementTypes: [{ name: 'Knack' }, { name: 'Mark' }, { name: 'Boon' }],
    stats: [
      { name: 'level', default: 0 },
      { name: 'might', label: 'Might', default: 10 },
    ],
    characterKinds: [
      {
        id: 'hero',
        name: 'Hero',
        default: true,
        progression: { kind: 'level', min: 1, max: 20 },
        elementTypes: ['Knack', 'Mark', 'Boon'],
        additions: additions ?? undefined,
        buildSteps: [],
        sheet: { sections: [{ id: 'numbers', label: 'Numbers', stats: ['might'] }] },
      },
    ],
  };
}

const index = new MapElementIndex();
for (const e of [
  element('KEEN', 'Knack', [
    might(2),
    { kind: 'grant', key: 'g', type: 'Mark', id: 'MARK_GIVEN' },
    { kind: 'select', key: 'select:Another Mark', type: 'Mark', name: 'Another Mark', number: 1 },
  ]),
  element('STRONG_ONLY', 'Knack', [might(1)], { kind: 'atLeast', stat: 'might', value: 15 }),
  element('ONCE', 'Knack', [], { kind: 'not', child: { kind: 'has', id: 'ONCE' } }),
  element('MARK_GIVEN', 'Mark'),
  element('MARK_OTHER', 'Mark'),
  element('BOON', 'Boon', [might(5)]),
]) {
  index.add(e);
}

function hero(added: string[], base?: Record<string, number>): Character {
  let character = createCharacter('test', 'hero', { progress: 1 });
  if (base) character.baseStats = base;
  for (const id of added) character = setAdded(character, id, true);
  return character;
}

const codes = (derived: ReturnType<typeof deriveCharacter>) => derived.problems.map((p) => p.code);

test('an added element is held, its rules apply, its grants reach and its select opens', () => {
  // Fails if additions are not seeded by the derivation (nothing held, might 10, no select).
  const derived = deriveCharacter(hero(['KEEN']), system(), index);
  assert.ok(derived.elementIds.has('KEEN'));
  assert.ok(derived.elementIds.has('MARK_GIVEN'));
  assert.equal(derived.stats.get('might')?.value, 12);
  assert.deepEqual(
    derived.pendingChoices.map((c) => [c.ruleKey, c.candidates]),
    [['KEEN/select:Another Mark', ['MARK_OTHER']]],
  );
  assert.deepEqual(codes(derived), []);
});

test('an addition whose prerequisites fail is held and flagged, and the flag clears when they hold', () => {
  // Fails if the flag is not reported (reportUnmetAdditions skipped), or if an unmet addition is refused rather than
  // held (might would read 10).
  const unmet = deriveCharacter(hero(['STRONG_ONLY']), system(), index);
  assert.ok(unmet.elementIds.has('STRONG_ONLY'));
  assert.equal(unmet.stats.get('might')?.value, 11);
  const problem = unmet.problems.find((p) => p.code === 'requirement-unmet');
  assert.equal(problem?.level, 'warning');
  assert.equal(problem?.elementId, 'STRONG_ONLY');
  assert.equal(problem?.message, 'STRONG_ONLY was added to this character, and its prerequisites are not met.');

  const met = deriveCharacter(hero(['STRONG_ONLY'], { might: 15 }), system(), index);
  assert.deepEqual(codes(met), []);
});

test('a prerequisite that the element not already be held does not flag the element itself', () => {
  // Fails if the requirements are asked with the element counted as held.
  const derived = deriveCharacter(hero(['ONCE']), system(), index);
  assert.ok(derived.elementIds.has('ONCE'));
  assert.deepEqual(codes(derived), []);
});

test('only additions are checked: a chosen element whose requirements fail is not flagged', () => {
  // Fails if every held element's requirements are checked rather than the additions'. The hero adds something too,
  // so the check runs at all.
  const character = hero(['KEEN']);
  character.choices = [{ ruleKey: 'build/knack', elementIds: ['STRONG_ONLY'] }];
  const derived = deriveCharacter(character, system(), index);
  assert.ok(derived.elementIds.has('STRONG_ONLY'));
  assert.deepEqual(codes(derived), []);
});

test('a type the kind does not list, and any addition on a kind that lists none, is reported and not held', () => {
  // Fails if the type is not checked against the kind (the Boon is held and might reads 15), or the kind's
  // declaration is ignored.
  const listed = deriveCharacter(hero(['BOON', 'KEEN']), system(), index);
  assert.ok(!listed.elementIds.has('BOON'));
  assert.ok(listed.elementIds.has('KEEN'));
  assert.deepEqual(codes(listed), ['addition-not-allowed']);
  assert.equal(
    listed.problems[0]?.message,
    'BOON was added to this character, and a Hero cannot have a Boon added. It is not on the character.',
  );

  const none = deriveCharacter(hero(['KEEN']), system(null), index);
  assert.ok(!none.elementIds.has('KEEN'));
  assert.equal(none.stats.get('might')?.value, 10);
  assert.deepEqual(codes(none), ['addition-not-allowed']);
});

test('an added id nothing declares is an unresolved element, as a vanished choice is', () => {
  // Fails if an unresolvable addition is dropped in silence.
  const derived = deriveCharacter(hero(['GONE']), system(), index);
  const problem = derived.problems.find((p) => p.code === 'unresolved-element');
  assert.equal(problem?.level, 'error');
  assert.equal(problem?.elementId, 'GONE');
});

test('a save embeds what was added and derives the same with no source', () => {
  // Fails if `collectCharacterContent` does not seed from the additions (the embedded index has none of them).
  const s = system();
  const kind = resolveCharacterKind(s, 'hero');
  const character = hero(['KEEN', 'STRONG_ONLY']);
  character.choices = [{ ruleKey: 'KEEN/select:Another Mark', elementIds: ['MARK_OTHER'] }];
  const embedded = collectCharacterContent(character, index, { kind });
  assert.deepEqual(embedded.unresolved, []);
  const alone = new MapElementIndex();
  for (const e of embedded.elements) alone.add(e);

  const withSources = deriveCharacter(character, s, index);
  const withNone = deriveCharacter(character, s, alone);
  assert.deepEqual([...withNone.elementIds].sort(), [...withSources.elementIds].sort());
  assert.equal(withNone.stats.get('might')?.value, withSources.stats.get('might')?.value);
  assert.deepEqual(codes(withNone), codes(withSources));
  assert.ok(withNone.elementIds.has('MARK_OTHER'));
});

test('recording an addition raises the character to format 5, and taking the last off lowers nothing', () => {
  // Fails if `setAdded` does not raise the version, records one twice, or leaves an empty list behind.
  const fresh = createCharacter('test', 'hero', { progress: 1 });
  assert.equal(fresh.formatVersion, 2);
  const once = setAdded(fresh, 'KEEN', true);
  assert.equal(once.formatVersion, 5);
  assert.deepEqual(once.additions, ['KEEN']);
  assert.equal(setAdded(once, 'KEEN', true), once);
  const off = setAdded(once, 'KEEN', false);
  assert.equal(off.formatVersion, 5);
  assert.equal('additions' in off, false);
});
