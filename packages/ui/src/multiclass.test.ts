/**
 * Which class each level was spent on — ADR 0036.
 *
 * No game in the fixture, for the reason `use-character-builder.test.ts` gives: a "Widget" that
 * governs a level is a class in 5e and the builder cannot tell. What is modelled is the shape the
 * corpus has, measured on the real files: a class element with a `multiclass` block whose id is
 * an element of its own, a full proficiency set gated on `!<that id>`, and a marker the
 * multiclass element grants. The real corpus is exercised against the real oracle in
 * `tools/verify/src/multiclass.test.ts`.
 *
 * Every test here was written to fail if the behaviour it names is removed, and the ones that
 * matter were checked by removing it — a green run on a change whose tests could not have failed
 * is how ADR 0030's "a filter resolving to everything moves no count" stayed invisible.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createCharacter,
  deriveCharacter,
  parseRequirements,
  MapElementIndex,
  setBaseStat,
  type Character,
  type Element,
  type GameSystem,
  type Rule,
  type Setter,
} from '@incudo/core';
import { CharacterBuilder } from './use-character-builder.ts';
import { multiclassRuleKey, scoreLabel, type MulticlassConfig } from './multiclass.ts';

// --- fixture ----------------------------------------------------------------------------

function element(
  id: string,
  type: string,
  rules: Rule[] = [],
  setters: Record<string, Setter> = {},
  extra: Partial<Element> = {},
): Element {
  return {
    id,
    type,
    name: id,
    source: 'test',
    setters,
    rules,
    supports: [],
    origin: { sourceId: 'test', format: 'incudo' },
    ...extra,
  };
}

const req = (text: string) => parseRequirements(text);

function grant(id: string, requirements?: string, level?: number): Rule {
  return {
    kind: 'grant',
    key: `g:${id}`,
    type: 'Gadget',
    id,
    ...(requirements ? { requirements: req(requirements) } : {}),
    ...(level ? { level } : {}),
  };
}

/**
 * A class as the corpus writes one: its full kit is gated on `!<its multiclass id>`, and the
 * multiclass element it declares is a separate element that grants a marker.
 */
function widgetClass(
  id: string,
  name: string,
  die: string,
  block?: { requirements: string; prerequisite: string; id: string },
  rules: Rule[] = [],
): Element[] {
  const mcId = block?.id ?? `MC_${id}`;
  const cls = element(
    id,
    'Widget',
    [grant(`KIT_${id}`, `!${mcId}`), ...rules],
    { hd: { value: die } },
    {
      name,
      ...(block
        ? {
            multiclass: {
              id: mcId,
              prerequisite: block.prerequisite,
              requirements: req(block.requirements),
              setters: {},
              rules: [grant(`MULTI_${id}`)],
            },
          }
        : {}),
    },
  );
  const out = [cls, element(`KIT_${id}`, 'Gadget'), element(`MULTI_${id}`, 'Gadget')];
  if (block) out.push(element(mcId, 'Multiclass', [grant(`MULTI_${id}`)]));
  return out;
}

function corpus(): MapElementIndex {
  const index = new MapElementIndex();
  index.addAll([
    ...widgetClass('FIGHTER', 'Fighter', 'd10', {
      id: 'MC_FIGHTER',
      requirements: '[vigour:13]',
      prerequisite: 'Vigour 13',
    }),
    // A second class with the same die, so a level moved between the two keeps its roll.
    ...widgetClass('RANGER', 'Ranger', 'd10', {
      id: 'MC_RANGER',
      requirements: '[vigour:13]',
      prerequisite: 'Vigour 13',
    }),
    ...widgetClass(
      'MAGE',
      'Mage',
      'd6',
      { id: 'MC_MAGE', requirements: '[grit:13]', prerequisite: 'Grit 13' },
      // Opens at the class's own second level, so it is the "decision a level opens" case.
      [{ kind: 'select', key: 'trick', type: 'Gadget', name: 'Trick', number: 1, level: 2 }],
    ),
    // The other edition of Ranger: content forbids taking it beside the first, exactly as
    // `!(ID_…_CLASS_X||ID_…_MULTICLASS_X)` does across the corpus's 2014/2024 pairs.
    ...widgetClass('RANGER_NEW', 'Ranger (new)', 'd10', {
      id: 'MC_RANGER_NEW',
      requirements: '[vigour:13],!(RANGER||MC_RANGER)',
      prerequisite: 'Vigour 13',
    }),
    // Two shapes of minimum the corpus writes: either of two scores, and both of two.
    ...widgetClass('ROGUE', 'Rogue', 'd8', {
      id: 'MC_ROGUE',
      requirements: '([vigour:15]||[grit:15])',
      prerequisite: 'Vigour 15 or Grit 15',
    }),
    ...widgetClass('PALADIN', 'Paladin', 'd10', {
      id: 'MC_PALADIN',
      requirements: '([vigour:15],[grit:15])',
      prerequisite: 'Vigour 15 and Grit 15',
    }),
    // One class that declares no way to be taken second — the UA Mystic's shape.
    ...widgetClass('LONER', 'Loner', 'd8'),
    element('TRICK_A', 'Gadget'),
    element('TRICK_B', 'Gadget'),
  ]);
  for (let n = 1; n <= 20; n += 1) index.add(element(`LVL_${n}`, 'Gadget'));
  return index;
}

