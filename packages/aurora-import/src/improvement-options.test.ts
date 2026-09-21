import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createCharacter,
  deriveCharacter,
  MapElementIndex,
  parseSupports,
  type Character,
  type Element,
  type GameSystem,
  type Rule,
  type SelectRule,
} from '@incudo/core';
import { improvementOptionElements } from './improvement-options.ts';
import { auroraGeneratedElements } from './generated-elements.ts';

// Fixtures are shaped like the corpus: a class feature carrying one `<select>` per level that
// grants an improvement, and no element anywhere declaring what those selects offer.

function element(id: string, type: string, rules: Rule[] = [], supports: string[] = []): Element {
  return {
    id,
    type,
    name: id,
    source: 'test',
    setters: {},
    rules,
    supports,
    origin: { sourceId: 'test', format: 'aurora' },
  };
}

function improvementSelect(cls: string, level: number): Rule {
  const name = `Improvement Option (${cls} ${level})`;
  return {
    kind: 'select',
    key: `select:${name}`,
    type: 'Class Feature',
    name,
    supports: parseSupports(`Improvement Option,${cls},${level}`),
    number: 1,
    level,
  };
}

/** The one select an option carries, narrowed so a test can read its fields. */
function onlySelect(option: Element): SelectRule {
  const [rule] = option.rules;
  assert.equal(option.rules.length, 1, `${option.id} carries exactly one rule`);
  assert.equal(rule!.kind, 'select');
  return rule as SelectRule;
}

function classFeature(cls: string, levels: number[]): Element {
  return element(
    `ID_FEATURE_ASI_${cls.toUpperCase()}`,
    'Class Feature',
    levels.map((level) => improvementSelect(cls, level)),
  );
}

test('an option is generated for every class and level that asks for one and nothing declares', () => {
  const { elements, pairs } = improvementOptionElements([
    classFeature('Fighter', [4, 6]),
    classFeature('Wizard', [4]),
  ]);

  assert.equal(pairs, 3);
  assert.deepEqual(
    elements.map((e) => e.id),
    [
      'ID_INTERNAL_CLASS_FEATURE_ASI_4_FIGHTER',
      'ID_INTERNAL_CLASS_FEATURE_ASI_4_WIZARD',
      'ID_INTERNAL_CLASS_FEATURE_ASI_6_FIGHTER',
      'ID_INTERNAL_CLASS_FEATURE_FEAT_4_FIGHTER',
      'ID_INTERNAL_CLASS_FEATURE_FEAT_4_WIZARD',
      'ID_INTERNAL_CLASS_FEATURE_FEAT_6_FIGHTER',
    ],
    'the ids are the ones Aurora records in a save, upper-cased and sorted',
  );
});

test('the shape is what a set of real saves record: ids, select names and the type each offers', () => {
  const { elements } = improvementOptionElements([classFeature('Fighter', [12])]);
  const asi = elements.find((e) => e.id === 'ID_INTERNAL_CLASS_FEATURE_ASI_12_FIGHTER')!;
  const feat = elements.find((e) => e.id === 'ID_INTERNAL_CLASS_FEATURE_FEAT_12_FIGHTER')!;

  // One sample save: `Ability Score Increase (FIGHTER 12)` ×2 under ASI_12_FIGHTER,
  // and `Feat (FIGHTER 4)` under FEAT_4_FIGHTER.
  assert.equal(asi.type, 'Class Feature');
  assert.deepEqual(asi.supports, ['Improvement Option', 'Fighter', '12']);
  const asiSelect = onlySelect(asi);
  assert.equal(asiSelect.name, 'Ability Score Increase (FIGHTER 12)');
  assert.equal(asiSelect.key, 'select:Ability Score Increase (FIGHTER 12)');
  assert.equal(asiSelect.type, 'Ability Score Improvement');
  assert.equal(asiSelect.number, 2, 'one +2 or two +1s is two picks');

  const featSelect = onlySelect(feat);
  assert.equal(featSelect.name, 'Feat (FIGHTER 12)');
  assert.equal(featSelect.type, 'Feat');
  assert.ok(feat.requirements, 'the feat is gated on the campaign option, as the Artificers are');
  assert.equal(asi.requirements, undefined, 'the ability score improvement is not');
});

test('a pair some element already declares is left alone', () => {
  const declared = element('ID_ERLW_ABILITY_4', 'Class Feature', [], [
    'Improvement Option',
    'Eberron Artificer',
    '4',
  ]);
  const { elements, pairs } = improvementOptionElements([
    classFeature('Eberron Artificer', [4, 8]),
    declared,
  ]);
  assert.equal(pairs, 1, 'only level 8 is undeclared');
  assert.deepEqual(
    elements.map((e) => e.id),
    ['ID_INTERNAL_CLASS_FEATURE_ASI_8_EBERRON_ARTIFICER', 'ID_INTERNAL_CLASS_FEATURE_FEAT_8_EBERRON_ARTIFICER'],
  );
});

