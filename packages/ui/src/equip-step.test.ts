/**
 * A build step whose answers are equipped bag entries — ADR 0072.
 *
 * No game in the fixture. A "switch" is a Gadget whose `shelf` setter reads "Switches"; one of them replaces an old
 * knack (it grants a mark the knack's own requirements negate, ADR 0071), and another opens a select of its own. What
 * makes the step equip is its `equip` declaration and nothing else.
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
  setInventoryEntry,
  type Character,
  type Element,
  type GameSystem,
  type RequirementContext,
  type Rule,
} from '@incudo/core';
import { CharacterBuilder } from './use-character-builder.ts';
import { equipAdmits, equipOffer, planEquipAdd, planEquipRemove, requirementConcerns } from './equip-step.ts';

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

const shelf = (value: string) => ({ shelf: { value } });
const grant = (id: string, type = 'Knack'): Rule => ({ kind: 'grant', key: `grant:${id}`, type, id });
const select = (name: string, type: string, tag: string): Rule => ({
  kind: 'select',
  key: `select:${name}`,
  type,
  name,
  number: 1,
  supports: parseSupports(tag),
});

function system(): GameSystem {
  return {
    formatVersion: 1,
    id: 'test',
    name: 'Test',
    version: '1.0.0',
    elementTypes: [{ name: 'Book', publication: true }, { name: 'Kin' }, { name: 'Knack' }, { name: 'Gadget' }, { name: 'Trinket' }, { name: 'Mark' }],
    stats: [{ name: 'vigour', default: 10 }],
    characterKinds: [
      {
        id: 'pc',
        name: 'PC',
        default: true,
        progression: { kind: 'level', min: 1, max: 20, stat: 'level' },
        elementTypes: ['Kin', 'Knack', 'Gadget', 'Trinket', 'Mark'],
        buildSteps: [
          { id: 'kin', label: 'Kin', types: ['Kin'], required: true },
          { id: 'switches', label: 'Switches', types: ['Gadget'], equip: { setter: 'shelf', values: ['Switches'] } },
          { id: 'kit', label: 'Kit', types: ['Gadget'] },
        ],
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
    element('SW_REPLACE', 'Gadget', { name: 'Replacing switch', setters: shelf('Switches'), rules: [grant('MARK', 'Mark'), grant('NEW')] }),
    // Adds a knack whose select picks a gadget with a tag, which the Kit step heads and this step does not.
    element('SW_ADD', 'Gadget', { name: 'Adding switch', setters: shelf('switches'), rules: [grant('EXTRA')] }),
    element('EXTRA', 'Knack', { rules: [select('Charm', 'Gadget', 'Charm')] }),
    element('CHARM', 'Gadget', { supports: ['Charm'] }),
    // Admitted by the setter and ruled out by its own requirements.
    element('SW_GATED', 'Gadget', { setters: shelf('Switches'), requirements: parseRequirements('NOTHING') }),
    // Admitted, from a book the character may be offered or not.
    element('SW_OTHER', 'Gadget', { name: 'Other switch', setters: shelf('Switches'), source: 'Other Book' }),
    element('LAMP', 'Gadget', { setters: shelf('Lamps') }),
  ]);
  return index;
}

const fresh = (extra: Partial<Character> = {}): Character => ({ ...createCharacter('test', 'pc', { progress: 1 }), ...extra });
function builder(character: Character = fresh()): CharacterBuilder {
  const b = new CharacterBuilder(character, system(), corpus());
  if (!b.getState().picks.some((p) => p.stepId === 'kin')) b.choose('build/kin', ['KIN']);
  return b;
}
const decision = (b: CharacterBuilder) => b.getState().decisions.find((d) => d.id === 'build/switches');
const settled = (b: CharacterBuilder) => b.getState().picks.find((p) => p.ruleKey === 'build/switches');
const held = (b: CharacterBuilder, id: string) => b.getState().derived.elementIds.has(id);

test('the step offers what its setter admits, as a set that never blocks', () => {
  // Perturbation: leave `equip` out of the set loop and there is no decision; stop reading the setter and the lamp and
  // the tagged charm are offered; compare the value by exact case and the adding switch is lost; stop filtering by own
  // requirements and the gated switch is offered.
  const b = builder();
  const open = decision(b)!;
  assert.ok(open, 'the step is on screen with nothing taken');
  assert.equal(open.multiple, true);
  assert.equal(open.blocking, false);
  assert.deepEqual(open.candidates, ['SW_ADD', 'SW_OTHER', 'SW_REPLACE'], 'by name, admitted, own requirements holding');
  assert.deepEqual(open.chosen, []);
  assert.equal(b.getState().steps.find((s) => s.id === 'switches')!.complete, true);
  assert.equal(equipAdmits(system().characterKinds[0]!.buildSteps![1]!, corpus().get('LAMP')!), false);
});

test('a book switched off offers nothing from it', () => {
  // Perturbation: offer from everything loaded rather than the offered view and the other book's switch stays.
  const b = builder(fresh({ publications: [] }));
  assert.deepEqual(decision(b)!.candidates, ['SW_ADD', 'SW_REPLACE']);
});

test('taking writes an equipped bag entry and never a choice, and the entry is held', () => {
  // Perturbation: route `choose` for the step through `setChoice` and a choice is written with no bag entry.
  const b = builder();
  b.choose('build/switches', ['SW_ADD']);
  const c = b.getState().character;
  assert.equal(c.choices.some((ch) => ch.ruleKey === 'build/switches'), false, 'no choice recorded');
  assert.equal(c.inventory?.length, 1);
  assert.deepEqual({ ...c.inventory![0]!, instanceId: '' }, { instanceId: '', elementId: 'SW_ADD', equipped: true });
  assert.ok(held(b, 'SW_ADD') && held(b, 'EXTRA'));
  assert.deepEqual(settled(b)?.chosen, ['SW_ADD']);
  assert.equal(settled(b)?.multiple, true);
  assert.deepEqual(decision(b)!.candidates, ['SW_OTHER', 'SW_REPLACE']);

  // Ignored: an id the step does not offer.
  b.choose('build/switches', ['SW_ADD', 'LAMP']);
  assert.equal(b.getState().character.inventory?.length, 1);
});

test('what a select the taken item opens is headed by another step', () => {
  // Perturbation: let the equip step claim its types for content selects and the charm select is headed by it.
  const b = builder();
  b.choose('build/switches', ['SW_ADD']);
  const charm = b.getState().decisions.find((d) => d.id === 'EXTRA/select:Charm');
  assert.equal(charm?.stepId, 'kit');
});

test('an equipped entry of the family reads back as taken, and a carried one is equipped rather than duplicated', () => {
  // Perturbation: read taken items from choices and the imported one is not taken; always add a new entry and the
  // carried one is left beside a second.
  const imported = setInventoryEntry(
    setInventoryEntry(fresh(), { instanceId: 'guid-1', elementId: 'SW_ADD', equipped: true }),
    { instanceId: 'guid-2', elementId: 'SW_REPLACE' },
  );
  const b = builder(imported);
  assert.deepEqual(settled(b)?.chosen, ['SW_ADD']);
  assert.ok(decision(b)!.candidates.includes('SW_REPLACE'), 'carried, it is not taken');
  b.choose('build/switches', ['SW_ADD', 'SW_REPLACE']);
  assert.deepEqual(
    b.getState().character.inventory!.map((e) => [e.instanceId, e.equipped]),
    [['guid-1', true], ['guid-2', true]],
  );
});

test('taking back removes a bare entry and only unequips one that records more', () => {
  // Perturbation: always remove and the named one is lost; always unequip and the bare one stays in the bag.
  const named = setInventoryEntry(fresh(), { instanceId: 'n', elementId: 'SW_REPLACE', equipped: true, name: 'Lucky' });
  const b = builder(named);
  b.choose('build/switches', ['SW_REPLACE', 'SW_ADD']);
  b.choose('build/switches', []);
  assert.deepEqual(b.getState().character.inventory, [{ instanceId: 'n', elementId: 'SW_REPLACE', equipped: false, name: 'Lucky' }]);
  assert.equal(settled(b), undefined);

  // The two writes on their own, over the same entry shapes.
  const bare = planEquipAdd(fresh(), ['SW_ADD'], () => 'x');
  assert.deepEqual(bare.inventory, [{ instanceId: 'x', elementId: 'SW_ADD', equipped: true }]);
  assert.equal(planEquipRemove(bare, ['SW_ADD']).inventory, undefined);
});

test('a replacing item withdraws the old knack, and taken back the old knack returns with its answer', () => {
  // Perturbation: prune the closed pools when taking and the old knack's answer is gone when it returns; drop the
  // withdrawn rows from the state and nothing names the old knack.
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
  assert.deepEqual(b.getState().withdrawn, []);
});

test('taking back drops the answers it closed, and a swap keeps the answer of what the new item replaces', () => {
  // Perturbation: stop dropping closed answers on take-back and the charm is still recorded (and held); drop closed
  // answers after taking as well and the swap loses the old knack's answer.
  const b = builder();
  b.choose('OLD/select:Keepsake', ['T2']);
  b.choose('build/switches', ['SW_ADD']);
  b.choose('EXTRA/select:Charm', ['CHARM']);
  assert.ok(held(b, 'CHARM'));

  // Swap the adding switch for the replacing one in its slot, as the settled pick's control does.
  b.choose('build/switches', ['SW_REPLACE']);
  const choices = b.getState().character.choices;
  assert.equal(choices.some((c) => c.ruleKey === 'EXTRA/select:Charm'), false, 'the charm answer went with its item');
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

// Fails if `gatedOnHeld` is not read (the juggler's switch and the ungated one are offered), if it is read without
// being declared (the plain step loses them), or if an element is kept for an ungated grant.
test('a step gated on what the character has offers only what one of its grants is gated on', () => {
  const gated = (id: string, requirements?: string): Element =>
    element(id, 'Gadget', {
      setters: shelf('Switches'),
      rules: [{ ...grant(`${id}_FEATURE`), ...(requirements ? { requirements: parseRequirements(requirements) } : {}) }],
    });
  const index = new MapElementIndex();
  index.addAll([gated('A_TINKER', '[level:tinker:4]'), gated('B_HELD', 'HELD'), gated('C_JUGGLER', '[level:juggler:1]'), gated('D_PLAIN')]);
  const step = { id: 'switches', label: 'Switches', types: ['Gadget'], equip: { setter: 'shelf', values: ['Switches'] } };
  assert.deepEqual(equipOffer({ ...step, equip: { ...step.equip, gatedOnHeld: true } }, index, holder), ['A_TINKER', 'B_HELD']);
  assert.deepEqual(equipOffer(step, index, holder), ['A_TINKER', 'B_HELD', 'C_JUGGLER', 'D_PLAIN']);
});