function system(withLevelRoll = true): GameSystem {
  return {
    formatVersion: 1,
    id: 'test',
    name: 'Test',
    version: '1.0.0',
    elementTypes: [{ name: 'Widget' }, { name: 'Gadget' }, { name: 'Multiclass' }],
    stats: [
      { name: 'vigour', default: 10 },
      { name: 'grit', default: 10 },
    ],
    characterKinds: [
      {
        id: 'pc',
        name: 'PC',
        default: true,
        progression: {
          kind: 'level',
          min: 1,
          max: 20,
          stat: 'level',
          elementIdPattern: 'LVL_{n}',
          trackStatPattern: 'level:{name}',
        },
        elementTypes: ['Widget', 'Gadget', 'Multiclass'],
        buildSteps: [
          { id: 'kit', label: 'Kit', types: ['Widget'], required: true },
          {
            id: 'levels',
            label: 'Levels',
            types: ['Widget'],
            perLevel: true,
            requires: ['kit'],
            ...(withLevelRoll
              ? { levelRoll: { pattern: 'hp:level:{n}', dieSetter: 'hd', classType: 'Widget' } }
              : {}),
          },
        ],
        sheet: { sections: [{ id: 's', label: 'S', stats: ['vigour'] }] },
      },
    ],
  };
}

/** A builder holding a level `progress` Fighter with the given ability scores. */
function fighter(progress: number, scores: { vigour?: number; grit?: number } = {}) {
  let character: Character = createCharacter('test', 'pc', { progress });
  character = setBaseStat(character, 'vigour', scores.vigour ?? 14);
  character = setBaseStat(character, 'grit', scores.grit ?? 14);
  const b = new CharacterBuilder(character, system(), corpus());
  b.choose('build/kit', ['FIGHTER']);
  return b;
}

const classes = (b: CharacterBuilder) =>
  b.classLevelsFor('levels')!.levels.map((row) => row.classId);
const ids = (b: CharacterBuilder) => new Set(b.getState().derived.elements.map((e) => e.id));
const advancementOf = (b: CharacterBuilder) =>
  b.getState().character.advancement?.map((entry) => `${entry.at}:${entry.elementId}`);
const multiclassRecords = (b: CharacterBuilder) =>
  b
    .getState()
    .character.choices.filter((c) => c.ruleKey.includes('select:Multiclass'))
    .map((c) => `${c.ruleKey}=${c.elementIds.join(',')}`);

const CONFIG: MulticlassConfig = {
  classType: 'Widget',
  levelRoll: { pattern: 'hp:level:{n}', dieSetter: 'hd', classType: 'Widget' },
  levelElementPattern: 'LVL_{n}',
  min: 1,
  max: 20,
};

// --- what a step publishes ---------------------------------------------------------------

test('a step with no levelRoll publishes no class levels, and a kind with none is untouched', () => {
  const b = new CharacterBuilder(createCharacter('test', 'pc', { progress: 3 }), system(false), corpus());
  assert.equal(b.classLevelsFor('levels'), undefined);
  assert.equal(b.classLevelsFor('kit'), undefined);
  assert.equal(b.setLevelClass('levels', 2, 'MAGE'), false);
  assert.equal(b.addLevel('levels', 'MAGE'), false);
  b.setProgress(5);
  assert.equal(b.getState().character.progress, 5, 'setProgress is still just a number here');
  assert.equal(b.getState().character.advancement, undefined);
});

test('nothing is offered before a first class exists', () => {
  const b = new CharacterBuilder(createCharacter('test', 'pc', { progress: 3 }), system(), corpus());
  const state = b.classLevelsFor('levels')!;
  assert.equal(state.firstClassId, undefined);
  assert.deepEqual(state.options, [], 'multiclassing is a second class, and there is no first');
  assert.equal(b.setLevelClass('levels', 2, 'MAGE'), false);
});

test('a single-class character has one class on every level and carries no advancement', () => {
  const b = fighter(4);
  const state = b.classLevelsFor('levels')!;
  assert.equal(state.firstClassId, 'FIGHTER');
  assert.deepEqual(classes(b), ['FIGHTER', 'FIGHTER', 'FIGHTER', 'FIGHTER']);
  assert.deepEqual(state.levels.map((row) => row.classLevel), [1, 2, 3, 4]);
  assert.deepEqual(state.classes, [{ id: 'FIGHTER', levels: 4 }]);
  assert.equal(b.getState().character.advancement, undefined);
  assert.equal(state.levels[0]!.first, true);
  assert.equal(state.levels[1]!.first, false);
});

// --- eligibility -------------------------------------------------------------------------

test('a class is offered when its block is met, and flags the scores when they are short', () => {
  const met = fighter(3, { grit: 14 }).classLevelsFor('levels')!.options;
  const mage = met.find((o) => o.id === 'MAGE')!;
  assert.equal(mage.eligible, true);
  assert.equal(mage.taken, false);

  const unmet = fighter(3, { grit: 12 }).classLevelsFor('levels')!.options.find((o) => o.id === 'MAGE')!;
  // ADR 0045: a short ability score does not stop the class being taken, it is reported.
  assert.equal(unmet.eligible, true);
  assert.equal(unmet.unavailable, undefined);
  assert.deepEqual(unmet.flag, [[{ stat: 'grit', needs: 13, has: 12 }]]);
  assert.equal(unmet.prerequisite, 'Grit 13', 'the block\'s own words, for the shell to quote');
});

test('a class with no multiclass block is listed as unavailable rather than hidden', () => {
  const loner = fighter(3).classLevelsFor('levels')!.options.find((o) => o.id === 'LONER')!;
  assert.equal(loner.eligible, false);
  assert.equal(loner.unavailable, 'no-multiclass-rules');
  assert.equal(loner.prerequisite, undefined);
});