test('two elements asking for the same pair produce one option, and an existing id is not replaced', () => {
  const twice = improvementOptionElements([classFeature('Fighter', [4]), classFeature('Fighter', [4])]);
  assert.equal(twice.pairs, 1);
  assert.equal(twice.elements.length, 2);

  const present = element('ID_INTERNAL_CLASS_FEATURE_FEAT_4_FIGHTER', 'Class Feature');
  const again = improvementOptionElements([classFeature('Fighter', [4]), present]);
  assert.deepEqual(
    again.elements.map((e) => e.id),
    ['ID_INTERNAL_CLASS_FEATURE_ASI_4_FIGHTER'],
    'a source that declares one wins, the way it wins against the overlay',
  );
});

test('a select that is not an improvement option is ignored', () => {
  const other = element('ID_X', 'Class Feature', [
    {
      kind: 'select',
      key: 'select:Style',
      type: 'Class Feature',
      name: 'Style',
      supports: parseSupports('Fighting Style,Fighter'),
      number: 1,
    },
    {
      kind: 'select',
      key: 'select:Odd',
      type: 'Class Feature',
      name: 'Odd',
      supports: parseSupports('Improvement Option,Fighter,twelve'),
      number: 1,
    },
  ]);
  assert.deepEqual(improvementOptionElements([other]), { elements: [], pairs: 0 });
});

test('the output is deterministic, because saves checksum what the overlay produces', () => {
  const input = [classFeature('Wizard', [8, 4]), classFeature('Fighter', [4])];
  const a = improvementOptionElements(input);
  const b = improvementOptionElements([...input].reverse());
  assert.equal(JSON.stringify(a.elements), JSON.stringify(b.elements));
});

// --- the whole thing, through the engine --------------------------------------------------

function fixtureSystem(repeatableSetter: string | undefined): GameSystem {
  return {
    formatVersion: 1,
    id: 'fixture',
    name: 'Fixture',
    version: '1.0.0',
    elementTypes: [
      { name: 'Class' },
      { name: 'Class Feature' },
      { name: 'Ability Score Improvement' },
      { name: 'Feat' },
      { name: 'Option' },
    ],
    stats: [
      { name: 'strength', default: 10 },
      { name: 'constitution', default: 10 },
    ],
    characterKinds: [
      {
        id: 'pc',
        name: 'PC',
        default: true,
        progression: { kind: 'level', min: 1, max: 20, stat: 'level' },
        elementTypes: ['Class', 'Class Feature', 'Ability Score Improvement', 'Feat', 'Option'],
        repeatableSetter,
        buildSteps: [],
        sheet: { sections: [] },
      },
    ],
  };
}

function level4Fighter(withGeneratedOptions: boolean): MapElementIndex {
  const content = [
    element('ID_CLASS_FIGHTER', 'Class', [
      { kind: 'grant', key: 'grant-0', type: 'Class Feature', id: 'ID_FEATURE_ASI_FIGHTER' },
    ]),
    classFeature('Fighter', [4, 6]),
  ];
  const index = new MapElementIndex();
  index.addAll(auroraGeneratedElements());
  index.addAll(content);
  if (withGeneratedOptions) index.addAll(improvementOptionElements(index.all()).elements);
  return index;
}

function fighter(progress: number, ...choices: Character['choices']): Character {
  const character = { ...createCharacter('fixture', 'pc'), progress };
  character.choices = [{ ruleKey: 'seed', elementIds: ['ID_CLASS_FIGHTER'] }, ...choices];
  return character;
}

const FOUR = 'ID_FEATURE_ASI_FIGHTER/select:Improvement Option (Fighter 4)';
const FOUR_ASI = 'ID_INTERNAL_CLASS_FEATURE_ASI_4_FIGHTER/select:Ability Score Increase (FIGHTER 4)';

test('a level 4 fighter is offered the improvement, and without the generator it is offered nothing', () => {
  const system = fixtureSystem('allow duplicate');

  const before = deriveCharacter(fighter(4), system, level4Fighter(false));
  const stuck = before.pendingChoices.find((c) => c.ruleKey === FOUR)!;
  assert.deepEqual(stuck.candidates, [], 'the bug: a blocking decision with nothing to choose');
  assert.deepEqual(stuck.unresolvedSupports, [], 'and no diagnostic either, because the filter is well-formed');

  const after = deriveCharacter(fighter(4), system, level4Fighter(true));
  const open = after.pendingChoices.find((c) => c.ruleKey === FOUR)!;
  assert.deepEqual(
    open.candidates,
    ['ID_INTERNAL_CLASS_FEATURE_ASI_4_FIGHTER'],
    'the feat is not offered until the campaign uses feats',
  );
  assert.equal(
    after.pendingChoices.some((c) => c.ruleKey.includes('Fighter 6')),
    false,
    'level 6 has not been reached',
  );
});

