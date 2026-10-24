/**
 * Attacks on the sheet — ADR 0093.
 *
 * No game in the fixture: a tinker carries blades and a rope, one blade keen, one adorned with a +1 charm, and its kind
 * adds its might (its grace for a keen blade) and its skill when it holds the blade's training. Derived through the
 * engine, drawn through `sheetView`, worded by the document's helpers and written as Markdown. Each test names the change
 * that fails it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createCharacter,
  deriveCharacter,
  MapElementIndex,
  resolveCharacterKind,
  type Character,
  type Element,
  type GameSystem,
  type Setter,
} from '@incudo/core';

import { attackAside, attackHead, sheetDocument } from './sheet-document.ts';
import { sheetMarkdown } from './sheet-markdown.ts';
import { attackDamage, sheetView } from './sheet.ts';

function element(id: string, name: string, type: string, setters: Record<string, string | Setter> = {}, supports: string[] = []): Element {
  const out: Record<string, Setter> = {};
  for (const [key, value] of Object.entries(setters)) out[key] = typeof value === 'string' ? { value } : value;
  return { id, type, name, source: 'Test Book', setters: out, rules: [], supports, origin: { sourceId: 'test', format: 'incudo' } };
}

const ref = (stat: string) => ({ kind: 'ref', stat }) as const;

function system(withAttacks = true): GameSystem {
  return {
    formatVersion: 1,
    id: 'test',
    name: 'Test System',
    version: '1.0.0',
    elementTypes: [{ name: 'Blade' }, { name: 'Gear' }, { name: 'Charm' }, { name: 'Training' }],
    stats: [
      { name: 'might', label: 'Might', default: 3 },
      { name: 'grace', label: 'Grace', default: 1 },
      { name: 'skill', label: 'Skill', default: 2 },
    ],
    characterKinds: [
      {
        id: 'tinker',
        name: 'Tinker',
        default: true,
        progression: { kind: 'none' },
        elementTypes: ['Blade', 'Gear', 'Charm', 'Training'],
        inventory: { slotSetter: 'slot', occupiedTag: 'any', emptyTag: 'none', slots: [] },
        ...(withAttacks
          ? {
              attacks: {
                types: ['Blade'],
                tagStat: 'blade',
                bonus: 'strike:bonus',
                damage: 'strike:damage',
                dice: 'hurt',
                damageType: 'kind',
                alternatives: [{ setter: 'both hands', label: 'two-handed' }],
                range: 'reach',
                nameSetter: 'naming',
                properties: { labels: { TAG_KEEN: 'Keen' } },
                stats: [
                  { stat: 'strike:ability', value: ref('might'), requirements: '![blade:TAG_KEEN]' },
                  { stat: 'strike:ability', value: ref('grace'), requirements: '[blade:TAG_KEEN]' },
                  { stat: 'strike:bonus', value: ref('strike:ability') },
                  { stat: 'strike:bonus', value: ref('skill'), requirements: '{training}' },
                  { stat: 'strike:bonus', value: { kind: 'setter', name: 'plus', as: 'number' } },
                  { stat: 'strike:damage', value: ref('strike:ability') },
                  { stat: 'strike:damage', value: { kind: 'setter', name: 'plus', as: 'number' } },
                ],
              },
            }
          : {}),
        buildSteps: [],
        sheet: {
          sections: [
            { id: 'scores', label: 'Scores', stats: ['might'] },
            ...(withAttacks ? [{ id: 'attacks', label: 'Attacks', attacks: true }] : []),
            { id: 'gear', label: 'Gear', types: ['Gear'] },
          ],
        },
      },
    ],
  };
}

const SWORD = element('SWORD', 'Sword', 'Blade', { hurt: { value: '1d8', attrs: { kind: 'cutting' } }, 'both hands': '1d10', training: 'TRAINED_SWORD' });
const KNIFE = element('KNIFE', 'Knife', 'Blade', { hurt: '1d4', reach: '20/60', training: 'TRAINED_KNIFE' }, ['TAG_KEEN']);
const ROPE = element('ROPE', 'Rope', 'Gear');
const PLUS = element('PLUS', 'Blade, +1', 'Charm', { plus: '1', naming: '{{parent}} +{{plus}}' });
const TRAINED = element('TRAINED_SWORD', 'Sword Training', 'Training');
const index = new MapElementIndex();
index.addAll([SWORD, KNIFE, ROPE, PLUS, TRAINED]);

function tinker(): Character {
  return {
    ...createCharacter('test', 'tinker', { name: 'Nyx' }),
    choices: [{ ruleKey: 'build/training', elementIds: ['TRAINED_SWORD'] }],
    inventory: [
      { instanceId: 'a', elementId: 'SWORD', equipped: true, adorners: [{ elementId: 'PLUS' }] },
      { instanceId: 'b', elementId: 'ROPE' },
      { instanceId: 'c', elementId: 'KNIFE' },
    ],
  };
}

function view(withAttacks = true) {
  const sys = system(withAttacks);
  const kind = resolveCharacterKind(sys, 'tinker');
  const derived = deriveCharacter(tinker(), sys, index, { kind });
  return { derived, sheet: sheetView(derived, kind) };
}

test('the engine publishes an attack for every blade in the bag, carried or equipped, and moves no stat of the character', () => {
  const { derived } = view();
  assert.deepEqual(derived.attacks.map((a) => [a.name, a.equipped, a.bonus, a.damageBonus]), [
    ['Sword +1', true, 3 + 2 + 1, 3 + 1],
    ['Knife', false, 1, 1],
  ]);
  // Fails if an attack's stats are written into the character's: `strike:bonus` would be a stat of its own.
  const without = view(false).derived;
  assert.deepEqual([...derived.stats.keys()].sort(), [...without.stats.keys()].sort());
  assert.deepEqual(without.attacks, [], 'a kind declaring none has none');
});

test('a section listing attacks draws each with its bonus signed and its damage as the die, the modifier and the type', () => {
  const attacks = view().sheet.sections.find((s) => s.id === 'attacks')!.attacks!;
  assert.deepEqual(attacks, [
    {
      instanceId: 'a',
      elementId: 'SWORD',
      name: 'Sword +1',
      equipped: true,
      bonus: '+6',
      damage: '1d8+4 cutting',
      alternatives: [{ label: 'two-handed', damage: '1d10+4 cutting' }],
      properties: [],
    },
    { instanceId: 'c', elementId: 'KNIFE', name: 'Knife', equipped: false, bonus: '+1', damage: '1d4+1', alternatives: [], range: '20/60', properties: ['Keen'] },
  ]);
  // Fails if a section that lists nothing else is dropped as empty while it has attacks. (The carried rope is held by
  // nothing, so Gear is empty.)
  assert.deepEqual(view().sheet.sections.map((s) => s.id), ['scores', 'attacks']);
});

test("a damage is the die, the modifier's sign only when it is not 0, and the type", () => {
  assert.equal(attackDamage('1d8', 3, 'slashing'), '1d8+3 slashing');
  assert.equal(attackDamage('1d8', -1, 'slashing'), '1d8-1 slashing');
  assert.equal(attackDamage('1d8', 0, undefined), '1d8');
  // Perturbation: drop the flat-amount sum and an unarmed strike with Strength 8 reads "1-1 bludgeoning" again.
  assert.equal(attackDamage('1', 2, 'piercing'), '3 piercing', 'a flat amount is added up');
  assert.equal(attackDamage('1', -1, 'bludgeoning'), '0 bludgeoning', 'and never goes below 0');
  assert.equal(attackDamage('1', -3, undefined), '0');
  assert.equal(attackDamage(undefined, 2, 'fire'), '+2 fire');
  assert.equal(attackDamage(undefined, 0, undefined), '—');
});

test('an attack is worded once: its bonus and damage, then its other dice, its range and its properties', () => {
  const [sword, knife] = view().sheet.sections.find((s) => s.id === 'attacks')!.attacks!;
  assert.equal(attackHead(sword!), 'Sword +1: +6, 1d8+4 cutting (two-handed 1d10+4 cutting)');
  assert.equal(attackHead(knife!), 'Knife: +1, 1d4+1 (range 20/60; Keen)');
  assert.equal(attackAside({ alternatives: [], properties: [] }), undefined);
});

test('the Markdown lists the attacks under their section, the name in bold, escaped', () => {
  const { sheet } = view();
  // A name the user gave an entry may read as markup.
  const attacks = sheet.sections.find((s) => s.id === 'attacks')!.attacks!;
  attacks[1] = { ...attacks[1]!, name: 'Night_*Knife*' };
  const markdown = sheetMarkdown(
    sheetDocument({ character: { name: 'Nyx' }, sheet, references: { label: 'For reference', rows: [] }, freeform: { available: false, label: '', groups: [] }, descriptions: undefined }),
  );
  // Fails if the export leaves the attacks out, or writes a name unescaped.
  assert.match(markdown, /## Attacks\n\n- \*\*Sword \+1\*\*: \+6, 1d8\+4 cutting \(two-handed 1d10\+4 cutting\)\n- \*\*Night\\_\\\*Knife\\\*\*\*: \+1, 1d4\+1 \(range 20\/60; Keen\)\n/);
});