test('a class the character already has is never gated', () => {
  // Grit 12 fails Mage's block. Once the Mage is held, another Mage level is not a multiclass.
  const b = fighter(3, { grit: 14 });
  assert.equal(b.setLevelClass('levels', 3, 'MAGE'), true);
  b.setBaseStat('grit', 8);
  const mage = b.classLevelsFor('levels')!.options.find((o) => o.id === 'MAGE')!;
  assert.equal(mage.taken, true);
  assert.equal(mage.eligible, true, 'the entry gate is not a running condition');
  assert.equal(b.addLevel('levels', 'MAGE'), true);
});

test('the other edition of a class you hold is ineligible, from content\'s own expression', () => {
  const options = fighter(3).classLevelsFor('levels')!.options;
  assert.equal(options.find((o) => o.id === 'RANGER_NEW')!.eligible, true, 'no Ranger held yet');

  const b = fighter(3);
  assert.equal(b.setLevelClass('levels', 2, 'RANGER'), true);
  const now = b.classLevelsFor('levels')!.options.find((o) => o.id === 'RANGER_NEW')!;
  assert.equal(now.eligible, false, '`!(RANGER||MC_RANGER)` is false the moment a Ranger is held');
  assert.equal(b.setLevelClass('levels', 3, 'RANGER_NEW'), false);
});

test('an edition exclusion says so, instead of blaming an ability score the character meets', () => {
  // Vigour 14 meets the "Vigour 13" the block names, so reading its prerequisite as the reason is
  // wrong — the term that failed is the negated `has`.
  const b = fighter(3, { vigour: 14 });
  b.setLevelClass('levels', 2, 'RANGER');
  const excluded = b.classLevelsFor('levels')!.options.find((o) => o.id === 'RANGER_NEW')!;
  assert.equal(excluded.unavailable, 'excluded');
  assert.equal(excluded.excludedBy, 'RANGER');
  assert.equal(excluded.prerequisite, 'Vigour 13', 'the block\'s words are still there to quote');

  // And a shortfall stays a shortfall: no exclusion is invented where nothing is held.
  const short = fighter(3, { vigour: 14, grit: 8 }).classLevelsFor('levels')!.options.find((o) => o.id === 'MAGE')!;
  assert.equal(short.unavailable, undefined);
  assert.equal(short.excludedBy, undefined);
  assert.deepEqual(short.flag, [[{ stat: 'grit', needs: 13, has: 8 }]]);
});

test('a short score is taken and flagged, and the flag clears when the score rises (ADR 0045)', () => {
  const b = fighter(4, { grit: 12 });
  const mage = () => b.classLevelsFor('levels')!.options.find((o) => o.id === 'MAGE')!;

  assert.equal(b.setLevelClass('levels', 3, 'MAGE'), true, 'Grit 12 is short of 13, and the level is spent anyway');
  assert.equal(mage().taken, true);
  assert.deepEqual(mage().flag, [[{ stat: 'grit', needs: 13, has: 12 }]], 'a class already held still shows it');
  assert.deepEqual(multiclassRecords(b).length, 1, 'both records are written, as for any second class');

  b.setBaseStat('grit', 13);
  assert.equal(mage().flag, undefined, 'nothing is stored, so it clears the moment the score is met');
  b.setBaseStat('grit', 9);
  assert.deepEqual(mage().flag, [[{ stat: 'grit', needs: 13, has: 9 }]]);
});

test('the first class is never flagged', () => {
  const b = fighter(3, { vigour: 6 });
  assert.equal(b.classLevelsFor('levels')!.options.find((o) => o.id === 'FIGHTER')!.flag, undefined);
});

test('an "either" minimum reports the closest alternative, and every one that ties', () => {
  const at = (scores: { vigour: number; grit: number }) =>
    fighter(3, scores).classLevelsFor('levels')!.options.find((o) => o.id === 'ROGUE')!;

  assert.deepEqual(at({ vigour: 12, grit: 14 }).flag, [[{ stat: 'grit', needs: 15, has: 14 }]], 'one short beats three short');
  assert.deepEqual(at({ vigour: 13, grit: 13 }).flag, [
    [{ stat: 'vigour', needs: 15, has: 13 }],
    [{ stat: 'grit', needs: 15, has: 13 }],
  ]);
  assert.equal(at({ vigour: 15, grit: 8 }).flag, undefined, 'either one meets it');
  assert.equal(at({ vigour: 13, grit: 13 }).eligible, true);
});

test('a "both" minimum reports every score that is short, and only those', () => {
  const at = (scores: { vigour: number; grit: number }) =>
    fighter(3, scores).classLevelsFor('levels')!.options.find((o) => o.id === 'PALADIN')!;

  assert.deepEqual(at({ vigour: 16, grit: 12 }).flag, [[{ stat: 'grit', needs: 15, has: 12 }]]);
  assert.deepEqual(at({ vigour: 12, grit: 12 }).flag, [
    [
      { stat: 'vigour', needs: 15, has: 12 },
      { stat: 'grit', needs: 15, has: 12 },
    ],
  ]);
  assert.equal(at({ vigour: 15, grit: 15 }).flag, undefined);
});