test('the feat is offered beside it once the campaign option is held', () => {
  const held = deriveCharacter(
    fighter(4, { ruleKey: 'build/options', elementIds: ['ID_INTERNAL_OPTION_ALLOW_FEATS'] }),
    fixtureSystem('allow duplicate'),
    level4Fighter(true),
  );
  assert.deepEqual(held.pendingChoices.find((c) => c.ruleKey === FOUR)!.candidates.sort(), [
    'ID_INTERNAL_CLASS_FEATURE_ASI_4_FIGHTER',
    'ID_INTERNAL_CLASS_FEATURE_FEAT_4_FIGHTER',
  ]);
});

test('taking the improvement offers all six abilities, and the same one twice is +2', () => {
  const system = fixtureSystem('allow duplicate');
  const index = level4Fighter(true);
  const taken = fighter(4, { ruleKey: FOUR, elementIds: ['ID_INTERNAL_CLASS_FEATURE_ASI_4_FIGHTER'] });

  const open = deriveCharacter(taken, system, index).pendingChoices.find((c) => c.ruleKey === FOUR_ASI)!;
  assert.equal(open.remaining, 2);
  assert.deepEqual(
    open.candidates.sort(),
    [
      'ID_INTERNAL_ASI_CHARISMA',
      'ID_INTERNAL_ASI_CONSTITUTION',
      'ID_INTERNAL_ASI_DEXTERITY',
      'ID_INTERNAL_ASI_INTELLIGENCE',
      'ID_INTERNAL_ASI_STRENGTH',
      'ID_INTERNAL_ASI_WISDOM',
    ],
    'the tags `Ability Score Improvement,Class` finally match something',
  );

  const one = deriveCharacter(
    fighter(4, { ruleKey: FOUR, elementIds: ['ID_INTERNAL_CLASS_FEATURE_ASI_4_FIGHTER'] }, {
      ruleKey: FOUR_ASI,
      elementIds: ['ID_INTERNAL_ASI_CONSTITUTION'],
    }),
    system,
    index,
  );
  const second = one.pendingChoices.find((c) => c.ruleKey === FOUR_ASI)!;
  assert.equal(second.remaining, 1);
  assert.ok(
    second.candidates.includes('ID_INTERNAL_ASI_CONSTITUTION'),
    'Constitution is offered again, which is what makes +2 possible',
  );

  const plusTwo = deriveCharacter(
    fighter(4, { ruleKey: FOUR, elementIds: ['ID_INTERNAL_CLASS_FEATURE_ASI_4_FIGHTER'] }, {
      ruleKey: FOUR_ASI,
      elementIds: ['ID_INTERNAL_ASI_CONSTITUTION', 'ID_INTERNAL_ASI_CONSTITUTION'],
    }),
    system,
    index,
  );
  assert.equal(plusTwo.stats.get('constitution')!.value, 12);
  assert.equal(plusTwo.stats.get('strength')!.value, 10);
  assert.deepEqual(plusTwo.problems, []);
  assert.deepEqual(plusTwo.pendingChoices, [], 'nothing is owed at level 4 any more');

  const split = deriveCharacter(
    fighter(4, { ruleKey: FOUR, elementIds: ['ID_INTERNAL_CLASS_FEATURE_ASI_4_FIGHTER'] }, {
      ruleKey: FOUR_ASI,
      elementIds: ['ID_INTERNAL_ASI_CONSTITUTION', 'ID_INTERNAL_ASI_STRENGTH'],
    }),
    system,
    index,
  );
  assert.equal(split.stats.get('constitution')!.value, 11);
  assert.equal(split.stats.get('strength')!.value, 11);
});

test('without the repeatable setter the same +2 lands as +1 — the perturbation', () => {
  // Only the kind changes. If this reads 12, the +2 was never coming from the declaration.
  const plusTwo = deriveCharacter(
    fighter(4, { ruleKey: FOUR, elementIds: ['ID_INTERNAL_CLASS_FEATURE_ASI_4_FIGHTER'] }, {
      ruleKey: FOUR_ASI,
      elementIds: ['ID_INTERNAL_ASI_CONSTITUTION', 'ID_INTERNAL_ASI_CONSTITUTION'],
    }),
    fixtureSystem(undefined),
    level4Fighter(true),
  );
  assert.equal(plusTwo.stats.get('constitution')!.value, 11);
});
