/**
 * The readings the build screens share for additions, references, written features and what a held element gives
 * (ROADMAP Phase 6, ADR 0086's second pass): the desktop's panes and the phone's Build screen both call these. Each case
 * names the perturbation that fails it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { CustomFeatureStat } from '@incudo/core';

import { additionGroups, additionOptionLabel, type AddedRow } from './additions.ts';
import { PREREQUISITES_UNMET } from './sheet-document.ts';
import {
  holderGrantSections,
  holderGrantStatus,
  holderGrantsUnseenNote,
} from './build-view.ts';
import {
  customFeatureLines,
  customFeatureTypeChoices,
  customLineWithMode,
  customStatChoiceLabel,
  customStatGroups,
  withCustomLine,
  withoutCustomLine,
  type CustomFeatureView,
} from './custom-features.ts';
import { referenceSuggestionNote } from './references.ts';
import type { HolderGrant } from './use-character-builder.ts';

const row = (elementId: string, type: string): AddedRow => ({
  elementId,
  name: elementId,
  type,
  known: type !== '',
  held: true,
  prerequisitesMet: true,
});

test("added rows are grouped under the kind's types in its order, anything else last under Other", () => {
  // Perturbation: grouping by `state.rows` order instead of `state.types` puts Feats after Languages; dropping the
  // final group loses a row nothing declares, which then cannot be removed.
  const groups = additionGroups({
    types: [
      { type: 'Feat', label: 'Feats' },
      { type: 'Language', label: 'Languages' },
      { type: 'Spell', label: 'Spells' },
    ],
    rows: [row('L', 'Language'), row('X', ''), row('F', 'Feat'), row('C', 'Class')],
  });
  assert.deepEqual(
    groups.map((g) => [g.label, g.rows.map((r) => r.elementId)]),
    [
      ['Feats', ['F']],
      ['Languages', ['L']],
      ['Other', ['X', 'C']],
    ],
  );
});

test('an option whose prerequisites do not hold says so; one whose do is its label alone', () => {
  // Perturbation: testing `!option.prerequisitesMet` the other way round marks every qualifying feat.
  assert.equal(additionOptionLabel('Alert', { prerequisitesMet: true }), 'Alert');
  assert.equal(additionOptionLabel('Grappler', { prerequisitesMet: false }), `Grappler · ${PREREQUISITES_UNMET}`);
});

test('a suggestion names every element that prints it', () => {
  // Perturbation: naming only `printedIn[0]` hides a second spell that prints the same creature.
  assert.equal(referenceSuggestionNote({ printedIn: ['Summon Beast', 'Find Familiar'] }), 'In Summon Beast, Find Familiar');
});

const stats: CustomFeatureStat[] = [
  { stat: 'speed', label: 'Speed', group: 'Speed', fullLabel: 'Speed', settable: true },
  { stat: 'ac', label: 'Armor Class', group: 'Defences', fullLabel: 'Armor Class', settable: true },
  { stat: 'perception', label: 'Perception', group: 'Skills', fullLabel: 'Perception', settable: false },
];

test('a line moved to setting is refused on a stat that is worked out, and an add keeps its number', () => {
  // Perturbation: dropping the `settable` check lets a phone's Sets toggle write a set the engine adds on top of.
  const add = { stat: 'perception', mode: 'add' as const, value: 2 };
  assert.deepEqual(customLineWithMode(add, 'set', stats), add);
  assert.deepEqual(customLineWithMode({ stat: 'Speed', mode: 'add', value: 10 }, 'set', stats), {
    stat: 'Speed',
    mode: 'set',
    value: 10,
  });
  assert.deepEqual(customLineWithMode({ stat: 'speed', mode: 'set', value: 60 }, 'add', stats), {
    stat: 'speed',
    mode: 'add',
    value: 60,
  });
});

test("a feature's lines are written back without what the view adds, one replaced or taken out at a time", () => {
  // Perturbation: spreading the view's line writes `label`, `status` and `note` into character.json.
  const view = {
    lines: [
      { stat: 'speed', mode: 'set' as const, value: 60, label: 'Speed', status: 'applied' as const },
      { stat: 'ac', mode: 'add' as const, value: 1, label: 'Armor Class', status: 'applied' as const, note: 'x' },
    ],
  };
  const lines = customFeatureLines(view);
  assert.deepEqual(lines, [
    { stat: 'speed', mode: 'set', value: 60 },
    { stat: 'ac', mode: 'add', value: 1 },
  ]);
  // Perturbation: `withCustomLine` replacing by stat rather than position changes both lines on one stat.
  assert.deepEqual(withCustomLine(lines, 1, { stat: 'ac', mode: 'add', value: 2 })[1], { stat: 'ac', mode: 'add', value: 2 });
  assert.deepEqual(withCustomLine(lines, 1, { stat: 'ac', mode: 'add', value: 2 })[0], lines[0]);
  assert.deepEqual(withoutCustomLine(lines, 0), [lines[1]]);
});

test('the stats a line may name are grouped in the kind\'s order, and on one list carry their group', () => {
  // Perturbation: sorting the groups by name puts Defences before Speed, away from the sheet's order.
  assert.deepEqual(
    customStatGroups(stats).map((g) => g.group),
    ['Speed', 'Defences', 'Skills'],
  );
  // Perturbation: always appending the group writes "Speed (Speed)".
  assert.equal(customStatChoiceLabel(stats[0]!), 'Speed');
  assert.equal(customStatChoiceLabel(stats[1]!), 'Armor Class (Defences)');
});

test('where a feature is listed is a choice only when there is one, and a type not listed is offered first as itself', () => {
  const feature = (patch: Partial<CustomFeatureView>) => ({ type: 'Trait', typeLabel: 'Traits', ...patch });
  // Perturbation: offering the choice for one type shows a control with nothing to change.
  assert.deepEqual(customFeatureTypeChoices({ types: [{ type: 'Trait', label: 'Traits' }] }, feature({})), []);
  const types = [
    { type: 'Trait', label: 'Traits' },
    { type: 'Action', label: 'Actions' },
  ];
  assert.deepEqual(customFeatureTypeChoices({ types }, feature({})), types);
  // Perturbation: leaving the recorded type out makes a feature held as nothing look listed under Traits.
  const stray = feature({ type: 'Legendary Action', typeLabel: 'Legendary Actions (not available)', typeNote: 'n' });
  assert.deepEqual(customFeatureTypeChoices({ types: [types[0]!] }, stray), [
    { type: 'Legendary Action', label: 'Legendary Actions (not available)' },
    types[0],
  ]);
});

const grant = (elementId: string, from: string, group: string, patch: Partial<HolderGrant> = {}): HolderGrant => ({
  elementId,
  from,
  stepId: '',
  group,
  removed: false,
  held: true,
  ...patch,
});

test('what a held element gives is listed by giver, then heading, and what nothing declares is counted, not shown', () => {
  // Perturbation: grouping by heading across givers lists one creature's Bite under another's name.
  const grants = [
    grant('BITE', 'WOLF', 'Actions'),
    grant('PACK', 'WOLF', 'Traits'),
    grant('GONE', 'WOLF', 'Traits', { removed: true, held: false }),
    grant('TAIL', 'DRAGON', ''),
  ];
  const sections = holderGrantSections(grants, (id) => id !== 'GONE');
  assert.deepEqual(
    sections.map((s) => [s.from, s.groups.map((g) => [g.label, g.rows.map((r) => r.elementId), g.unseen])]),
    [
      [
        'WOLF',
        [
          ['Actions', ['BITE'], 0],
          // Perturbation: listing an unknown id shows a bare id nothing can name; not counting it hides that it exists.
          ['Traits', ['PACK'], 1],
        ],
      ],
      // Perturbation: dropping the fallback heads a group with nothing.
      ['DRAGON', [['Other', ['TAIL'], 0]]],
    ],
  );
});

test("a removed grant says whether something else still gives it, and the unseen count is worded by number", () => {
  // Perturbation: ignoring `held` says "removed" of an element still on the character through a choice.
  assert.equal(holderGrantStatus({ removed: false, held: true }), undefined);
  assert.equal(holderGrantStatus({ removed: true, held: false }), 'removed');
  assert.match(holderGrantStatus({ removed: true, held: true })!, /also chosen or given/);
  assert.equal(holderGrantsUnseenNote(0), undefined);
  assert.match(holderGrantsUnseenNote(1)!, /^One more was removed/);
  assert.match(holderGrantsUnseenNote(3)!, /^3 more were removed/);
});