test('only ability scores are soft: a non-score term still refuses, at any score', () => {
  // Perturbation of the rule itself. The other edition is refused for a held element, and no
  // amount of Vigour changes that; a short score beside it is not what is reported.
  const b = fighter(3, { vigour: 20 });
  b.setLevelClass('levels', 2, 'RANGER');
  const now = b.classLevelsFor('levels')!.options.find((o) => o.id === 'RANGER_NEW')!;
  assert.equal(now.eligible, false);
  assert.equal(now.unavailable, 'excluded');
  assert.equal(now.flag, undefined);

  const loner = fighter(3, { vigour: 20, grit: 20 }).classLevelsFor('levels')!.options.find((o) => o.id === 'LONER')!;
  assert.equal(loner.eligible, false);
  assert.equal(loner.unavailable, 'no-multiclass-rules');
});

// --- writing a level ---------------------------------------------------------------------

test('spending a level on a second class writes advancement AND its multiclass element', () => {
  const b = fighter(3);
  assert.equal(b.setLevelClass('levels', 3, 'MAGE'), true);

  assert.deepEqual(advancementOf(b), ['1:FIGHTER', '2:FIGHTER', '3:MAGE']);
  assert.deepEqual(multiclassRecords(b), ['LVL_3/select:Multiclass (Level 3)=MC_MAGE']);
  assert.deepEqual(classes(b), ['FIGHTER', 'FIGHTER', 'MAGE']);
  assert.deepEqual(b.classLevelsFor('levels')!.classes, [
    { id: 'FIGHTER', levels: 2 },
    { id: 'MAGE', levels: 1 },
  ]);

  const held = ids(b);
  // The element that makes a class a *second* class. Drop the record and keep advancement, and
  // this is exactly what goes missing — ADR 0036's measurement on the real oracle.
  assert.ok(held.has('MC_MAGE'));
  assert.ok(held.has('MULTI_MAGE'), 'and what the block grants');
  assert.equal(held.has('KIT_MAGE'), false, 'the first-class kit is switched off by it');
  assert.ok(held.has('KIT_FIGHTER'), 'the first class keeps its own');
  assert.equal(held.has('MC_FIGHTER'), false, 'the first class is never given a multiclass element');

  const stats = b.getState().derived.stats;
  assert.equal(stats.get('level:fighter')?.value, 2);
  assert.equal(stats.get('level:mage')?.value, 1, 'the track exists, so `level:mage` reads');
});

test('a second class as the FIRST class gets its full kit and no multiclass element', () => {
  // The control for the test above: same class, first position.
  const b = new CharacterBuilder(
    setBaseStat(createCharacter('test', 'pc', { progress: 1 }), 'grit', 14),
    system(),
    corpus(),
  );
  b.choose('build/kit', ['MAGE']);
  assert.ok(ids(b).has('KIT_MAGE'));
  assert.equal(ids(b).has('MC_MAGE'), false);
  assert.deepEqual(multiclassRecords(b), []);
});

test('the requests a state does not support are refused, and refusing writes nothing', () => {
  const b = fighter(4, { grit: 12 });
  const before = b.getState().character;

  assert.equal(b.setLevelClass('levels', 1, 'RANGER'), false, 'level 1 is the first class');
  assert.equal(b.setLevelClass('levels', 5, 'RANGER'), false, 'past the progression');
  assert.equal(b.setLevelClass('levels', 0, 'RANGER'), false);
  assert.equal(b.setLevelClass('levels', 2.5, 'RANGER'), false);
  assert.equal(b.setLevelClass('levels', 3, 'LONER'), false, 'no multiclass block');
  assert.equal(b.setLevelClass('levels', 3, 'TRICK_A'), false, 'not a class at all');
  assert.equal(b.setLevelClass('levels', 3, 'NOWHERE'), false);
  assert.equal(b.setLevelClass('kit', 3, 'RANGER'), false, 'not the step that publishes levels');

  assert.equal(b.getState().character, before, 'the very same character object');
});

test('asking for the class a level already has is a no-op that says yes', () => {
  const b = fighter(3);
  const before = b.getState().character;
  assert.equal(b.setLevelClass('levels', 2, 'FIGHTER'), true);
  assert.equal(b.getState().character, before);
});

test('moving every level back to the first class removes both records', () => {
  const b = fighter(3);
  b.setLevelClass('levels', 3, 'MAGE');
  assert.equal(b.setLevelClass('levels', 3, 'FIGHTER'), true);

  assert.equal(b.getState().character.advancement, undefined, 'one class again: no array');
  assert.deepEqual(multiclassRecords(b), []);
  assert.equal(ids(b).has('MC_MAGE'), false);
});

test('a class whose levels are all moved away leaves with its record, and the others stay', () => {
  const b = fighter(4);
  b.setLevelClass('levels', 3, 'MAGE');
  b.setLevelClass('levels', 4, 'RANGER');
  assert.equal(multiclassRecords(b).length, 2);

  b.setLevelClass('levels', 3, 'FIGHTER');
  assert.deepEqual(advancementOf(b), ['1:FIGHTER', '2:FIGHTER', '3:FIGHTER', '4:RANGER']);
  assert.deepEqual(multiclassRecords(b), ['LVL_4/select:Multiclass (Level 4)=MC_RANGER']);
});

test('the record follows the first level a class was taken at', () => {
  const b = fighter(3);
  b.setLevelClass('levels', 2, 'MAGE');
  b.setLevelClass('levels', 3, 'MAGE');
  assert.deepEqual(multiclassRecords(b), ['LVL_2/select:Multiclass (Level 2)=MC_MAGE']);

  b.setLevelClass('levels', 2, 'FIGHTER');
  assert.deepEqual(
    multiclassRecords(b),
    ['LVL_3/select:Multiclass (Level 3)=MC_MAGE'],
    're-keyed to level 3, not duplicated and not left at level 2',
  );
});

