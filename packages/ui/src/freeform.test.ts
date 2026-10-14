/**
 * The text a user writes about a character, as the builder writes it and every sheet shows it — ADR 0092.
 *
 * No game in the fixture: a hero whose kind declares a "Looks" group (Eyes, Height) and an ungrouped multi-line Story.
 * The character also carries a key no field declares, as an Aurora import does with its coins. Each test names the
 * change that fails it, and each was run.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createCharacter, MapElementIndex, setFreeform, type Character, type GameSystem } from '@incudo/core';

import { formValues, type FormMap } from './form-fill.ts';
import { chosenUnderSelect, freeformState, sheetFreeform } from './freeform.ts';
import { DEFAULT_PRINT_OPTIONS, printOptionsView, printPartsOf } from './print-options.ts';
import { sheetDocument } from './sheet-document.ts';
import { sheetMarkdown } from './sheet-markdown.ts';
import { CharacterBuilder } from './use-character-builder.ts';

function system(freeform = true): GameSystem {
  return {
    formatVersion: 1,
    id: 'test',
    name: 'Test',
    version: '1.0.0',
    elementTypes: [{ name: 'Knack' }],
    stats: [{ name: 'might', label: 'Might', default: 10 }],
    characterKinds: [
      {
        id: 'hero',
        name: 'Hero',
        default: true,
        progression: { kind: 'none' },
        elementTypes: ['Knack'],
        ...(freeform
          ? {
              freeform: {
                label: 'About',
                description: 'Words.',
                fields: [
                  { key: 'look.eyes', label: 'Eyes', group: 'Looks' },
                  { key: 'look.height', label: 'Height', group: 'Looks' },
                  { key: 'story', label: 'Story', multiline: true },
                ],
              },
            }
          : {}),
        buildSteps: [],
        sheet: { sections: [{ id: 'numbers', label: 'Numbers', stats: ['might'] }] },
      },
    ],
  };
}

const index = new MapElementIndex();
const imported = (): Character => ({ ...createCharacter('test', 'hero', { name: 'Hero' }), freeform: { 'coins.gold': '12', 'look.eyes': 'Grey' } });

test('setFreeform keeps text as typed, removes a blank one, and returns the character when nothing moves', () => {
  // Fails if a blank value is kept (an emptied field would print an empty heading), if a value is trimmed as it is
  // typed (a space before the next word would be lost), or if an unchanged write makes a new character.
  const c = createCharacter('test', 'hero');
  const written = setFreeform(c, 'story', 'Born at sea ');
  assert.equal(written.freeform['story'], 'Born at sea ');
  assert.equal(written.formatVersion, c.formatVersion);
  assert.equal(setFreeform(written, 'story', 'Born at sea '), written);
  assert.deepEqual(setFreeform(written, 'story', '  \n ').freeform, {});
  assert.equal(setFreeform(c, 'story', ''), c);
});

test('the editor lists every declared field, grouped as the kind groups them, and nothing else', () => {
  // Fails if an undeclared key is listed (an import's coins would be offered as text), or if groups are not consecutive.
  const state = freeformState(imported(), system().characterKinds[0] as never);
  assert.equal(state.available, true);
  assert.deepEqual(
    state.groups.map((g) => [g.label, g.fields.map((f) => `${f.label}=${f.value}`)]),
    [
      ['Looks', ['Eyes=Grey', 'Height=']],
      [undefined, ['Story=']],
    ],
  );
  assert.equal(freeformState(imported(), {}).available, false);
});

test('the builder writes a field without re-deriving, and the sheet shows only what is written', () => {
  // Fails if setFreeform re-derives (a keystroke on a phone would derive the character again), or if the document
  // shows an empty field or an undeclared key.
  const b = new CharacterBuilder(imported(), system(), index);
  const before = b.getState();
  b.setFreeform('story', 'Line one\r\nline two\n\n  Second paragraph  ');
  const after = b.getState();
  assert.equal(after.derived, before.derived);
  assert.equal(after.character.freeform['story'], 'Line one\r\nline two\n\n  Second paragraph  ');
  const doc = sheetDocument(after);
  assert.deepEqual(doc.freeform, {
    label: 'About',
    groups: [
      { label: 'Looks', entries: [{ key: 'look.eyes', label: 'Eyes', multiline: false, text: 'Grey' }] },
      { entries: [{ key: 'story', label: 'Story', multiline: true, text: 'Line one\nline two\n\n  Second paragraph' }] },
    ],
  });
  assert.ok(!JSON.stringify(doc).includes('12'), 'the coins stay off the sheet');
  assert.equal(sheetFreeform(freeformState(createCharacter('test', 'hero'), system().characterKinds[0] as never)), undefined);
  assert.equal(sheetDocument(new CharacterBuilder(imported(), system(false), index).getState()).freeform, undefined);
});

test('the text export writes a group as a heading, one-line fields as a list and a long one as paragraphs', () => {
  // Fails if the part is left out of the export, or if a multi-line field's paragraphs run together.
  const b = new CharacterBuilder(imported(), system(), index);
  b.setFreeform('look.height', '*tall*');
  b.setFreeform('story', 'First.\n\nSecond.');
  const markdown = sheetMarkdown(sheetDocument(b.getState()));
  assert.ok(markdown.includes('## About\n\n### Looks\n\n- Eyes: Grey\n- Height: \\*tall\\*\n\n### Story\n\nFirst.\n\nSecond.\n'), markdown);
});

test('the print step offers the part when something is written, and not otherwise', () => {
  // Fails if the part is never offered (it could not be left off a print) or offered empty.
  const written = sheetDocument(new CharacterBuilder(imported(), system(), index).getState());
  assert.deepEqual(printPartsOf(written), ['sections', 'freeform']);
  assert.deepEqual(
    printOptionsView(written, DEFAULT_PRINT_OPTIONS).parts?.choices.map((c) => c.label),
    ["The character's own sections", 'About'],
  );
  const blank = sheetDocument(new CharacterBuilder(createCharacter('test', 'hero'), system(), index).getState());
  assert.deepEqual(printPartsOf(blank), ['sections']);
});

test('a form fills a box from a field, writes long text whole and names it as running past the box', () => {
  // Fails if the rule reads the character rather than the document, cuts the text, or says nothing when it overflows.
  const b = new CharacterBuilder(imported(), system(), index);
  b.setFreeform('story', 'one two three four five six seven eight nine ten');
  const map = {
    fill: [
      { field: 'Eyes', freeform: 'look.eyes' },
      { field: 'Height', freeform: 'look.height' },
      { field: 'Story', freeform: 'story', capacity: { lines: 2, perLine: 10, fontSize: 7 } },
    ],
    encoding: 'WinAnsi',
  } as unknown as FormMap;
  const values = formValues(sheetDocument(b.getState()), map);
  assert.deepEqual(values.text, { Eyes: 'Grey', Story: 'one two three four five six seven eight nine ten' });
  assert.deepEqual(values.fontSizes, { Story: 7 });
  assert.deepEqual(values.leftOff, ["Story runs past the form's box"]);
  b.setFreeform('story', 'short');
  assert.deepEqual(formValues(sheetDocument(b.getState()), map).leftOff, []);
});

test('a field stands in with what was chosen under the selects it names, until something is typed', () => {
  // Fails if `suggestedBy` is not read (the field and the sheet stay empty), if a pick the character no longer holds is
  // read, if the suggestion is written to the character, or if typed text does not win.
  const kind = {
    freeform: { label: 'About', fields: [{ key: 'story', label: 'Story', multiline: true, suggestedBy: ['Quirk'] }] },
  };
  const character: Character = {
    ...createCharacter('test', 'hero'),
    choices: [
      { ruleKey: 'BACKGROUND/select:Quirk', elementIds: ['Q1', 'Q2'] },
      { ruleKey: 'OTHER/select:Not a quirk', elementIds: ['Q3'] },
    ],
  };
  const names: Record<string, string> = { Q1: 'Hums.', Q2: 'Counts steps.', Q3: 'Never shown.' };
  const chosen = chosenUnderSelect(character, new Set(['Q1', 'Q2', 'Q3']), (id) => names[id]);
  const state = freeformState(character, kind as never, chosen);
  assert.equal(state.groups[0]!.fields[0]!.suggested, 'Hums.\nCounts steps.');
  assert.equal(state.groups[0]!.fields[0]!.value, '');
  assert.deepEqual(character.freeform, {});
  assert.equal(sheetFreeform(state)!.groups[0]!.entries[0]!.text, 'Hums.\nCounts steps.');

  const notHeld = chosenUnderSelect(character, new Set(['Q2']), (id) => names[id]);
  assert.equal(freeformState(character, kind as never, notHeld).groups[0]!.fields[0]!.suggested, 'Counts steps.');

  const typed = setFreeform(character, 'story', 'Whistles.');
  assert.equal(sheetFreeform(freeformState(typed, kind as never, chosen))!.groups[0]!.entries[0]!.text, 'Whistles.');
});
