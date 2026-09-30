/**
 * What content writes for an element on a sheet, as the sheet view carries it — ADR 0076.
 *
 * No game in the fixture: a character spends levels on two tracks, one of which grants a gadget whose sheet text grows
 * with the track's level. Each test names the change that fails it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createCharacter,
  deriveCharacter,
  MapElementIndex,
  resolveCharacterKind,
  type Element,
  type GameSystem,
  type ResolvedStat,
  type SheetHints,
} from '@incudo/core';

import { listedName, listedUsage, sheetDocument } from './sheet-document.ts';
import { sheetMarkdown } from './sheet-markdown.ts';
import { fillPlaceholders, sheetSections, sheetView, type SheetSource } from './sheet.ts';

function element(id: string, type: string, sheet?: SheetHints, extra: Partial<Element> = {}): Element {
  return { id, type, name: id, source: 'Test Book', setters: {}, rules: [], supports: [], origin: { sourceId: 'test', format: 'incudo' }, ...(sheet ? { sheet } : {}), ...extra };
}

const stat = (name: string, value: number, text?: string): [string, ResolvedStat] => [name, { name, value, contributions: [], ...(text !== undefined ? { text } : {}) }];

const STATS = new Map<string, ResolvedStat>([stat('grit', 3), stat('level:tinker', 5), stat('die', 0, 'd8'), stat('odd', 0, 'a<b & c')]);

const GROWING: SheetHints = {
  action: 'Bonus Action',
  usage: '{{grit}}/Long Rest',
  description: 'At first, +{{grit}}.',
  descriptions: [
    { text: 'At first, +{{grit}}.' },
    { text: 'From three, {{die}}.', level: 3, action: 'Action' },
    { text: 'From five.', level: 5, usage: 'Unlimited' },
  ],
};

function source(elements: Element[], gateLevels: Record<string, number> = {}): SheetSource {
  return { stats: STATS, elements, gateLevels: new Map(Object.entries(gateLevels)) };
}

const listed = (elements: Element[], gateLevels?: Record<string, number>, omitHidden = false) =>
  sheetSections([{ id: 'list', label: 'List', types: ['Gadget'], ...(omitHidden ? { omitHidden } : {}) }], source(elements, gateLevels), { stats: [], blockStats: [] })[0]
    ?.elements ?? [];

test('the text shown is the one for the level the element gates at, with its own usage and action over the sheet\'s', () => {
  // Fails with the text chosen at level 0 whatever the gate level (every row reads "At first"), or with a description's
  // own usage or action ignored (level 5 reads "3/Long Rest", level 3 "Bonus Action").
  const gadget = element('G', 'Gadget', GROWING);
  assert.deepEqual(listed([gadget], { G: 1 })[0], {
    elementId: 'G',
    name: 'G',
    text: 'At first, +3.',
    usage: '3/Long Rest',
    action: 'Bonus Action',
  });
  assert.deepEqual(listed([gadget], { G: 4 })[0], { elementId: 'G', name: 'G', text: 'From three, d8.', usage: '3/Long Rest', action: 'Action' });
  assert.deepEqual(listed([gadget], { G: 5 })[0], { elementId: 'G', name: 'G', text: 'From five.', usage: 'Unlimited', action: 'Bonus Action' });
  assert.equal(listed([gadget])[0]!.text, 'At first, +3.', 'an element the derivation gives no level reads its ungated text');
});

test('a save written before every description was kept shows its one text at every level', () => {
  // Fails with the view reading `descriptions` only (the old save shows no text).
  const old = element('OLD', 'Gadget', { usage: '1/Long Rest', description: 'The first text.' });
  assert.equal(listed([old], { OLD: 20 })[0]!.text, 'The first text.');
  assert.equal(listed([old], { OLD: 20 })[0]!.usage, '1/Long Rest');
});

test('a placeholder is written as the sheet writes its stat, `:half:up` read as a rule reads it, and nothing published is a dash', () => {
  // Fails with `:half:up` left to the direct lookup (it reads "—"), rounded down (2), a text stat written as its
  // number (0), a value written into HTML unescaped, or an unpublished stat left as its braces or not counted.
  assert.deepEqual(fillPlaceholders('{{level:tinker:half:up}} and {{LEVEL:TINKER:half}}', STATS), { text: '3 and 2', unfilled: [] });
  assert.deepEqual(fillPlaceholders('A {{die}}.', STATS), { text: 'A d8.', unfilled: [] });
  assert.deepEqual(fillPlaceholders('{{odd}}', STATS, true), { text: 'a&lt;b &amp; c', unfilled: [] });
  assert.deepEqual(fillPlaceholders('{{odd}}', STATS, false), { text: 'a<b & c', unfilled: [] });
  assert.deepEqual(fillPlaceholders('+{{nothing}} and {{nothing:half}}', STATS), { text: '+— and —', unfilled: ['nothing', 'nothing:half'] });
  const gadget = element('G', 'Gadget', { usage: '{{nowhere}}/Day', description: 'Text.' });
  assert.deepEqual(listed([gadget])[0]!.unfilled, ['nowhere']);
});

test('the name a sheet gives an element is its alt, else its name attribute, and only when it differs', () => {
  // Fails with `alt` unread (Turn Undead keeps its long name), `name` unread, or a sheet name written when it repeats
  // the element's (every row carries one).
  const alt = element('Channel Divinity: Turn Undead', 'Gadget', { alt: 'Turn Undead', name: 'Other' });
  const named = element('Feature: Researcher', 'Gadget', { name: 'Researcher' });
  const same = element('Same', 'Gadget', { alt: 'Same' });
  const [a, b, c] = listed([alt, named, same]);
  assert.equal(a!.sheetName, 'Turn Undead');
  assert.equal(b!.sheetName, 'Researcher');
  assert.equal(c!.sheetName, undefined);
  assert.equal(listedName(a!), 'Turn Undead');
  assert.equal(listedName(c!), 'Same');
});

test('a text keeps the lines content wrote, without the file\'s indentation or blank lines', () => {
  // Fails with the text taken whole (the tabs and the blank line stay), or joined into one line.
  const gadget = element('G', 'Gadget', { description: 'You gain:\n\t\t\t&#x2022; Bite.\n\n\t\t\t&#x2022; Claw.\n\t\t' });
  assert.equal(listed([gadget])[0]!.text, 'You gain:\n&#x2022; Bite.\n&#x2022; Claw.');
});

test('a section that omits hidden elements leaves out what content hides; one that does not keeps it', () => {
  // Fails with `omitHidden` unread (the placeholder is listed), or honoured everywhere (the section without it loses
  // it, as a sheet's header would lose every class).
  const hidden = element('PLACEHOLDER', 'Gadget', { display: false, description: 'Chosen below.' });
  const shown = element('SHOWN', 'Gadget', { display: true });
  assert.deepEqual(listed([hidden, shown], {}, true).map((e) => e.elementId), ['SHOWN']);
  assert.deepEqual(listed([hidden, shown]).map((e) => e.elementId), ['PLACEHOLDER', 'SHOWN']);
});

test('a hidden element a section lists anyway is named, with no sheet line', () => {
  // Fails with the hint read only for leaving elements out: a header would read "Paladin: A holy warrior bound to …",
  // the line content wrote for a feature list it keeps the class out of (found by running it on a 2014 sample).
  const klass = element('Paladin', 'Gadget', { display: false, alt: 'Holy Warrior', usage: '1/Day', description: 'A holy warrior bound to a sacred oath.' });
  assert.deepEqual(listed([klass]), [{ elementId: 'Paladin', name: 'Paladin', sheetName: 'Holy Warrior' }]);
});

test('an element with no hints is listed as it was', () => {
  // Fails with any field written for an element content writes nothing for.
  assert.deepEqual(listed([element('PLAIN', 'Gadget')]), [{ elementId: 'PLAIN', name: 'PLAIN' }]);
  assert.equal(listedUsage({}), undefined);
  assert.equal(listedUsage({ usage: '2/Day' }), '2/Day');
  assert.equal(listedUsage({ action: 'Reaction', usage: '2/Day' }), 'Reaction; 2/Day');
});

// --- through the engine: the gate level is the track's, not the character's ------------------------------------------

function system(): GameSystem {
  return {
    formatVersion: 1,
    id: 'test',
    name: 'Test System',
    version: '1.0.0',
    elementTypes: [{ name: 'Track' }, { name: 'Gadget' }],
    stats: [{ name: 'grit', default: 3 }],
    characterKinds: [
      {
        id: 'levelled',
        name: 'Levelled',
        default: true,
        progression: { kind: 'level', min: 1, max: 20, trackStatPattern: 'level:{name}' },
        elementTypes: ['Track', 'Gadget'],
        buildSteps: [],
        sheet: { sections: [{ id: 'gadgets', label: 'Gadgets', types: ['Gadget'], omitHidden: true }] },
      },
    ],
  };
}

test('a multiclass character reads a feature\'s text at its track\'s level, and the export writes it as a sheet line', () => {
  // Fails with the text chosen by the character's level (6 reads "From five."), which is the one case the samples
  // separate (ADR 0076); or with the export writing the element by name alone.
  const index = new MapElementIndex();
  index.addAll([
    element('ALPHA', 'Track', undefined, { rules: [{ kind: 'grant', key: 'g', type: 'Gadget', id: 'G' }] }),
    element('BETA', 'Track'),
    element('G', 'Gadget', GROWING),
  ]);
  const character = createCharacter('test', 'levelled');
  character.name = 'Tester';
  character.progress = 6;
  character.advancement = [1, 2, 3, 4, 5, 6].map((at) => ({ at, elementId: at <= 3 ? 'ALPHA' : 'BETA' }));
  const sys = system();
  const kind = resolveCharacterKind(sys, 'levelled');
  const view = sheetView(deriveCharacter(character, sys, index, { kind }), kind);
  const listedGadget = view.sections[0]!.elements[0]!;
  assert.equal(listedGadget.text, 'From three, —.', 'the track is at 3, and nothing publishes `die` here');
  assert.deepEqual(listedGadget.unfilled, ['die']);
  assert.equal(view.unfilled, 1);

  const markdown = sheetMarkdown(sheetDocument({ character, sheet: view, references: { label: 'For reference', rows: [] } }));
  assert.match(markdown, /^- \*\*G\*\* \(Action; 3\/Long Rest\): From three, —\.$/m);
});

test('the export writes each line of a sheet text as a line of the item, and reads its markup as Markdown', () => {
  // Fails with the lines joined into one (no hard break), with the HTML written as it is (`<i>` reaches the file), or
  // with the unmet marker dropped from a hinted element.
  const document = sheetDocument({
    character: { name: 'Tester' },
    sheet: {
      kindName: 'Tinker',
      elementCount: 1,
      unfilled: 0,
      sections: [
        {
          id: 'features',
          label: 'Features',
          rows: [],
          printed: [],
          elements: [
            { elementId: 'W', name: 'Natural Weapons', text: 'You gain <i>these</i>:\n&#x2022; Bite *hard*.\n&#x2022; Claw.' },
            { elementId: 'U', name: 'Channel Divinity: Turn', sheetName: 'Turn', prerequisitesUnmet: true, usage: 'Channel Divinity' },
          ],
        },
      ],
    },
    references: { label: 'For reference', rows: [] },
  });
  const lines = sheetMarkdown(document).split('\n');
  const at = lines.indexOf('- **Natural Weapons**: You gain *these*:  ');
  assert.notEqual(at, -1, lines.join('\n'));
  assert.deepEqual(lines.slice(at + 1, at + 3), ['  • Bite \\*hard\\*.  ', '  • Claw.']);
  assert.ok(lines.includes('- **Turn** (prerequisites not met) (Channel Divinity)'), lines.join('\n'));
});