test('a record found by what it holds is repaired, not duplicated, when its key differs', () => {
  const b = fighter(3);
  // A save whose author keyed the same fact some other way.
  b.choose('some/other/key', ['MC_MAGE']);
  b.setLevelClass('levels', 3, 'MAGE');
  assert.deepEqual(multiclassRecords(b), ['LVL_3/select:Multiclass (Level 3)=MC_MAGE']);
  assert.equal(
    b.getState().character.choices.some((c) => c.ruleKey === 'some/other/key'),
    false,
    'the stray record is the builder\'s to keep in step',
  );
});

test('a choice that merely mentions a class is not a multiclass record and is left alone', () => {
  const b = fighter(3);
  b.choose('build/unrelated', ['TRICK_A']);
  b.setLevelClass('levels', 3, 'MAGE');
  b.setLevelClass('levels', 3, 'FIGHTER');
  assert.deepEqual(
    b.getState().character.choices.filter((c) => c.ruleKey === 'build/unrelated').map((c) => c.elementIds),
    [['TRICK_A']],
  );
});

// --- level up ----------------------------------------------------------------------------

test('addLevel grows the progression and spends the new level in one step', () => {
  const b = fighter(3);
  let notifications = 0;
  b.subscribe(() => (notifications += 1));

  assert.equal(b.addLevel('levels', 'MAGE'), true);
  assert.equal(b.getState().character.progress, 4);
  assert.deepEqual(classes(b), ['FIGHTER', 'FIGHTER', 'FIGHTER', 'MAGE']);
  assert.deepEqual(multiclassRecords(b), ['LVL_4/select:Multiclass (Level 4)=MC_MAGE']);
  assert.equal(notifications, 1, 'one write, so nobody sees level 4 in a class nobody picked');
});

test('addLevel in the first class of a single-class character writes no advancement', () => {
  const b = fighter(3);
  assert.equal(b.addLevel('levels', 'FIGHTER'), true);
  assert.equal(b.getState().character.progress, 4);
  assert.equal(b.getState().character.advancement, undefined);
});

test('addLevel is refused at the top of the progression and for a class with no multiclass rules', () => {
  const top = fighter(20);
  assert.equal(top.classLevelsFor('levels')!.canAddLevel, false);
  assert.equal(top.addLevel('levels', 'FIGHTER'), false);
  assert.equal(top.getState().character.progress, 20);

  const b = fighter(3, { grit: 10 });
  assert.equal(b.addLevel('levels', 'LONER'), false);
  assert.equal(b.getState().character.progress, 3, 'a refused level does not grow the character');

  // A short score is not a refusal (ADR 0045): the level is spent and the class carries the flag.
  assert.equal(b.addLevel('levels', 'MAGE'), true);
  assert.deepEqual(
    b.classLevelsFor('levels')!.options.find((o) => o.id === 'MAGE')!.flag,
    [[{ stat: 'grit', needs: 13, has: 10 }]],
  );
});

// --- setProgress keeps advancement in step -----------------------------------------------

test('raising the level continues the class of the last level', () => {
  const b = fighter(3);
  b.setLevelClass('levels', 3, 'MAGE');
  b.setProgress(5);
  assert.deepEqual(classes(b), ['FIGHTER', 'FIGHTER', 'MAGE', 'MAGE', 'MAGE']);
  assert.equal(b.getState().derived.stats.get('level:mage')?.value, 3);
  assert.equal(multiclassRecords(b).length, 1);
});

test('lowering the level drops the levels that are gone, and a class with none goes with them', () => {
  const b = fighter(4);
  b.setLevelClass('levels', 3, 'MAGE');
  b.setLevelClass('levels', 4, 'MAGE');
  b.setProgress(2);

  assert.equal(b.getState().character.advancement, undefined, 'one class left: no array');
  assert.deepEqual(multiclassRecords(b), []);
  assert.equal(ids(b).has('MC_MAGE'), false);

  b.setProgress(4);
  assert.deepEqual(classes(b), ['FIGHTER', 'FIGHTER', 'FIGHTER', 'FIGHTER'], 'and does not come back');
});

test('lowering keeps a class that still has a level', () => {
  const b = fighter(5);
  b.setLevelClass('levels', 3, 'MAGE');
  b.setLevelClass('levels', 5, 'MAGE');
  b.setProgress(4);
  assert.deepEqual(advancementOf(b), ['1:FIGHTER', '2:FIGHTER', '3:MAGE', '4:FIGHTER']);
  assert.deepEqual(multiclassRecords(b), ['LVL_3/select:Multiclass (Level 3)=MC_MAGE']);
});

test('a single-class character\'s progress is only a number', () => {
  const b = fighter(3);
  b.setProgress(8);
  assert.equal(b.getState().character.progress, 8);
  assert.equal(b.getState().character.advancement, undefined);
  assert.deepEqual(multiclassRecords(b), []);
  b.setProgress(0);
  assert.equal(b.getState().character.progress, 1, 'still clamped to the progression');
});

// --- the first class ---------------------------------------------------------------------

test('choosing a different first class re-homes every level the old one held', () => {
  const b = fighter(4);
  b.setLevelClass('levels', 3, 'MAGE');
  b.setLevelClass('levels', 4, 'MAGE');
  b.choose('build/kit', ['RANGER']);

  assert.deepEqual(advancementOf(b), ['1:RANGER', '2:RANGER', '3:MAGE', '4:MAGE']);
  assert.equal(b.classLevelsFor('levels')!.firstClassId, 'RANGER');
  assert.deepEqual(multiclassRecords(b), ['LVL_3/select:Multiclass (Level 3)=MC_MAGE']);
});

