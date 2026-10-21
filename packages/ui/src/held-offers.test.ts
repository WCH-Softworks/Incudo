/**
 * A set that offers only what concerns the character, and the options a character takes there — ADR 0081, ADR 0129.
 *
 * No game in the fixture. A "switch" is an element of a type of its own, taken through a set step (until ADR 0129 such
 * a step equipped items, and its answers were bag entries). One switch replaces an old knack (it grants a mark the
 * knack's own requirements negate, ADR 0071), and another opens a select of its own.
 *
 * Each test names the perturbation that fails it. The real corpus, a 2014 Ranger taking Deft Explorer, is
 * `tools/verify/src/optional-feature-step.test.ts`.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createCharacter,
  MapElementIndex,
  parseRequirements,
  parseSupports,
  type BuildStepDef,
  type Character,
  type Element,
  type GameSystem,
  type RequirementContext,
  type Rule,
} from '@incudo/core';
import { CharacterBuilder } from './use-character-builder.ts';
import { requirementConcerns } from './held-offers.ts';

function element(id: string, type: string, extra: Partial<Element> = {}): Element {
  return {
    id,
    type,
    name: id,
    source: 'Core',
    setters: {},
    rules: [],
    supports: [],
    origin: { sourceId: 'test', format: 'incudo' },
    ...extra,
  };
}

const grant = (id: string, type = 'Knack'): Rule => ({ kind: 'grant', key: `grant:${id}`, type, id });
const select = (name: string, type: string, tag: string): Rule => ({
  kind: 'select',
  key: `select:${name}`,
  type,
  name,
  number: 1,
  supports: parseSupports(tag),
});

const SWITCHES: BuildStepDef = { id: 'switches', label: 'Switches', types: ['Switch'], multiple: true };

function system(switches: BuildStepDef = SWITCHES): GameSystem {
  return {
    formatVersion: 1,
    id: 'test',
    name: 'Test',
    version: '1.0.0',
    elementTypes: [
      { name: 'Book', publication: true },
      { name: 'Kin' },
      { name: 'Knack' },
      { name: 'Switch' },
      { name: 'Gadget' },
      { name: 'Trinket' },
      { name: 'Mark' },
    ],
    stats: [{ name: 'vigour', default: 10 }],
    characterKinds: [
      {
        id: 'pc',
        name: 'PC',
        default: true,
        progression: { kind: 'level', min: 1, max: 20, stat: 'level' },
        elementTypes: ['Kin', 'Knack', 'Switch', 'Gadget', 'Trinket', 'Mark'],
        buildSteps: [{ id: 'kin', label: 'Kin', types: ['Kin'], required: true }, switches, { id: 'kit', label: 'Kit', types: ['Gadget'] }],
        sheet: { sections: [{ id: 's', label: 'S', stats: ['vigour'] }] },
      },
    ],
  };
}

function corpus(): MapElementIndex {
  const index = new MapElementIndex();
  index.addAll([
    element('BOOK_OTHER', 'Book', { name: 'Other Book', source: 'Other Book' }),
    // The kin grants the old knack, whose select picks a trinket, unless the character holds the mark.
    element('KIN', 'Kin', { rules: [grant('OLD')] }),
    element('OLD', 'Knack', { requirements: parseRequirements('!MARK'), rules: [select('Keepsake', 'Trinket', 'Keepsake')] }),
    element('T1', 'Trinket', { supports: ['Keepsake'] }),
    element('T2', 'Trinket', { supports: ['Keepsake'] }),
    element('MARK', 'Mark'),
    element('NEW', 'Knack'),
    // Replaces the old knack: grants the new one and the mark.
    element('SW_REPLACE', 'Switch', { name: 'Replacing switch', rules: [grant('MARK', 'Mark'), grant('NEW')] }),
    // Adds a knack whose select picks a gadget with a tag, which the Kit step heads.
    element('SW_ADD', 'Switch', { name: 'Adding switch', rules: [grant('EXTRA')] }),
    element('EXTRA', 'Knack', { rules: [select('Charm', 'Gadget', 'Charm')] }),
    element('CHARM', 'Gadget', { supports: ['Charm'] }),
    // Ruled out by its own requirements.
    element('SW_GATED', 'Switch', { requirements: parseRequirements('NOTHING') }),
    // From a book the character may be offered or not.
    element('SW_OTHER', 'Switch', { name: 'Other switch', source: 'Other Book' }),
  ]);
  return index;
}

const fresh = (extra: Partial<Character> = {}): Character => ({ ...createCharacter('test', 'pc', { progress: 1 }), ...extra });
function builder(character: Character = fresh(), switches?: BuildStepDef, index: MapElementIndex = corpus()): CharacterBuilder {
  const b = new CharacterBuilder(character, system(switches), index);
  if (!b.getState().picks.some((p) => p.stepId === 'kin')) b.choose('build/kin', ['KIN']);
  return b;
}
const decision = (b: CharacterBuilder) => b.getState().decisions.find((d) => d.id === 'build/switches');
const settled = (b: CharacterBuilder) => b.getState().picks.find((p) => p.ruleKey === 'build/switches');
const held = (b: CharacterBuilder, id: string) => b.getState().derived.elementIds.has(id);
const sorted = (ids: readonly string[]) => [...ids].sort();

test('the step offers its type as a set that never blocks, its own requirements holding', () => {
  // Perturbation: stop filtering by own requirements and the gated switch is offered.
  const b = builder();
  const open = decision(b)!;
  assert.ok(open, 'the step is on screen with nothing taken');
  assert.equal(open.multiple, true);
  assert.equal(open.blocking, false);
  assert.deepEqual(sorted(open.candidates), ['SW_ADD', 'SW_OTHER', 'SW_REPLACE']);
  assert.deepEqual(open.chosen, []);
});

test('a book switched off offers nothing from it', () => {
  // Perturbation: offer from everything loaded rather than the offered view and the other book's switch stays.
  const b = builder(fresh({ publications: [] }));
  assert.deepEqual(sorted(decision(b)!.candidates), ['SW_ADD', 'SW_REPLACE']);
});

test('taking records a choice and never a bag entry, and what it gives is held', () => {
  // Perturbation: write the answer to the bag and there is no choice, and an inventory appears.
  const b = builder();
  b.choose('build/switches', ['SW_ADD']);
  const c = b.getState().character;
  assert.deepEqual(c.choices.find((ch) => ch.ruleKey === 'build/switches')?.elementIds, ['SW_ADD']);
  assert.equal(c.inventory, undefined, 'nothing in the bag');
  assert.ok(held(b, 'SW_ADD') && held(b, 'EXTRA'));
  assert.deepEqual(settled(b)?.chosen, ['SW_ADD']);
  assert.equal(settled(b)?.multiple, true);
  assert.deepEqual(sorted(decision(b)!.candidates), ['SW_OTHER', 'SW_REPLACE']);
});

test('what a select the taken option opens is headed by the step that lists its type', () => {
  // Perturbation: let the set claim another step's types and the charm select is headed by it.
  const b = builder();
  b.choose('build/switches', ['SW_ADD']);
  assert.equal(b.getState().decisions.find((d) => d.id === 'EXTRA/select:Charm')?.stepId, 'kit');
});

test('a replacing option withdraws the old knack, and taken back the old knack returns with its answer', () => {
  // Perturbation: drop closed answers after taking as well and the old knack's answer is gone when it returns.
  const b = builder();
  b.choose('OLD/select:Keepsake', ['T1']);
  assert.ok(held(b, 'OLD') && held(b, 'T1'));

  b.choose('build/switches', ['SW_REPLACE']);
  assert.equal(held(b, 'OLD'), false, 'withdrawn');
  assert.equal(held(b, 'T1'), false, 'and its answer is not held');
  assert.ok(held(b, 'NEW'));
  assert.deepEqual(b.getState().withdrawn, [{ elementId: 'OLD', name: 'OLD', grantedBy: ['KIN'] }]);
  assert.deepEqual(b.getState().character.choices.find((c) => c.ruleKey === 'OLD/select:Keepsake')?.elementIds, ['T1']);

  b.choose('build/switches', []);
  assert.ok(held(b, 'OLD') && held(b, 'T1'), 'back, with its answer');
  assert.equal(held(b, 'NEW'), false);
  assert.equal(settled(b), undefined);
});

test('taking back drops the answers it closed, and a swap keeps the answer of what the new option replaces', () => {
  // Perturbation: answer the set with a plain `setChoice` and the charm is still recorded; drop closed answers after
  // taking as well and the swap loses the old knack's answer.
  const b = builder();
  b.choose('OLD/select:Keepsake', ['T2']);
  b.choose('build/switches', ['SW_ADD']);
  b.choose('EXTRA/select:Charm', ['CHARM']);
  assert.ok(held(b, 'CHARM'));

  b.choose('build/switches', ['SW_REPLACE']);
  const choices = b.getState().character.choices;
  assert.equal(choices.some((c) => c.ruleKey === 'EXTRA/select:Charm'), false, 'the charm answer went with its option');
  assert.equal(held(b, 'CHARM'), false);
  assert.deepEqual(choices.find((c) => c.ruleKey === 'OLD/select:Keepsake')?.elementIds, ['T2'], 'the replaced knack keeps its answer');
});

// ADR 0081. A context where the character publishes `level:tinker` 1 and `level:juggler` 0, and holds HELD.
const holder: RequirementContext = {
  hasElement: (id) => id === 'HELD',
  statNumber: (stat) => (stat === 'level:tinker' ? 1 : 0),
  statString: () => undefined,
  hasFlag: () => false,
};

// Fails if a term is read as whether it holds rather than whether it names something held (a level 1 tinker's
// `>= 4` would read false), if a term under a `not` counts (`!HELD` would read true), if an `or` or `and` is not
// looked into, or if a stat published at 0 counts.
test('a requirement concerns the character when a term outside a not names a stat it has or an element it holds', () => {
  assert.equal(requirementConcerns(parseRequirements('[level:tinker:4]'), holder), true);
  assert.equal(requirementConcerns(parseRequirements('[level:juggler:1]'), holder), false);
  assert.equal(requirementConcerns(parseRequirements('HELD'), holder), true);
  assert.equal(requirementConcerns(parseRequirements('!HELD'), holder), false);
  assert.equal(requirementConcerns(parseRequirements('OTHER||[level:tinker:9]'), holder), true);
  assert.equal(requirementConcerns(parseRequirements('OTHER,[level:juggler:2]'), holder), false);
  assert.equal(requirementConcerns(undefined, holder), false);
});

// Fails if `gatedOnHeld` is not read (the switch gated on an element not held and the ungated one are offered), if it
// is read without being declared (the plain step loses them), or if an element is kept for an ungated grant.
test('a set gated on what the character has offers only what one of its grants is gated on', () => {
  const gated = (id: string, requirements?: string): Element =>
    element(id, 'Switch', { rules: [{ ...grant(`${id}_FEATURE`), ...(requirements ? { requirements: parseRequirements(requirements) } : {}) }] });
  const index = corpus();
  index.addAll([gated('G_KIN', 'KIN'), gated('G_ELSEWHERE', 'ELSEWHERE'), gated('G_PLAIN')]);
  const offered = (step: BuildStepDef) => sorted(decision(builder(fresh({ publications: [] }), step, index))!.candidates);
  assert.deepEqual(offered({ ...SWITCHES, gatedOnHeld: true }), ['G_KIN']);
  assert.deepEqual(offered(SWITCHES), ['G_ELSEWHERE', 'G_KIN', 'G_PLAIN', 'SW_ADD', 'SW_REPLACE']);
});
