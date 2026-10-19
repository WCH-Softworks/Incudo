/**
 * Filling a form from the sheet document — ADR 0079 decisions 3 and 5.
 *
 * No game in the fixture: a document of a tinker with scores, a gear list, two rune blocks and a tiered list, and a map
 * of a made-up form. Each test names the change that fails it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { checkFormMap, diceTotal, formValues, recogniseForm, wrappedLines, type FormMap, type FormRule } from './form-fill.ts';
import type { SheetDocument } from './sheet-document.ts';

const doc: SheetDocument = {
  name: 'Nyx',
  title: 'Nyx',
  kindName: 'Tinker',
  sections: [
    {
      id: 'who',
      section: 'who',
      label: 'Who',
      rows: [],
      printed: [],
      elements: [
        { elementId: 'A', name: 'Gnome', type: 'Folk' },
        { elementId: 'B', name: 'Wright', type: 'Trade', progress: 3, dice: { count: 3, sides: 8 } },
        { elementId: 'C', name: 'Smith', type: 'Trade', progress: 2, dice: { count: 2, sides: 10 } },
        { elementId: 'D', name: 'Cook', type: 'Trade', progress: 1, dice: { count: 1, sides: 8 } },
      ],
    },
    {
      id: 'scores',
      section: 'scores',
      label: 'Scores',
      rows: [
        { stat: 'grit', label: 'Grit', value: '14', beside: '+2' },
        { stat: 'luck', label: 'Luck', value: '-1', mark: { label: 'deft', count: 1 } },
      ],
      printed: [],
      elements: [],
    },
    {
      id: 'hands',
      section: 'hands',
      label: 'Hands',
      rows: [
        { stat: 'left', label: 'Left', value: 'Hammer' },
        { stat: 'right', label: 'Right', value: 'Hammer' },
        { stat: 'belt', label: 'Belt', value: 'none' },
        { stat: 'back', label: 'Back', value: 'Saw' },
      ],
      printed: [],
      elements: [],
    },
    {
      id: 'gear',
      section: 'gear',
      label: 'Gear',
      rows: [],
      printed: [],
      elements: [
        { elementId: 'G1', name: 'Wrench', usage: '3/Day', action: 'Action' },
        { elementId: 'G2', name: 'Spanner' },
        { elementId: 'G3', name: 'Lamp' },
        { elementId: 'G4', name: 'Coil' },
      ],
    },
    { id: 'runes:a', section: 'runes', block: 'Alpha', label: 'Runes — Alpha', rows: [{ stat: 'alpha:dc', label: 'DC', value: '13' }], printed: [], elements: [] },
    { id: 'runes:b', section: 'runes', block: 'Beta', label: 'Runes — Beta', rows: [{ stat: 'beta:dc', label: 'DC', value: '12' }], printed: [], elements: [] },
    { id: 'pool', section: 'pool', label: 'Pool', rows: [{ stat: 'pool:1', label: 'Tier 1', value: '4' }, { stat: 'pool:2', label: 'Tier 2', value: '2' }], printed: [], elements: [] },
    { id: 'own:b', section: 'own', block: 'Beta', label: 'Own', rows: [{ stat: 'beta:own:1', label: 'Tier 1', value: '1' }], printed: [], elements: [] },
    {
      id: 'tricks',
      section: 'tricks',
      label: 'Tricks',
      rows: [],
      printed: [],
      elements: [
        { elementId: 'T0', name: 'Spark', group: { value: '0', label: 'Basic' } },
        { elementId: 'T1', name: 'Bolt', group: { value: '1', label: 'Tier 1' }, prepared: { label: 'ready', always: false } },
        { elementId: 'T2', name: 'Arc', group: { value: '1', label: 'Tier 1' } },
        { elementId: 'T3', name: 'Surge', group: { value: '1', label: 'Tier 1' }, prepared: { label: 'ready', always: true } },
        { elementId: 'T4', name: 'Storm', group: { value: '9', label: 'Tier 9' } },
      ],
    },
  ],
};

const fields: FormMap['fields'] = {
  Name: 'text', Folk: 'text', Trades: 'text', Dice: 'text', Grit: 'text', GritMod: 'text', Luck: 'text', LuckBox: 'check',
  GritBox: 'check', Rune: 'text', RuneDC: 'text', Hand1: 'text', Hand2: 'text', 'Gear A': 'text', 'Gear B': 'text',
  T1: 'text', T2: 'text', B0: 'text', B1a: 'text', B1b: 'text', P1a: 'check', P1b: 'check', Portrait: 'button',
};

const fill: FormRule[] = [
  { field: 'Name', value: 'name' },
  { field: 'Folk', list: { section: 'who', types: ['Folk'], join: ', ' } },
  { field: 'Trades', list: { section: 'who', types: ['Trade'], join: ' / ' } },
  { field: 'Dice', dice: { section: 'who' } },
  { field: 'Grit', row: { section: 'scores', stat: 'grit' } },
  { field: 'GritMod', row: { section: 'scores', stat: 'grit' }, part: 'beside' },
  { field: 'Luck', row: { section: 'scores', stat: 'LUCK' } },
  { field: 'LuckBox', mark: { section: 'scores', stat: 'luck' } },
  { field: 'GritBox', mark: { section: 'scores', stat: 'grit' } },
  { field: 'Rune', block: { section: 'runes' } },
  { field: 'RuneDC', row: { section: 'runes', stat: '{block}:dc' } },
  { fields: ['Hand1', 'Hand2'], rows: [{ section: 'hands', stat: 'left' }, { section: 'hands', stat: 'right' }, { section: 'hands', stat: 'belt' }, { section: 'hands', stat: 'back' }], skip: ['none'] },
  { flow: { fields: ['Gear A', 'Gear B'], capacity: [{ lines: 1, perLine: 30, fontSize: 7 }, { lines: 1, perLine: 10, fontSize: 6 }] }, list: { section: 'gear', join: '\n' } },
  { table: { sources: [{ section: 'pool', stat: 'pool:{n}' }, { section: 'own', stat: '{block}:own:{n}' }], fields: { '1': 'T1', '2': 'T2' } } },
  { groups: { section: 'tricks', levels: { '0': { lines: ['B0'] }, '1': { lines: ['B1a', 'B1b'], prepared: ['P1a', 'P1b'] } } } },
];

const map: FormMap = {
  formatVersion: 1,
  id: 'tinker-form',
  name: 'the tinker form',
  publisher: 'Nobody',
  download: 'https://example.invalid/form',
  system: 'test',
  kinds: ['tinker'],
  encoding: 'WinAnsi',
  fields,
  fill,
};

// Fails if any rule kind reads the wrong part of the document: a row by value or beside, a stat matched by case, a list
// not filtered by type, names not as the sheet names them (with the track's count), dice not added die by die largest
// first, the block not the first, `{block}` not substituted, an unmarked row ticked.
test('each rule writes what the document says, as the sheet words it', () => {
  const values = formValues(doc, map);
  assert.equal(values.text.Name, 'Nyx');
  assert.equal(values.text.Folk, 'Gnome');
  assert.equal(values.text.Trades, 'Wright 3 / Smith 2 / Cook 1');
  assert.equal(values.text.Dice, '2d10 + 4d8');
  assert.deepEqual([values.text.Grit, values.text.GritMod, values.text.Luck], ['14', '+2', '-1']);
  assert.equal(values.text.Rune, 'Alpha');
  assert.equal(values.text.RuneDC, '13');
  assert.ok(values.checked.includes('LuckBox'));
  assert.ok(!values.checked.includes('GritBox'));
  assert.equal(values.text.Portrait, undefined);
});

// Fails if repeats or skipped values take a line, if a value past the last line is dropped silently, if a list does not
// continue into the next box, or if what fits in neither is not named with its section.
test('rows and lists fill their run of fields in order, and what is past the last is named', () => {
  const values = formValues(doc, map);
  assert.deepEqual([values.text.Hand1, values.text.Hand2], ['Hammer', 'Saw']);
  assert.equal(values.text['Gear A'], 'Wrench (Action; 3/Day)');
  assert.equal(values.text['Gear B'], 'Spanner');
  // Written at the flow's own size; every other field keeps the form's.
  assert.deepEqual(values.fontSizes, { 'Gear A': 7, 'Gear B': 6 });
  assert.ok(values.leftOff.includes('2 of 4 Gear past the form\'s boxes'), values.leftOff.join(' | '));
});

// Fails if a table is not filled from its first source with rows, or if another source with rows is not named.
test('a table is the first source that has rows, and any other is named as left off', () => {
  const values = formValues(doc, map);
  assert.deepEqual([values.text.T1, values.text.T2], ['4', '2']);
  assert.ok(values.leftOff.includes('Own (Beta)'), values.leftOff.join(' | '));
});

// Fails if a group's elements are not put on its lines in the document's order, if a prepared element's box is not
// ticked (or an unprepared one is), if a group with more elements than lines does not name the rest, or if a group the
// form has no lines for is dropped silently.
test('groups go on their own lines with their prepared boxes, and what has no line is named', () => {
  const values = formValues(doc, map);
  assert.equal(values.text.B0, 'Spark');
  assert.deepEqual([values.text.B1a, values.text.B1b], ['Bolt', 'Arc']);
  assert.ok(values.checked.includes('P1a'));
  assert.ok(!values.checked.includes('P1b'));
  assert.ok(values.leftOff.includes('1 of 3 Tricks (Tier 1) past the form\'s lines'), values.leftOff.join(' | '));
  assert.ok(values.leftOff.includes('1 of 1 Tricks (Tier 9) past the form\'s lines'), values.leftOff.join(' | '));
});

// Fails if a second block of a section a rule reads is not named, or is named more than once.
test('a second block of a section is named as left off, once', () => {
  const values = formValues(doc, map);
  assert.equal(values.leftOff.filter((note) => note === 'Runes — Beta').length, 1);
});

// Fails if a character outside the form's encoding is written, dropped, or not named.
test("a character the form's font cannot write is written '?' and named", () => {
  const values = formValues({ ...doc, name: 'Nyx 星 Évora – “Ash”' }, map);
  assert.equal(values.text.Name, 'Nyx ? Évora – “Ash”');
  assert.ok(values.leftOff.some((note) => note.includes('星')));
  assert.ok(!formValues(doc, map).leftOff.some((note) => note.includes('cannot write')));
});

// Fails if recognition compares bytes or names loosely: a name with its trailing space missing, a field of another
// type, or one field more is not the form.
test('a copy is recognised by exactly its fields, names and types', () => {
  const all = Object.entries(fields).map(([name, type]) => ({ name, type }));
  assert.deepEqual(recogniseForm(all, map), { ok: true });
  assert.deepEqual(recogniseForm([...all].reverse(), map), { ok: true });
  const renamed = all.map((f) => (f.name === 'Gear A' ? { ...f, name: 'Gear A ' } : f));
  assert.equal(recogniseForm(renamed, map).ok, false);
  const retyped = all.map((f) => (f.name === 'LuckBox' ? { ...f, type: 'text' as const } : f));
  assert.equal(recogniseForm(retyped, map).ok, false);
  const more = [...all, { name: 'Extra', type: 'text' as const }];
  assert.deepEqual(recogniseForm(more, map), { ok: false, reason: `This PDF is not the tinker form: it has 24 form fields, 23 of them the 23 that sheet has.` });
  assert.deepEqual(recogniseForm([], map), { ok: false, reason: 'This PDF has no form fields, so it is not the tinker form.' });
});

// Fails if any of the checks a schema cannot make is removed: each broken map reads no error then.
test('a map writing a field the form lacks, of the wrong type, twice, or with a short capacity or box list is refused', () => {
  assert.deepEqual(checkFormMap(map, true).errors, []);
  const broken = (rule: FormRule) => checkFormMap({ ...map, fill: [...fill, rule] }, true).errors.map((e) => `${e.path}: ${e.message}`);
  assert.deepEqual(broken({ field: 'Nowhere', value: 'name' }), ['fill[15]: writes "Nowhere", which the form does not have']);
  assert.deepEqual(broken({ field: 'Portrait', value: 'name' }), ['fill[15]: writes "Portrait" as text, and the form\'s is button']);
  assert.deepEqual(broken({ field: 'Grit', value: 'name' }), ['fill[15]: writes "Grit", which fill[4] writes too']);
  const free = { ...map, fields: { ...fields, X: 'text' as const, Y: 'text' as const, Z: 'check' as const } };
  const errorsOf = (rule: FormRule) => checkFormMap({ ...free, fill: [...fill, rule] }, true).errors.map((e) => `${e.path}: ${e.message}`);
  assert.deepEqual(errorsOf({ flow: { fields: ['X', 'Y'], capacity: [{ lines: 1, perLine: 1, fontSize: 7 }] }, list: { section: 'gear', join: ', ' } }), ['fill[15].flow: needs one capacity per field']);
  assert.deepEqual(errorsOf({ groups: { section: 'tricks', levels: { '2': { lines: ['X', 'Y'], prepared: ['Z'] } } } }), ['fill[15].groups.levels.2: needs one prepared box per line']);
});

// Fails if wrapping counts characters rather than whole words, ignores line breaks, or does not split a word longer than
// a line.
test('wrapped lines count whole words per line, line breaks, and a word longer than a line', () => {
  assert.equal(wrappedLines('aa bb cc', 5), 2);
  assert.equal(wrappedLines('aa bb', 5), 1);
  // The space between two words takes a character of the line too.
  assert.equal(wrappedLines('aa bb', 4), 2);
  assert.equal(wrappedLines('aa\nbb', 10), 2);
  assert.equal(wrappedLines('abcdefghijk', 5), 3);
  assert.equal(wrappedLines('', 5), 1);
});

test('dice add up die by die, the largest die first', () => {
  assert.equal(diceTotal([{ count: 3, sides: 10 }, { count: 3, sides: 6 }]), '3d10 + 3d6');
  assert.equal(diceTotal([{ count: 3, sides: 10 }, { count: 3, sides: 10 }]), '6d10');
  assert.equal(diceTotal([{ count: 4, sides: 6 }, { count: 2, sides: 12 }, { count: 1, sides: 6 }]), '2d12 + 5d6');
});

test("a section's attacks fill one row of boxes each, in order, and what is past the last row is named — ADR 0093", () => {
  const attack = (name: string, bonus: string, damage: string) => ({ instanceId: name, elementId: name, name, equipped: true, bonus, damage, alternatives: [], properties: [] });
  const armed: SheetDocument = {
    ...doc,
    sections: [
      ...doc.sections,
      { id: 'strikes', section: 'strikes', label: 'Strikes', rows: [], printed: [], elements: [], attacks: [attack('Hammer', '+5', '1d8+3 bashing'), attack('Saw', '+2', '1d4'), attack('Awl', '+4', '1d4+2')] },
    ],
  };
  const rows = [
    { name: 'W1', bonus: 'W1B', damage: 'W1D' },
    { name: 'W2', bonus: 'W2B ', damage: 'W2D' },
  ];
  const strikes: FormMap = { ...map, fields: { ...fields, W1: 'text', W1B: 'text', W1D: 'text', W2: 'text', 'W2B ': 'text', W2D: 'text' }, fill: [{ attacks: { section: 'strikes', rows } }] };
  assert.deepEqual(checkFormMap(strikes, true).errors, []);
  const values = formValues(armed, strikes);
  // Fails if a box takes another part of the attack, if the rows are not filled in order, or if the third is dropped silently.
  assert.deepEqual(values.text, { W1: 'Hammer', W1B: '+5', W1D: '1d8+3 bashing', W2: 'Saw', 'W2B ': '+2', W2D: '1d4' });
  assert.deepEqual(values.leftOff, ["1 of 3 Strikes past the form's 2 lines: Awl"]);
  // Fails if the rule's fields are not checked against the form's.
  assert.deepEqual(checkFormMap({ ...strikes, fields }, true).errors.map((e) => e.message)[0], 'writes "W1", which the form does not have');
});