test('choosing the other class as the first collapses the two into one', () => {
  const b = fighter(3);
  b.setLevelClass('levels', 3, 'MAGE');
  b.choose('build/kit', ['MAGE']);

  assert.equal(b.getState().character.advancement, undefined);
  assert.deepEqual(multiclassRecords(b), [], 'the first class never carries its multiclass element');
  assert.ok(ids(b).has('KIT_MAGE'));
});

// --- hit points --------------------------------------------------------------------------

test('a roll made on a different die is cleared when its level moves, and the decision reopens', () => {
  const b = fighter(3);
  b.recordHitPoints('levels', 1, 'average');
  b.recordHitPoints('levels', 2, 'average'); // d10 -> 6
  b.recordHitPoints('levels', 3, 'average'); // d10 -> 6
  b.confirmHitPoints('levels');
  assert.equal(b.getState().character.rolls['hp:level:3'], 6);
  assert.equal(b.getState().decisions.some((d) => d.kind === 'hitpoints'), false);

  b.setLevelClass('levels', 3, 'MAGE'); // a d6
  assert.equal(b.getState().character.rolls['hp:level:3'], undefined, 'a 6 on a d10 is not a d6 roll');
  assert.equal(b.getState().character.rolls['hp:level:2'], 6, 'other levels are untouched');
  const hp = b.hitPointsFor('levels')!;
  assert.equal(hp.levels[2]!.dieSides, 6, 'the editor now reads the Mage\'s die for level 3');
  assert.deepEqual(hp.pending.map((l) => l.level), [3]);
  assert.equal(b.getState().decisions.some((d) => d.kind === 'hitpoints'), true);
});

test('a roll survives a move between two classes with the same die', () => {
  const b = fighter(3);
  b.recordHitPoints('levels', 1, 'average');
  b.recordHitPoints('levels', 2, 'average');
  b.recordHitPoints('levels', 3, 'average');
  b.setLevelClass('levels', 3, 'RANGER'); // d10 -> d10
  assert.equal(b.getState().character.rolls['hp:level:3'], 6);
});

test('a level-up in a chosen class keeps a roll already recorded for that level', () => {
  // Rolls survive a level being lowered away (ADR 0007), so level 4 can already hold one. The
  // level was never the Fighter's — it comes into being as the Mage's — so no change of die has
  // happened. Even a 9, which no d6 makes, is kept: the oracle save itself records a 10 at a level
  // whose die is a d8, so a value above the die is something real saves hold, and deleting it on
  // a plausibility guess would be destroying the user's data to tidy a number.
  const b = fighter(3);
  b.recordRoll('hp:level:4', 9);
  assert.equal(b.addLevel('levels', 'MAGE'), true);
  assert.equal(b.getState().character.rolls['hp:level:4'], 9);
});

// --- decisions ---------------------------------------------------------------------------

test('what a second class opens arrives in the same flat list, tagged with the level in its own track', () => {
  const b = fighter(4);
  b.setLevelClass('levels', 3, 'MAGE');
  assert.equal(
    b.getState().decisions.some((d) => d.label === 'Trick'),
    false,
    'Mage level 1: the trick opens at Mage level 2',
  );

  b.setLevelClass('levels', 4, 'MAGE');
  const trick = b.getState().decisions.find((d) => d.label === 'Trick')!;
  assert.ok(trick, 'arrives with no navigation and no step to go to');
  assert.equal(trick.from, 'MAGE');
  assert.equal(trick.openedAt, 2, 'Mage 2, though the character is level 4');
  assert.equal(trick.blocking, true);
  assert.equal('currentStepId' in b.getState(), false, 'there is still no cursor (ADR 0017)');
});

// --- an imported character --------------------------------------------------------------

/** A multiclass character shaped as an Aurora import writes it: class under `LVL_1/select:Class`. */
function imported(): Character {
  let character = createCharacter('test', 'pc', { progress: 4 });
  character = setBaseStat(setBaseStat(character, 'vigour', 14), 'grit', 14);
  return {
    ...character,
    choices: [
      { ruleKey: 'LVL_1/select:Class', elementIds: ['FIGHTER'] },
      { ruleKey: 'LVL_3/select:Multiclass (Level 3)', elementIds: ['MC_MAGE'] },
    ],
    advancement: [
      { at: 1, elementId: 'FIGHTER' },
      { at: 2, elementId: 'FIGHTER' },
      { at: 3, elementId: 'MAGE' },
      { at: 4, elementId: 'MAGE' },
    ],
  };
}

test('an imported multiclass character is read and edited without a duplicate record', () => {
  const b = new CharacterBuilder(imported(), system(), corpus());
  const state = b.classLevelsFor('levels')!;
  assert.equal(state.firstClassId, 'FIGHTER', 'found by content: the class is not under build/kit');
  assert.deepEqual(state.classes, [
    { id: 'FIGHTER', levels: 2 },
    { id: 'MAGE', levels: 2 },
  ]);

  b.setLevelClass('levels', 4, 'RANGER');
  assert.deepEqual(multiclassRecords(b), [
    'LVL_3/select:Multiclass (Level 3)=MC_MAGE',
    'LVL_4/select:Multiclass (Level 4)=MC_RANGER',
  ]);
  assert.equal(
    b.getState().character.choices.filter((c) => c.ruleKey === 'LVL_1/select:Class').length,
    1,
    'the class choice under Aurora\'s key is not the builder\'s to touch',
  );
});

