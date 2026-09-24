/**
 * Prepared lists — ADR 0046. A fixture with no game in it, and no corpus: a block called Orange that
 * lets its player put a limited number of Gadgets on a list, from a catalogue or from a ledger it keeps.
 *
 * Perturbation is what these are for, as everywhere the engine is held to a number Aurora also shows: the
 * real-save check cannot say the rule is right for the reason it thinks, so each half of the rule is
 * removed here in turn and the answer has to move.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  BundleElementIndex,
  collectCharacterContent,
  createCharacter,
  deriveCharacter,
  getPrepared,
  MapElementIndex,
  packCharacterContainer,
  parseSupports,
  preparationPool,
  preparedElementIds,
  readCharacterContainer,
  setPrepared,
  type Character,
  type Element,
  type GameSystem,
  type Rule,
} from './index.ts';

function gadget(id: string, supports: string[], tier: string): Element {
  return {
    id,
    type: 'Gadget',
    name: id,
    source: 'test',
    setters: { tier: { value: tier } },
    rules: [],
    supports,
    origin: { sourceId: 'test', format: 'incudo' },
  };
}

function widget(id: string, rules: Rule[], blocks: Element['spellcasting'] = []): Element {
  return {
    id,
    type: 'Widget',
    name: id,
    source: 'test',
    setters: {},
    rules,
    supports: [],
    origin: { sourceId: 'test', format: 'incudo' },
    spellcasting: blocks,
  };
}

const stat = (name: string, value: number): Rule => ({
  kind: 'stat',
  key: `stat:${name}`,
  name,
  value: { kind: 'number', value },
});

function fixtureSystem(withPreparation = true): GameSystem {
  return {
    formatVersion: 1,
    id: 'test',
    name: 'Test System',
    version: '1.0.0',
    elementTypes: [{ name: 'Widget' }, { name: 'Gadget' }],
    stats: [],
    characterKinds: [
      {
        id: 'pc',
        name: 'Character',
        default: true,
        progression: { kind: 'level', min: 1, max: 20 },
        elementTypes: ['Widget', 'Gadget'],
        blockFilters: [
          { key: 'gizmo:catalogue', tags: ['{list}', '{name}'] },
          { key: 'gizmo:charge', tagsFromStats: ['{name}:gizmo:charge:*'], fillFrom: 1 },
        ],
        ...(withPreparation
          ? {
              preparation: {
                blockAttribute: 'prepare',
                limit: '{name}:gizmo:allow',
                elementType: 'Gadget',
                heldSelect: 'Ledger',
                listFilter: '$(gizmo:catalogue), $(gizmo:charge)',
                heldFilter: '$(gizmo:charge)',
              },
            }
          : {}),
        buildSteps: [],
        sheet: { sections: [] },
      },
    ],
  };
}

/** The block's own rules: a limit of 2 and a charge of 2 tiers (1 and 2 by fillFrom). */
const CASTER_RULES: Rule[] = [stat('orange:gizmo:allow', 2), stat('orange:gizmo:charge:2', 1)];

function blockOf(prepare: string | undefined, name = 'Orange'): NonNullable<Element['spellcasting']> {
  return [{ name, ...(prepare === undefined ? {} : { prepare }) }];
}

/** The fixture prepares by the field core already carries on a declared block, so nothing is invented. */
function system(): GameSystem {
  return fixtureSystem();
}

function characterWith(caster: Element, prepared?: Record<string, string[]>): Character {
  const character = { ...createCharacter('test', 'pc'), progress: 3 };
  character.choices = [{ ruleKey: 'seed', elementIds: [caster.id] }];
  if (prepared) character.prepared = prepared;
  return character;
}

function index(...elements: Element[]): MapElementIndex {
  const map = new MapElementIndex();
  map.addAll(elements);
  return map;
}

const A = gadget('A', ['Orange'], '1');
const B = gadget('B', ['Orange'], '1');
const C = gadget('C', ['Orange'], '3'); // a tier the block has no charge for
const D = gadget('D', ['Purple'], '1'); // on another block's catalogue
const E = gadget('E', ['Orange'], '2');

function listCaster(extra: Rule[] = []): Element {
  return widget('CASTER', [...CASTER_RULES, ...extra], blockOf('true'));
}

test('a list preparer offers the catalogue at the tiers it has charge for, less what is already on it', () => {
  const corpus = index(listCaster(), A, B, C, D, E);
  const derived = deriveCharacter(characterWith(listCaster(), { orange: ['A'] }), system(), corpus);

  const [orange] = derived.preparation;
  assert.equal(orange?.key, 'orange');
  assert.equal(orange?.mode, 'list');
  assert.equal(orange?.limit, 2);
  assert.deepEqual(orange?.chosen, ['A']);
  assert.equal(orange?.over, 0);
  // B and E pass; A is already on the list; C is a tier with no charge; D is another catalogue.
  assert.deepEqual(
    preparationPool(derived, corpus, 'orange').map((e) => e.id).sort(),
    ['B', 'E'],
  );
});

