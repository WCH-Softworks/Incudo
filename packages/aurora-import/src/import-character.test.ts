/**
 * Aurora save -> Incudo character.
 *
 * Same rule as `parse-save.test.ts`: the fixtures are written by hand. Nothing from the real
 * `.dnd5e` files on the maintainer's machine appears here.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { MapElementIndex, type Element } from '@incudo/core';
import { importAuroraCharacter, OPTIONS_RULE_KEY } from './import-character.ts';
import { parseAuroraSave } from './parse-save.ts';

function element(id: string, type: string, name = id, source = 'Test Book'): Element {
  return {
    id,
    type,
    name,
    source,
    setters: {},
    rules: [],
    supports: [],
    origin: { sourceId: 'test', format: 'aurora' },
  };
}

function index(...elements: Element[]): MapElementIndex {
  const map = new MapElementIndex();
  map.addAll(elements);
  return map;
}

// A one-pixel PNG, so the portrait path is exercised end to end without shipping artwork.
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const SAVE = `<character version="1.0.3">
  <display-properties>
    <name>Denormalized</name>
    <portrait><local>D:\\gone\\face.png</local><base64>${PNG_BASE64}</base64></portrait>
  </display-properties>
  <build>
    <input><name>Typed Name</name><backstory>Prose.</backstory></input>
    <appearance><portrait>D:\\gone\\face.png</portrait><eyes>Grey</eyes></appearance>
    <abilities available-points="15">
      <strength>8</strength><dexterity>15</dexterity><constitution>14</constitution>
      <intelligence>10</intelligence><wisdom>12</wisdom><charisma>13</charisma>
    </abilities>
    <elements level-count="4">
      <element type="Option" name="Feats" id="ID_INTERNAL_OPTION_ALLOW_FEATS" />
      <element type="Option" name="Custom ASI" id="ID_OPTION_CUSTOM_ASI" />
      <element type="Level" name="1" id="ID_LEVEL_1" rndhp="6,2,3,1,5" />
      <element type="Level" name="4" id="ID_LEVEL_4">
        <element type="Race" name="Race" requiredLevel="1" checksum="a" registered="ID_RACE_TEST">
          <element type="Racial Trait" name="Trait" id="ID_TRAIT_TEST" />
        </element>
        <element type="Class" name="Class" requiredLevel="1" checksum="b" registered="ID_CLASS_TEST">
          <element type="Proficiency" name="Skill (Test)" requiredLevel="1" number="2" checksum="c" registered="ID_PROF_TWO" />
          <element type="Proficiency" name="Skill (Test)" requiredLevel="1" number="1" checksum="d" registered="ID_PROF_ONE" />
          <element type="Class Feature" name="Improvement Option (Test 4)" requiredLevel="4" checksum="e" registered="ID_INTERNAL_CLASS_FEATURE_FEAT_4_TEST" />
        </element>
        <element type="List" name="Bond" isList="true" requiredLevel="1" checksum="f" registered="3" />
      </element>
    </elements>
    <sum element-count="3">
      <element type="Race" id="ID_RACE_TEST" />
      <element type="Racial Trait" id="ID_TRAIT_TEST" />
      <element type="Class Feature" id="ID_INTERNAL_CLASS_FEATURE_FEAT_4_TEST" />
    </sum>
  </build>
  <sources>
    <restricted>
      <source id="ID_SOURCE_OFF">Other Book</source>
      <element>ID_DISABLED</element>
    </restricted>
  </sources>
</character>`;

const CONTENT = index(
  element('ID_SOURCE_TEST', 'Source', 'Test Book', 'Core'),
  element('ID_SOURCE_OFF', 'Source', 'Other Book', 'Core'),
  element('ID_RACE_TEST', 'Race'),
  element('ID_TRAIT_TEST', 'Racial Trait'),
  element('ID_CLASS_TEST', 'Class'),
  element('ID_PROF_ONE', 'Proficiency'),
  element('ID_PROF_TWO', 'Proficiency'),
  element('ID_OPTION_CUSTOM_ASI', 'Option'),
  element('ID_INTERNAL_OPTION_ALLOW_FEATS', 'Option'),
);

function imported() {
  return importAuroraCharacter(parseAuroraSave(SAVE), {
    index: CONTENT,
    id: 'fixed',
    now: '2026-01-01T00:00:00.000Z',
  });
}

test('a decision becomes a choice keyed the way the engine keys selects', () => {
  const { character } = imported();
  const keys = character.choices.map((c) => c.ruleKey);
  assert.ok(keys.includes('ID_LEVEL_4/select:Race'));
  assert.ok(keys.includes('ID_CLASS_TEST/select:Skill (Test)'));
});

test('repeated picks for one select land in one choice, in the order they were made', () => {
  const { character } = imported();
  const skills = character.choices.find((c) => c.ruleKey === 'ID_CLASS_TEST/select:Skill (Test)');
  // Document order put number 2 first; the sort by (level, number) puts it back.
  assert.deepEqual(skills!.elementIds, ['ID_PROF_ONE', 'ID_PROF_TWO']);
});

test('ability scores become baseStats, which contributions add to (ADR 0014)', () => {
  const { character } = imported();
  assert.deepEqual(character.baseStats, {
    strength: 8,
    dexterity: 15,
    constitution: 14,
    intelligence: 10,
    wisdom: 12,
    charisma: 13,
  });
  assert.equal(character.overrides, undefined, 'never overrides — that would discard racial bonuses');
});

test('rndhp becomes rolls, including the levels not reached yet', () => {
  const { character } = imported();
  assert.deepEqual(character.rolls, {
    'hp:level:1': 6,
    'hp:level:2': 2,
    'hp:level:3': 3,
    'hp:level:4': 1,
    // Aurora rolls all twenty up front. Dropping the unused ones would reroll them later,
    // which is the failure ADR 0007 exists to prevent, just deferred.
    'hp:level:5': 5,
  });
});

test('the level count becomes progress, and the typed name beats the cached one', () => {
  const { character } = imported();
  assert.equal(character.progress, 4);
  assert.equal(character.name, 'Typed Name');
});

test('freeform carries the prose, and the name is not duplicated into it', () => {
  const { character } = imported();
  assert.equal(character.freeform['backstory'], 'Prose.');
  assert.equal(character.freeform['appearance.eyes'], 'Grey');
  assert.equal(character.freeform['name'], undefined);
  // The dead path from another machine is not worth carrying; the bytes are in assets/.
  assert.equal(character.freeform['appearance.portrait'], undefined);
});

test('a list pick becomes freeform, because a row number is not an element id', () => {
  const { character } = imported();
  assert.equal(character.freeform['list.ID_LEVEL_4.Bond'], '3');
  for (const choice of character.choices) {
    assert.ok(!choice.elementIds.includes('3'), 'and never a chosen element');
  }
});

test('the portrait becomes real bytes in assets/, never base64', () => {
  const { character, assets } = imported();
  assert.deepEqual(character.assets, { portrait: 'assets/portrait.png' });
  const bytes = assets.get('assets/portrait.png')!;
  assert.ok(bytes.length > 60, 'the decoded PNG, not the encoded text');
  assert.deepEqual([...bytes.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47], 'PNG magic');
  assert.ok(!JSON.stringify(character).includes('iVBOR'), 'no base64 anywhere in the character');
});

test('campaign options come across as a choice; they are settings, not consequences', () => {
  const { character } = imported();
  const options = character.choices.find((c) => c.ruleKey === OPTIONS_RULE_KEY);
  assert.deepEqual(options!.elementIds, ['ID_INTERNAL_OPTION_ALLOW_FEATS', 'ID_OPTION_CUSTOM_ASI']);
});

test('the blocklist is inverted into a short allowlist, and never stored as a blocklist', () => {
  const { character } = imported();
  assert.deepEqual(
    character.sources.map((s) => s.id),
    ['ID_SOURCE_TEST'],
    'only the book the character actually draws on',
  );
  const json = JSON.stringify(character);
  assert.ok(!json.includes('ID_DISABLED'), 'no disabled element ids');
  assert.ok(!json.includes('ID_SOURCE_OFF'), 'no disabled source ids');
});

test('an ID_INTERNAL id no content declares is rebuilt from what the save says about it', () => {
  const { generated, character } = imported();
  assert.deepEqual(generated.map((e) => e.id), ['ID_INTERNAL_CLASS_FEATURE_FEAT_4_TEST']);
  const [rebuilt] = generated;
  assert.equal(rebuilt!.type, 'Class Feature');
  assert.equal(rebuilt!.name, 'Improvement Option (Test 4)');
  assert.deepEqual(rebuilt!.rules, [], 'no rules — nobody wrote any down');
  // The choice is kept either way; the rebuild is what stops it dangling.
  assert.ok(
    character.choices.some((c) => c.elementIds.includes('ID_INTERNAL_CLASS_FEATURE_FEAT_4_TEST')),
  );
});

test('an id outside Aurora’s namespace is reported as missing content, not invented', () => {
  const save = parseAuroraSave(
    SAVE.replace('registered="ID_RACE_TEST"', 'registered="ID_RACE_FROM_A_BOOK_YOU_DISABLED"'),
  );
  const { generated, diagnostics, character } = importAuroraCharacter(save, { index: CONTENT });
  assert.ok(!generated.some((e) => e.id.includes('BOOK_YOU_DISABLED')));
  assert.ok(
    diagnostics.some((d) => d.message.includes('ID_RACE_FROM_A_BOOK_YOU_DISABLED')),
    'says which id and why',
  );
  assert.ok(
    character.choices.some((c) => c.elementIds.includes('ID_RACE_FROM_A_BOOK_YOU_DISABLED')),
    'and keeps the choice, because the source may simply not be enabled',
  );
});

test('Aurora’s own <sum> comes back as extraIds, so the save can carry it', () => {
  const { extraIds } = imported();
  assert.deepEqual(extraIds.sort(), [
    'ID_INTERNAL_CLASS_FEATURE_FEAT_4_TEST',
    'ID_RACE_TEST',
    'ID_TRAIT_TEST',
  ]);
});

test('nothing derived is imported: <sum> and granted ids stay out of the character', () => {
  const { character } = imported();
  const chosen = character.choices.flatMap((c) => c.elementIds);
  assert.ok(!chosen.includes('ID_TRAIT_TEST'), 'a granted trait is re-derived, not stored');
  assert.ok(!chosen.includes('ID_LEVEL_1'), 'levels come from the kind, not from the save');
});

test('importing the same file twice produces the same character', () => {
  const a = importAuroraCharacter(parseAuroraSave(SAVE), { index: CONTENT, id: 'x', now: 'n' });
  const b = importAuroraCharacter(parseAuroraSave(SAVE), { index: CONTENT, id: 'x', now: 'n' });
  assert.equal(JSON.stringify(a.character), JSON.stringify(b.character));
});

test('with no content loaded it still imports, and says what it could not check', () => {
  const { character, diagnostics } = importAuroraCharacter(parseAuroraSave(SAVE));
  assert.ok(character.choices.length > 0);
  assert.deepEqual(character.sources, [], 'no allowlist rather than a guessed one');
  assert.ok(diagnostics.some((d) => d.message.includes('no content is loaded')));
});