test('changing an imported first class re-homes its levels, though it is not under build/kit', () => {
  // The class pick used to be recognised by its key alone, so on the characters this exists for
  // the change wrote a second class record and never re-homed anything. Perturbation: compare
  // the key with `build/<stepId>` again and `advancement` keeps the old class.
  const b = new CharacterBuilder(imported(), system(), corpus());
  const pick = b.getState().picks.find((p) => p.stepId === 'kit')!;
  assert.equal(pick.ruleKey, 'LVL_1/select:Class');
  b.choose(pick.ruleKey, ['RANGER']);

  assert.deepEqual(advancementOf(b), ['1:RANGER', '2:RANGER', '3:MAGE', '4:MAGE']);
  assert.deepEqual(
    b.getState().character.choices.filter((c) => c.elementIds.includes('RANGER')).map((c) => c.ruleKey),
    ['LVL_1/select:Class'],
    'one class record, in place',
  );
  assert.equal(b.classLevelsFor('levels')!.firstClassId, 'RANGER');
  assert.deepEqual(multiclassRecords(b), ['LVL_3/select:Multiclass (Level 3)=MC_MAGE']);
});

test('a level an import could not attribute is reported and never filled in', () => {
  const partial: Character = {
    ...imported(),
    advancement: [
      { at: 1, elementId: 'FIGHTER' },
      { at: 2, elementId: 'FIGHTER' },
    ],
    choices: [{ ruleKey: 'LVL_1/select:Class', elementIds: ['FIGHTER'] }],
  };
  const b = new CharacterBuilder(partial, system(), corpus());
  assert.deepEqual(b.classLevelsFor('levels')!.unassigned, [3, 4]);
  assert.equal(b.classLevelsFor('levels')!.levels[2]!.classId, undefined);

  b.setProgress(4);
  assert.deepEqual(b.classLevelsFor('levels')!.unassigned, [3, 4], 'an unrelated edit leaves them alone');
  assert.equal(b.getState().character.advancement!.length, 2);

  assert.equal(b.setLevelClass('levels', 3, 'FIGHTER'), true, 'and choosing a class spends one');
  assert.deepEqual(b.classLevelsFor('levels')!.unassigned, [4]);
});

// --- keys --------------------------------------------------------------------------------

test('the record key is the one an Aurora import writes', () => {
  assert.equal(multiclassRuleKey(CONFIG, 3), 'LVL_3/select:Multiclass (Level 3)');
  const { levelElementPattern: _omit, ...bare } = CONFIG;
  assert.equal(multiclassRuleKey(bare, 3), 'progress:3/select:Multiclass (Level 3)');
});

// --- the derivation agrees ---------------------------------------------------------------

test('the character the builder writes derives with no problem the character did not earn', () => {
  const b = fighter(6);
  b.setLevelClass('levels', 4, 'MAGE');
  b.setLevelClass('levels', 5, 'MAGE');
  b.setLevelClass('levels', 6, 'RANGER');
  const derived = deriveCharacter(b.getState().character, system(), corpus());
  assert.deepEqual(
    derived.problems.filter((p) => p.level === 'error'),
    [],
  );
});

// --- a whole split at once (ADR 0045) ----------------------------------------------------

const segment = (classId: string, levels: number) => ({ classId, levels });
const summary = (b: CharacterBuilder) => {
  const c = b.getState().character;
  return {
    progress: c.progress,
    advancement: advancementOf(b),
    records: multiclassRecords(b),
    elements: [...ids(b)].sort(),
  };
};

test('a split is the same character as the same levels taken one at a time', () => {
  const byLevel = fighter(1);
  byLevel.addLevel('levels', 'FIGHTER');
  byLevel.addLevel('levels', 'MAGE');
  byLevel.addLevel('levels', 'MAGE');

  const bySplit = fighter(1);
  assert.equal(bySplit.applySplit('levels', [segment('FIGHTER', 2), segment('MAGE', 2)]), true);

  assert.deepEqual(summary(bySplit), summary(byLevel));
  assert.deepEqual(advancementOf(bySplit), ['1:FIGHTER', '2:FIGHTER', '3:MAGE', '4:MAGE']);
  assert.equal(multiclassRecords(bySplit).length, 1);
  assert.equal(bySplit.getState().derived.stats.get('level:mage')?.value, 2);
});

test('a split opens every decision it owes, in the same list', () => {
  const b = fighter(1);
  b.applySplit('levels', [segment('FIGHTER', 1), segment('MAGE', 3)]);
  // The Mage's trick opens at the class's own level 2, and the split reached it without a level-up.
  assert.equal(b.getState().decisions.some((d) => d.label === 'Trick'), true);
});

test('the order of the segments is the order the levels were taken, and a class may repeat', () => {
  const b = fighter(1);
  assert.equal(b.applySplit('levels', [segment('FIGHTER', 1), segment('MAGE', 1), segment('FIGHTER', 1), segment('MAGE', 1)]), true);
  assert.deepEqual(advancementOf(b), ['1:FIGHTER', '2:MAGE', '3:FIGHTER', '4:MAGE']);
  assert.deepEqual(b.classLevelsFor('levels')!.classes, [
    { id: 'FIGHTER', levels: 2 },
    { id: 'MAGE', levels: 2 },
  ]);

  // Mage first is a different character: it is the class the character started as, and gets no record.
  const mageFirst = fighter(1);
  assert.equal(mageFirst.applySplit('levels', [segment('MAGE', 2), segment('FIGHTER', 2)]), true);
  assert.deepEqual(advancementOf(mageFirst), ['1:MAGE', '2:MAGE', '3:FIGHTER', '4:FIGHTER']);
  assert.equal(mageFirst.classLevelsFor('levels')!.firstClassId, 'MAGE');
  assert.deepEqual(multiclassRecords(mageFirst), ['LVL_3/select:Multiclass (Level 3)=MC_FIGHTER']);
  assert.equal(ids(mageFirst).has('MULTI_FIGHTER'), true);
  assert.equal(ids(mageFirst).has('MULTI_MAGE'), false, 'the first class is never taken as a second');
});