test('what content makes always prepared is on the list and counts for nothing', () => {
  const caster = listCaster([
    { kind: 'grant', key: 'g', type: 'Gadget', id: 'A', spellcasting: 'Orange', prepared: true },
  ]);
  const corpus = index(caster, A, B, E);
  // The importer copies an always-prepared spell into the recorded list too; nothing counts twice.
  const derived = deriveCharacter(characterWith(caster, { orange: ['A', 'B'] }), system(), corpus);
  const [orange] = derived.preparation;
  assert.deepEqual(orange?.always, ['A']);
  assert.deepEqual(orange?.chosen, ['B']);
  assert.equal(orange?.over, 0);
  assert.deepEqual(preparationPool(derived, corpus, 'orange').map((e) => e.id), ['E']);
});

test('a grant with no prepared marker attaches an element without making it always prepared', () => {
  const caster = listCaster([{ kind: 'grant', key: 'g', type: 'Gadget', id: 'A', spellcasting: 'Orange' }]);
  const derived = deriveCharacter(characterWith(caster, { orange: ['A'] }), system(), index(caster, A));
  assert.deepEqual(derived.preparation[0]?.always, []);
  assert.deepEqual(derived.preparation[0]?.chosen, ['A']);
});

test('past the limit is a reported error and never a refusal', () => {
  const corpus = index(listCaster(), A, B, E);
  const derived = deriveCharacter(characterWith(listCaster(), { orange: ['A', 'B', 'E'] }), system(), corpus);
  const [orange] = derived.preparation;
  assert.equal(orange?.over, 1);
  assert.deepEqual(orange?.chosen, ['A', 'B', 'E'], 'all three still count and are kept');
  const problem = derived.problems.find((p) => p.code === 'over-prepared');
  assert.equal(problem?.level, 'error');
  assert.match(problem!.message, /3 prepared for "Orange", which allows 2/);
  // At the limit says nothing.
  const at = deriveCharacter(characterWith(listCaster(), { orange: ['A', 'B'] }), system(), corpus);
  assert.deepEqual(at.problems.filter((p) => p.code === 'over-prepared'), []);
});

test('something the block cannot prepare is kept, counted for nothing, and warned about', () => {
  const corpus = index(listCaster(), A, C, D);
  const derived = deriveCharacter(characterWith(listCaster(), { orange: ['A', 'C', 'D', 'MISSING'] }), system(), corpus);
  const [orange] = derived.preparation;
  assert.deepEqual(orange?.chosen, ['A']);
  assert.deepEqual(orange?.unavailable, ['C', 'D', 'MISSING']);
  assert.equal(derived.problems.filter((p) => p.code === 'not-preparable').length, 3);
  assert.equal(orange?.over, 0, 'what does not count cannot put the list over');
});

test('a duplicate on the recorded list counts once', () => {
  const corpus = index(listCaster(), A);
  const derived = deriveCharacter(characterWith(listCaster(), { orange: ['A', 'A'] }), system(), corpus);
  assert.deepEqual(derived.preparation[0]?.chosen, ['A']);
});

test('a block with a ledger prepares from what it holds, and only what it holds', () => {
  const ledger: Rule = {
    kind: 'select',
    key: 'select:Ledger',
    type: 'Gadget',
    name: 'Ledger (Orange)',
    number: 3,
    spellcasting: 'Orange',
    supports: parseSupports('$(gizmo:catalogue), $(gizmo:charge)'),
  };
  const caster = listCaster([ledger]);
  const corpus = index(caster, A, B, C, E);
  const character = characterWith(caster, { orange: ['A', 'B'] });
  // Held: A, E and C. C is a tier with no charge, so it is held and cannot be prepared. B is on the
  // catalogue and is not held, so a ledger block cannot prepare it.
  character.choices.push({ ruleKey: 'CASTER/select:Ledger', elementIds: ['A', 'E', 'C'] });
  const derived = deriveCharacter(character, system(), corpus);

  const [orange] = derived.preparation;
  assert.equal(orange?.mode, 'held');
  assert.deepEqual(orange?.held.sort(), ['A', 'E']);
  assert.deepEqual(orange?.chosen, ['A']);
  assert.deepEqual(orange?.unavailable, ['B']);
  assert.deepEqual(preparationPool(derived, corpus, 'orange').map((e) => e.id), ['E']);
});

test('taking the ledger out makes the same block prepare from its list', () => {
  const corpus = index(listCaster(), A, B);
  const derived = deriveCharacter(characterWith(listCaster(), { orange: ['B'] }), system(), corpus);
  assert.equal(derived.preparation[0]?.mode, 'list');
  assert.deepEqual(derived.preparation[0]?.chosen, ['B']);
});

test('a block whose attribute does not say it prepares has no list, and a kind with no declaration has none at all', () => {
  const known = widget('CASTER', CASTER_RULES, blockOf('false'));
  const plain = widget('CASTER', CASTER_RULES, blockOf(undefined));
  for (const caster of [known, plain]) {
    const derived = deriveCharacter(characterWith(caster, { orange: ['A'] }), system(), index(caster, A));
    assert.deepEqual(derived.preparation, []);
  }
  const noDeclaration = deriveCharacter(
    characterWith(listCaster(), { orange: ['A'] }),
    fixtureSystem(false),
    index(listCaster(), A),
  );
  assert.deepEqual(noDeclaration.preparation, []);
  assert.deepEqual(noDeclaration.problems.filter((p) => /prepar/.test(p.code)), []);
});

