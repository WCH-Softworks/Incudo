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

import { formatStatValue, rowMark, sheetSections, sheetView } from './sheet.ts';
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
    elementTypes: [{ name: 'Gadget' }, { name: 'Charm' }, { name: 'Nothing' }],
    stats: [
      { name: 'grit', label: 'Grit', default: 14 },
      {
        name: 'grit:mod',
        signed: true,
        derive: { kind: 'call', fn: 'floor', args: [{ kind: 'binary', op: '/', left: { kind: 'binary', op: '-', left: { kind: 'ref', stat: 'grit' }, right: num(10) }, right: num(2) }] },
      },
      { name: 'luck', label: 'Luck', default: -1, signed: true },
      { name: 'untitled', default: 3 },
      { name: 'knack', default: 2 },
      { name: 'grit:knack', default: 4 },
      { name: 'luck:knack', default: 2 },
      { name: 'untitled:knack', default: 6 },
    ],
    characterKinds: [
      {
        id: 'tinker',
        name: 'Tinker',
        default: true,
        progression: { kind: 'none' },
        elementTypes: ['Gadget', 'Charm', 'Nothing'],
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
            { id: 'marked', label: 'Marked', stats: ['grit', 'luck', 'untitled', 'knack'], mark: { stat: '{stat}:knack', per: 'knack', labels: ['handy', 'deft'] } },
            { id: 'runes', label: 'Runes', perBlock: true, stats: ['{name}:dc', '{name}:bonus', '{name}:raw'] },
            { id: 'gear', label: 'Gear', types: ['Charm', 'Gadget'] },
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
const charm = element('CHARM', 'Charm', {}, { type: 'Charm' });
const index = new MapElementIndex();
for (const e of [rune, lamp, toggle, gem, charm]) index.add(e);

function tinker(): Character {
  const character = createCharacter('test', 'tinker');
  character.choices = [{ ruleKey: 'build/gear', elementIds: ['RUNE', 'LAMP', 'SWITCH', 'CHARM'] }];
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

// Fails if the sheet lists every held element (the hidden switch appears), if an empty section is kept, if the unmet
// marker is not read, or if the elements are listed in the order held rather than the order of the section's types
// (the charm, held last, is of the section's first type).
test("a section lists what the sheet may list, by its types' order, marks what is unmet, and one with nothing is left out", () => {
  assert.deepEqual(section('gear')!.elements, [
    { elementId: 'CHARM', name: 'Charm', type: 'Charm' },
    { elementId: 'RUNE', name: 'Rune', type: 'Gadget' },
    { elementId: 'LAMP', name: 'Lamp', type: 'Gadget' },
  ]);
  assert.equal(section('empty'), undefined);
  const marked = sheet(new Set(['LAMP'])).sections.find((s) => s.id === 'gear')!;
  assert.deepEqual(marked.elements[2], { elementId: 'LAMP', name: 'Lamp', type: 'Gadget', prerequisitesUnmet: true });
  assert.equal(sheet().kindName, 'Tinker');
});

// Fails if the builder does not publish the sheet, or publishes it without the additions whose prerequisites fail.
test('the builder publishes the sheet, marking what the user added with its prerequisites unmet', () => {
  const character = { ...tinker(), formatVersion: 5 as const, additions: ['GEM'] };
  const state = new CharacterBuilder(character, system(), index).getState();
  const gear = state.sheet.sections.find((s) => s.id === 'gear')!;
  assert.deepEqual(gear.elements.find((e) => e.elementId === 'GEM'), { elementId: 'GEM', name: 'Gem', type: 'Gadget', prerequisitesUnmet: true });
});

// ADR 0079. Fails if a section's `mark` is not read (no row is marked), if the count is not taken against `per` (grit's 4
// would read as four), if more multiples than labels do not read as the last label (untitled's 6 has no mark), or if
// a row whose mark stat is not published is marked (knack has no "knack:knack").
test('a row is marked by how many times its mark stat holds the per stat, the last label for any more', () => {
  assert.deepEqual(
    section('marked')!.rows.map((r) => [r.stat, r.mark]),
    [
      ['grit', { label: 'deft', count: 2 }],
      ['luck', { label: 'handy', count: 1 }],
      ['untitled', { label: 'deft', count: 3 }],
      ['knack', undefined],
    ],
  );
  assert.equal(section('scores')!.rows[0]!.mark, undefined, 'a section with no mark marks nothing');
});

// Fails if a part of a multiple is read as one (a half reads "handy"), if a per of 0 divides (Infinity marks everything),
// or if a value that is a whole multiple written as a float is floored below it.
test('rowMark counts whole multiples only, and nothing against a per of zero or no labels', () => {
  assert.equal(rowMark(1, 2, ['a']), undefined);
  assert.equal(rowMark(5, 0, ['a']), undefined);
  assert.equal(rowMark(5, undefined, ['a']), undefined);
  assert.equal(rowMark(4, 2, []), undefined);
  assert.deepEqual(rowMark(0.3 * 3, 0.3, ['a', 'b', 'c']), { label: 'c', count: 3 });
  assert.deepEqual(rowMark(7, 3, ['a', 'b']), { label: 'b', count: 2 });
});

// ADR 0079. A kind whose progression publishes a track's count as `rank:{name}`, and a character of rank 4 holding one
// Charm, its implicit track. Fails if sheetView does not hand sections the kind's progression (nothing is counted), if a
// section's `trackProgress` is not read (the Charm reads no count), if a section without it writes one (Gear reads 4),
// or if an element merely sharing a track stat's name is counted (the Lamp, whose `rank:lamp` content wrote, reads 7).
test("a section that writes a track's count lists the track's root with what the derivation published", () => {
  const sys = system();
  const base = sys.characterKinds[0]!;
  sys.stats.push({ name: 'rank', default: 0 });
  sys.characterKinds[0] = {
    ...base,
    progression: { kind: 'level', min: 1, max: 10, stat: 'rank', trackStatPattern: 'rank:{name}', trackType: 'Charm' },
    sheet: {
      sections: [
        { id: 'who', label: 'Who', types: ['Charm', 'Gadget'], trackProgress: true },
        { id: 'gear', label: 'Gear', types: ['Charm'] },
      ],
    },
  };
  const named = element('NAMED', 'Named', {}, { rules: [{ kind: 'stat', key: 'rank', name: 'rank:lamp', value: num(7) }] });
  const local = new MapElementIndex();
  for (const e of [lamp, charm, named]) local.add(e);
  const character = createCharacter('test', 'tinker');
  character.progress = 4;
  character.choices = [{ ruleKey: 'build/gear', elementIds: ['LAMP', 'CHARM', 'NAMED'] }];
  const kind = resolveCharacterKind(sys, 'tinker');
  const derived = deriveCharacter(character, sys, local, { kind });
  assert.equal(derived.stats.get('rank:lamp')?.value, 7, 'content wrote a stat sharing the Lamp\'s track name');
  const view = sheetView(derived, kind);
  const who = view.sections.find((s) => s.id === 'who')!;
  assert.deepEqual(who.elements.map((e) => [e.name, e.progress]), [['Charm', 4], ['Lamp', undefined], ['Named', undefined]]);
  assert.equal(view.sections.find((s) => s.id === 'gear')!.elements[0]!.progress, undefined);
});

// ADR 0079. A section of Gadgets grouped by tier and marking what two prepared lists hold, one of them naming a gadget
// the character does not hold (found through the lookup). Fails if the group is not read (no labels, held order), if
// groups sort as text (tier 10 before tier 2) or within one other than by name, if what is in no group is not last, if
// an unheld prepared gadget is not listed (or listed without a lookup), if `always` and `chosen` swap labels, if a
// section without `preparedMark` marks anything, or if a recorded entry the block cannot prepare is marked.
test('a section groups what it lists by a setter and marks what the prepared lists hold, listing what they hold and the character does not', () => {
  const held = [
    element('ZAP', 'Zap', { tier: '2' }),
    element('ARC', 'Arc', { tier: '10' }),
    element('ODD', 'Odd'),
    element('BUZZ', 'Buzz', { tier: '2' }),
    element('PIP', 'Pip', { tier: '0' }),
    element('DUD', 'Dud', { tier: '1' }),
  ];
  const unheld = element('HUM', 'Hum', { tier: '1' });
  const preparation = [
    { key: 'orange', name: 'Orange', limit: 3, mode: 'list' as const, always: ['ZAP'], held: [], chosen: ['HUM'], unavailable: ['DUD'], over: 0 },
    { key: 'lemon', name: 'Lemon', limit: 3, mode: 'held' as const, always: [], held: ['ARC'], chosen: ['ARC'], unavailable: [], over: 0 },
  ];
  const sections = [
    {
      id: 'list', label: 'List', types: ['Gadget'],
      group: { setter: 'tier', label: 'Tier {value}', labels: { '0': 'Trinket' } },
      preparedMark: { always: 'bolted on', chosen: 'packed' },
    },
    { id: 'plain', label: 'Plain', types: ['Gadget'] },
  ];
  const source = { stats: new Map<string, ResolvedStat>(), elements: held, preparation, lookup: (id: string) => (id === 'HUM' ? unheld : undefined) };
  const [list, plain] = sheetSections(sections, source, { stats: [], blockStats: [] });
  assert.deepEqual(
    list!.elements.map((e) => [e.name, e.group?.label, e.prepared?.label, e.prepared?.always]),
    [
      ['Pip', 'Trinket', undefined, undefined],
      ['Dud', 'Tier 1', undefined, undefined],
      ['Hum', 'Tier 1', 'packed', false],
      ['Buzz', 'Tier 2', undefined, undefined],
      ['Zap', 'Tier 2', 'bolted on', true],
      ['Arc', 'Tier 10', 'packed', false],
      ['Odd', undefined, undefined, undefined],
    ],
  );
  assert.deepEqual(plain!.elements.map((e) => e.name), ['Zap', 'Arc', 'Odd', 'Buzz', 'Pip', 'Dud']);
  assert.ok(plain!.elements.every((e) => e.group === undefined && e.prepared === undefined));
  const [noLookup] = sheetSections(sections, { ...source, lookup: undefined }, { stats: [], blockStats: [] });
  assert.ok(!noLookup!.elements.some((e) => e.name === 'Hum'));
});

// ADR 0079. The same rank-4 Tinker holding one Charm, its implicit track, whose `die` setter reads d8, and a Lamp whose
// `die` reads d6 and roots no track. Fails if a section's `trackDie` is not read (the Charm has no dice), if the dice are
// not the track's count (they read 1d8, or the Lamp gets some), if the setter is not read through `trackDie` (a Bolt whose
// die reads "8" gets 4d8), or if a section without it writes dice (Gear).
test("a section that writes a track's dice lists the track's root with its count of the die its setter names", () => {
  const sys = system();
  const base = sys.characterKinds[0]!;
  sys.stats.push({ name: 'rank', default: 0 });
  sys.characterKinds[0] = {
    ...base,
    progression: { kind: 'level', min: 1, max: 10, stat: 'rank', trackStatPattern: 'rank:{name}', trackType: 'Charm' },
    sheet: {
      sections: [
        { id: 'who', label: 'Who', types: ['Charm', 'Gadget'], trackProgress: true, trackDie: 'die' },
        { id: 'gear', label: 'Gear', types: ['Charm'], trackProgress: true },
      ],
    },
  };
  const dieCharm = element('CHARM', 'Charm', { die: 'd8' }, { type: 'Charm' });
  const dieLamp = element('LAMP', 'Lamp', { die: 'd6' });
  const local = new MapElementIndex();
  for (const e of [dieLamp, dieCharm]) local.add(e);
  const character = createCharacter('test', 'tinker');
  character.progress = 4;
  character.choices = [{ ruleKey: 'build/gear', elementIds: ['LAMP', 'CHARM'] }];
  const kind = resolveCharacterKind(sys, 'tinker');
  const view = sheetView(deriveCharacter(character, sys, local, { kind }), kind);
  const who = view.sections.find((s) => s.id === 'who')!;
  assert.deepEqual(who.elements.map((e) => [e.name, e.progress, e.dice]), [['Charm', 4, { count: 4, sides: 8 }], ['Lamp', undefined, undefined]]);
  assert.equal(view.sections.find((s) => s.id === 'gear')!.elements[0]!.dice, undefined);

  const bolt = element('CHARM', 'Charm', { die: '8' }, { type: 'Charm' });
  const boltIndex = new MapElementIndex();
  boltIndex.add(bolt);
  const boltView = sheetView(deriveCharacter({ ...character, choices: [{ ruleKey: 'build/gear', elementIds: ['CHARM'] }] }, sys, boltIndex, { kind }), kind);
  assert.deepEqual(boltView.sections.find((s) => s.id === 'who')!.elements.map((e) => [e.progress, e.dice]), [[4, undefined]]);
});

// ADR 0079. Fails if a listed element's type is left out (a form filler could not tell a class from a race in one
// section), if a section does not say which declared section it came from, or if a per-block section does not name its
// block (its id names it too, but only as the system spells the id).
test("a section names the section it came from and its block, and a listed element its type", () => {
  const view = sheet();
  const gear = view.sections.find((s) => s.id === 'gear')!;
  assert.equal(gear.section, 'gear');
  assert.equal(gear.block, undefined);
  assert.deepEqual(gear.elements.map((e) => [e.name, e.type]), [['Charm', 'Charm'], ['Rune', 'Gadget'], ['Lamp', 'Gadget']]);
  const runes = view.sections.filter((s) => s.section === 'runes');
  assert.deepEqual(runes.map((s) => s.block), ['Runesmith']);
  assert.notEqual(runes[0]!.id, 'runes');
});
