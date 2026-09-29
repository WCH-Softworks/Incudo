/**
 * A sheet as it is drawn — ADR 0074.
 *
 * No game in the fixture: a character holds gadgets, one of which declares a "Runesmith" block; the kind shows a score
 * with its modifier beside it, a bonus and a stat nobody labelled, a per-block section whose rows are labelled by the
 * kind's block stats, and a list of gadgets, one of them kept off the sheet. Each test names the change that fails it.
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
  type ResolvedStat,
  type Setter,
} from '@incudo/core';

import { formatStatValue, sheetView } from './sheet.ts';
import { CharacterBuilder } from './use-character-builder.ts';

function element(id: string, name: string, setters: Record<string, string> = {}, extra: Partial<Element> = {}): Element {
  const out: Record<string, Setter> = {};
  for (const [key, value] of Object.entries(setters)) out[key] = { value };
  return { id, type: 'Gadget', name, source: 'Test Book', setters: out, rules: [], supports: [], origin: { sourceId: 'test', format: 'incudo' }, ...extra };
}

const num = (value: number) => ({ kind: 'number' as const, value });

function system(): GameSystem {
  return {
    formatVersion: 1,
    id: 'test',
    name: 'Test System',
    version: '1.0.0',
    elementTypes: [{ name: 'Gadget' }, { name: 'Nothing' }],
    stats: [
      { name: 'grit', label: 'Grit', default: 14 },
      {
        name: 'grit:mod',
        signed: true,
        derive: { kind: 'call', fn: 'floor', args: [{ kind: 'binary', op: '/', left: { kind: 'binary', op: '-', left: { kind: 'ref', stat: 'grit' }, right: num(10) }, right: num(2) }] },
      },
      { name: 'luck', label: 'Luck', default: -1, signed: true },
      { name: 'untitled', default: 3 },
    ],
    characterKinds: [
      {
        id: 'tinker',
        name: 'Tinker',
        default: true,
        progression: { kind: 'none' },
        elementTypes: ['Gadget', 'Nothing'],
        blockStats: [
          { stat: '{name}:dc', value: num(12), label: 'Rune DC' },
          { stat: '{name}:bonus', value: num(4), label: 'Rune Bonus', signed: true },
          { stat: '{name}:raw', value: num(1) },
        ],
        inventory: { slotSetter: 'slot', occupiedTag: 'any', emptyTag: 'none', slots: [], hiddenSetter: 'hidden' },
        additions: { types: ['Gadget'] },
        buildSteps: [],
        sheet: {
          sections: [
            { id: 'scores', label: 'Scores', stats: ['grit'], beside: '{stat}:mod' },
            { id: 'other', label: 'Other', stats: ['luck', 'untitled'] },
            { id: 'runes', label: 'Runes', perBlock: true, stats: ['{name}:dc', '{name}:bonus', '{name}:raw'] },
            { id: 'gear', label: 'Gear', types: ['Gadget'] },
            { id: 'empty', label: 'Empty', types: ['Nothing'] },
          ],
        },
      },
    ],
  };
}

const rune = element('RUNE', 'Rune', {}, { spellcasting: [{ name: 'Runesmith', ability: 'Grit' }] });
const lamp = element('LAMP', 'Lamp');
const toggle = element('SWITCH', 'Switch', { hidden: 'true' });
const gem = element('GEM', 'Gem', {}, { requirements: { kind: 'has', id: 'NOPE' } });
const index = new MapElementIndex();
for (const e of [rune, lamp, toggle, gem]) index.add(e);

function tinker(): Character {
  const character = createCharacter('test', 'tinker');
  character.choices = [{ ruleKey: 'build/gear', elementIds: ['RUNE', 'LAMP', 'SWITCH'] }];
  return character;
}

function sheet(unmet?: Set<string>) {
  const sys = system();
  const kind = resolveCharacterKind(sys, 'tinker');
  return sheetView(deriveCharacter(tinker(), sys, index, { kind }), kind, unmet);
}
const section = (id: string) => sheet().sections.find((s) => s.id === id);

// Fails if a per-block row is labelled from the kind's stats rather than its block stat (every rune row reads its key),
// if it is looked up by its substituted key rather than the entry it came from (the same), or if a stat's label is
// not read (Grit reads "grit").
test('a row is called by its stat\'s label, a per-block row by its block stat\'s, and one nothing labels by its key', () => {
  assert.deepEqual(section('scores')!.rows.map((r) => r.label), ['Grit']);
  assert.deepEqual(section('other')!.rows.map((r) => r.label), ['Luck', 'untitled']);
  const runes = section('runes:runesmith')!;
  assert.equal(runes.label, 'Runes — Runesmith');
  assert.deepEqual(runes.rows.map((r) => [r.stat, r.label]), [
    ['runesmith:dc', 'Rune DC'],
    ['runesmith:bonus', 'Rune Bonus'],
    ['runesmith:raw', 'runesmith:raw'],
  ]);
});

// Fails if `signed` is ignored (Luck reads -1 either way, but the modifier reads "2" and the bonus "4"), if a block
// stat's `signed` is not read (the bonus reads "4"), or if `beside` is dropped (the score has nothing beside it).
test('a signed stat is written with its sign, and a row shows what its section puts beside it', () => {
  assert.deepEqual(section('scores')!.rows, [{ stat: 'grit', label: 'Grit', value: '14', beside: '+2' }]);
  assert.deepEqual(section('other')!.rows.map((r) => r.value), ['-1', '3']);
  assert.equal(section('other')!.rows[0]!.beside, undefined, 'a section with no beside puts nothing beside');
  assert.deepEqual(section('runes:runesmith')!.rows.map((r) => r.value), ['12', '+4', '1']);
});

test('a value is written as text, a signed number or a number, and a missing one as a dash', () => {
  const stat = (value: number, text?: string): ResolvedStat => ({ name: 's', value, contributions: [], ...(text !== undefined ? { text } : {}) });
  assert.equal(formatStatValue(undefined, false), '—');
  assert.equal(formatStatValue(stat(0, ''), false), '—', 'an empty text is nothing to show');
  assert.equal(formatStatValue(stat(0, 'plate'), true), 'plate');
  assert.equal(formatStatValue(stat(0), true), '+0');
  assert.equal(formatStatValue(stat(-3), true), '-3');
  assert.equal(formatStatValue(stat(5), false), '5');
});

// Fails if the sheet lists every held element (the hidden switch appears), if an empty section is kept, or if the unmet
// marker is not read.
test('a section lists what the sheet may list, marks what is unmet, and one with nothing to show is left out', () => {
  assert.deepEqual(section('gear')!.elements, [
    { elementId: 'RUNE', name: 'Rune' },
    { elementId: 'LAMP', name: 'Lamp' },
  ]);
  assert.equal(section('empty'), undefined);
  const marked = sheet(new Set(['LAMP'])).sections.find((s) => s.id === 'gear')!;
  assert.deepEqual(marked.elements[1], { elementId: 'LAMP', name: 'Lamp', prerequisitesUnmet: true });
  assert.equal(sheet().kindName, 'Tinker');
});

// Fails if the builder does not publish the sheet, or publishes it without the additions whose prerequisites fail.
test('the builder publishes the sheet, marking what the user added with its prerequisites unmet', () => {
  const character = { ...tinker(), formatVersion: 5 as const, additions: ['GEM'] };
  const state = new CharacterBuilder(character, system(), index).getState();
  const gear = state.sheet.sections.find((s) => s.id === 'gear')!;
  assert.deepEqual(gear.elements.find((e) => e.elementId === 'GEM'), { elementId: 'GEM', name: 'Gem', prerequisitesUnmet: true });
  assert.equal(state.sheet.elementCount, state.derived.elements.length);
});