test('each block has its own limit, read from its own name', () => {
  const two = widget(
    'CASTER',
    [...CASTER_RULES, stat('purple:gizmo:allow', 5), stat('purple:gizmo:charge:1', 1)],
    [...blockOf('true'), ...blockOf('true', 'Purple')],
  );
  const derived = deriveCharacter(characterWith(two), system(), index(two, A, D));
  assert.deepEqual(
    derived.preparation.map((b) => [b.key, b.limit]),
    [
      ['orange', 2],
      ['purple', 5],
    ],
  );
  // Purple's own catalogue and charge, not Orange's.
  assert.deepEqual(preparationPool(derived, index(two, A, D), 'purple').map((e) => e.id), ['D']);
});

test('a block whose limit stat nothing publishes reads zero, and everything on it is over', () => {
  const noLimit = widget('CASTER', [stat('orange:gizmo:charge:1', 1)], blockOf('true'));
  const derived = deriveCharacter(characterWith(noLimit, { orange: ['A'] }), system(), index(noLimit, A));
  assert.equal(derived.preparation[0]?.limit, 0);
  assert.equal(derived.preparation[0]?.over, 1);
});

test('the limit follows the derivation, so a stat that changes with level moves it', () => {
  const growing = widget(
    'CASTER',
    [
      stat('orange:gizmo:charge:1', 1),
      { kind: 'stat', key: 'a', name: 'orange:gizmo:allow', value: { kind: 'number', value: 1 } },
      { kind: 'stat', key: 'b', name: 'orange:gizmo:allow', value: { kind: 'number', value: 3 }, level: 5 },
    ],
    blockOf('true'),
  );
  const corpus = index(growing, A);
  const at = (progress: number) =>
    deriveCharacter({ ...characterWith(growing), progress }, system(), corpus).preparation[0]?.limit;
  assert.equal(at(4), 1);
  assert.equal(at(5), 4);
});

test('preparing seeds nothing: a prepared element is not something the character has', () => {
  const corpus = index(listCaster(), A, B);
  const derived = deriveCharacter(characterWith(listCaster(), { orange: ['A', 'B'] }), system(), corpus);
  assert.equal(derived.elementIds.has('A'), false);
  assert.equal(derived.elementIds.has('B'), false);
});

// --- the recorded list, and what a save does with it ---------------------------------

test('the recorded list is keyed by the lowercased block name and is absent when empty', () => {
  const base = createCharacter('test', 'pc');
  const one = setPrepared(base, 'Orange', ['A', 'B', 'A']);
  assert.deepEqual(one.prepared, { orange: ['A', 'B'] });
  assert.deepEqual(getPrepared(one, ' ORANGE '), ['A', 'B']);
  const cleared = setPrepared(one, 'orange', []);
  assert.equal('prepared' in cleared && cleared.prepared !== undefined, false);
  assert.deepEqual(getPrepared(cleared, 'orange'), []);
  assert.deepEqual(preparedElementIds(setPrepared(one, 'purple', ['B', 'D'])), ['A', 'B', 'D']);
});

test('a save embeds what was prepared and opens with no source, which a whole list needs (ADR 0012)', () => {
  const caster = listCaster();
  const corpus = index(caster, A, B, E);
  // B and E are named by nothing but the prepared list. Without them in the save a Cleric opens with
  // the names of its prepared spells gone, and the whole list is not somewhere to look them up.
  const character = characterWith(caster, { orange: ['B', 'E'] });
  const content = collectCharacterContent(character, corpus);
  assert.deepEqual(content.elements.map((e) => e.id), ['B', 'CASTER', 'E']);

  const files = packCharacterContainer(character, content, {});
  const { container, problems } = readCharacterContainer(files);
  assert.deepEqual(problems, []);
  assert.deepEqual(container!.character.prepared, { orange: ['B', 'E'] });

  const embedded = new BundleElementIndex(container!.content.elements);
  const derived = deriveCharacter(container!.character, system(), embedded);
  assert.deepEqual(derived.preparation[0]?.chosen, ['B', 'E']);
  assert.deepEqual(derived.preparation[0]?.unavailable, [], 'the embedded elements pass the block filter as they did');
  assert.deepEqual(
    JSON.parse(JSON.stringify(derived.preparation)),
    JSON.parse(JSON.stringify(deriveCharacter(character, system(), corpus).preparation)),
    'zero sources derives the same list as all of them',
  );
});

test('perturbation: without the embed a prepared element is unavailable on reopening', () => {
  const caster = listCaster();
  const corpus = index(caster, A, B);
  const character = characterWith(caster, { orange: ['B'] });
  const withoutPrepared = { ...character, prepared: undefined };
  const content = collectCharacterContent(withoutPrepared, corpus);
  const derived = deriveCharacter(character, system(), new BundleElementIndex(content.elements));
  assert.deepEqual(derived.preparation[0]?.unavailable, ['B']);
});