test('one class in one segment is a single-class character with no advancement', () => {
  const b = fighter(4);
  b.applySplit('levels', [segment('FIGHTER', 2), segment('MAGE', 2)]);
  assert.equal(b.applySplit('levels', [segment('FIGHTER', 6)]), true);
  assert.equal(b.getState().character.progress, 6);
  assert.equal(b.getState().character.advancement, undefined);
  assert.deepEqual(multiclassRecords(b), []);
});

test('a short ability score does not refuse a split; it is flagged', () => {
  const b = fighter(1, { grit: 10 });
  assert.equal(b.applySplit('levels', [segment('FIGHTER', 2), segment('MAGE', 2)]), true);
  assert.deepEqual(
    b.classLevelsFor('levels')!.options.find((o) => o.id === 'MAGE')!.flag,
    [[{ stat: 'grit', needs: 13, has: 10 }]],
  );
});

test('a split that cannot be written is refused and changes nothing', () => {
  const b = fighter(3);
  const before = b.getState().character;

  assert.equal(b.applySplit('levels', []), false);
  assert.equal(b.applySplit('levels', [segment('FIGHTER', 0)]), false);
  assert.equal(b.applySplit('levels', [segment('FIGHTER', 1.5)]), false);
  assert.equal(b.applySplit('levels', [segment('FIGHTER', 15), segment('MAGE', 6)]), false, 'past level 20');
  assert.equal(b.applySplit('levels', [segment('FIGHTER', 2), segment('LONER', 1)]), false, 'no multiclass block');
  assert.equal(b.applySplit('levels', [segment('FIGHTER', 2), segment('TRICK_A', 1)]), false, 'not a class');
  assert.equal(b.applySplit('kit', [segment('FIGHTER', 2)]), false, 'not the step that publishes levels');
  assert.equal(b.getState().character, before, 'the very same character object');

  // The other edition of a class held is a refusal at any score, exactly as for one level.
  assert.equal(b.applySplit('levels', [segment('FIGHTER', 1), segment('RANGER', 1), segment('RANGER_NEW', 1)]), false);
  assert.equal(b.getState().character, before);
});

test('a roll survives a split unless its level moved to a class with a different die', () => {
  const b = fighter(3);
  b.recordHitPoints('levels', 1, 'average');
  b.recordHitPoints('levels', 2, 'average'); // d10 -> 6
  b.recordHitPoints('levels', 3, 'average'); // d10 -> 6

  // Level 3 to a Ranger keeps its roll (d10 either way); level 3 to a Mage (d6) does not.
  b.applySplit('levels', [segment('FIGHTER', 2), segment('RANGER', 1)]);
  assert.equal(b.getState().character.rolls['hp:level:3'], 6);
  b.applySplit('levels', [segment('FIGHTER', 2), segment('MAGE', 1)]);
  assert.equal(b.getState().character.rolls['hp:level:3'], undefined);
  assert.equal(b.getState().character.rolls['hp:level:2'], 6, 'the levels that did not change class are untouched');
  assert.equal(b.getState().decisions.some((d) => d.kind === 'hitpoints'), true, 'and the cleared one reopens');
});

test('a split starts a character that has no class yet, and replaces a different first class', () => {
  const empty = new CharacterBuilder(createCharacter('test', 'pc', { progress: 1 }), system(), corpus());
  assert.equal(empty.applySplit('levels', [segment('FIGHTER', 3), segment('MAGE', 2)]), true);
  assert.equal(empty.getState().character.progress, 5);
  assert.equal(empty.classLevelsFor('levels')!.firstClassId, 'FIGHTER');

  const b = fighter(2);
  assert.equal(b.applySplit('levels', [segment('MAGE', 3)]), true);
  assert.equal(b.classLevelsFor('levels')!.firstClassId, 'MAGE');
  assert.equal(b.getState().character.advancement, undefined);
  assert.deepEqual(multiclassRecords(b), []);
});

test('a flag names a score the way the system labels it, and interleaving is reported', () => {
  const stats = [
    { name: 'charisma', label: 'Charisma' },
    { name: 'cha', derive: { kind: 'ref' as const, stat: 'charisma' } },
  ];
  assert.equal(scoreLabel(stats, 'cha'), 'Charisma');
  assert.equal(scoreLabel(stats, 'CHARISMA'), 'Charisma');
  assert.equal(scoreLabel(stats, 'grit'), 'grit', 'a name nothing declares reads as itself');

  const b = fighter(1);
  b.applySplit('levels', [segment('FIGHTER', 2), segment('MAGE', 2)]);
  assert.equal(b.classLevelsFor('levels')!.interleaved, false);
  assert.equal(b.classLevelsFor('levels')!.maxLevel, 20);
  b.applySplit('levels', [segment('FIGHTER', 1), segment('MAGE', 1), segment('FIGHTER', 1)]);
  assert.equal(b.classLevelsFor('levels')!.interleaved, true);
  assert.equal(fighter(3).classLevelsFor('levels')!.interleaved, false);
});
