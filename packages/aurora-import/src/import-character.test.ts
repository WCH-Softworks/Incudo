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

/** An element that declares where it is worn, which is what the bag's `slot` is measured against. */
function slotted(id: string, type: string, slot: string): Element {
  return { ...element(id, type), setters: { slot: { value: slot } } };
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
    <equipment>
      <storage name="#1" />
      <item identifier="uuid-blade-worn" name="Blade" id="ID_ITEM_BLADE" sidebar="true">
        <equipped location="Primary Hand">true</equipped>
        <attunement>true</attunement>
        <items><adorner name="Blade" id="ID_MAGIC_SPARKLE" /></items>
      </item>
      <item identifier="uuid-blade-spare" name="Blade" id="ID_ITEM_BLADE">
        <items><adorner name="Blade" id="ID_MAGIC_FROST" /></items>
        <details card="true"><name>Swiftpursuit</name><notes>Won at cards.</notes></details>
      </item>
      <item identifier="uuid-plate" name="Plate" id="ID_ITEM_PLATE">
        <equipped location="Two-Handed">true</equipped>
      </item>
      <item identifier="uuid-hat" name="Hat" id="ID_ITEM_HAT">
        <equipped location="Nose">true</equipped>
      </item>
      <item identifier="uuid-cloak" name="Cloak" id="ID_ITEM_CLOAK">
        <equipped>true</equipped>
      </item>
      <item name="Rations" id="ID_ITEM_RATIONS" amount="7" />
      <item name="Rations" id="ID_ITEM_RATIONS" amount="1" />
      <item identifier="uuid-ghost" name="Ghost" id="ID_ITEM_FROM_A_BOOK_YOU_DISABLED" />
    </equipment>
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
  slotted('ID_ITEM_BLADE', 'Weapon', 'onehand'),
  slotted('ID_ITEM_PLATE', 'Armor', 'body'),
  slotted('ID_ITEM_HAT', 'Item', 'head'),
  slotted('ID_ITEM_CLOAK', 'Item', 'shoulders'),
  element('ID_ITEM_RATIONS', 'Item'),
  element('ID_MAGIC_SPARKLE', 'Magic Item'),
  element('ID_MAGIC_FROST', 'Magic Item'),
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

// --- inventory (ADR 0024) --------------------------------------------------

test('the bag comes across one row per item, and a save that has one is format 2', () => {
  const { character } = imported();
  assert.equal(character.formatVersion, 2);
  assert.equal(character.inventory!.length, 8, 'every item, carried ones included');
});

test('two instances of one element stay two rows, with their own enchantments', () => {
  // The measured case: one of a set of real saves carries two greatswords, a Vorpal Sword
  // on the carried one and a Frost Brand on the equipped one. Keying the bag by element id
  // loses that on the first real character.
  const blades = imported().character.inventory!.filter((e) => e.elementId === 'ID_ITEM_BLADE');
  assert.equal(blades.length, 2);
  assert.deepEqual(
    blades.map((b) => b.adorners![0]!.elementId),
    ['ID_MAGIC_SPARKLE', 'ID_MAGIC_FROST'],
  );
  assert.equal(blades[0]!.equipped, true);
  assert.equal(blades[1]!.equipped, undefined, 'carried is not equipped, and means something else');
});

test('instanceId is Aurora’s identifier, and the fallback is derived from the file too', () => {
  const inventory = imported().character.inventory!;
  assert.equal(inventory[0]!.instanceId, 'uuid-blade-worn');
  // Minting an id would make `aurora import` non-deterministic and move the golden fixtures
  // on every run, so an item with no identifier is numbered by its position instead.
  assert.deepEqual(
    inventory.filter((e) => e.elementId === 'ID_ITEM_RATIONS').map((e) => e.instanceId),
    ['ID_ITEM_RATIONS#5', 'ID_ITEM_RATIONS#6'],
  );
  assert.equal(new Set(inventory.map((e) => e.instanceId)).size, inventory.length, 'unique');
});

test('attunement sits on the entry and covers its adornment; Aurora has no second flag', () => {
  const [blade] = imported().character.inventory!;
  assert.equal(blade!.attuned, true);
  assert.deepEqual(blade!.adorners, [{ elementId: 'ID_MAGIC_SPARKLE' }], 'no name, no id of its own');
});

test('quantity is a count on the row, and 1 is written as nothing at all', () => {
  const rations = imported().character.inventory!.filter((e) => e.elementId === 'ID_ITEM_RATIONS');
  assert.equal(rations[0]!.quantity, 7);
  assert.equal(rations[1]!.quantity, undefined, 'omitted means 1');
});

test('name and notes are the user’s own words, never the denormalized name= attribute', () => {
  const inventory = imported().character.inventory!;
  const named = inventory.find((e) => e.instanceId === 'uuid-blade-spare')!;
  assert.equal(named.name, 'Swiftpursuit');
  assert.equal(named.notes, 'Won at cards.');
  // `name="Blade"` is a copy of the element's own name and is stale in 1 of 42 known cases.
  assert.equal(inventory[0]!.name, undefined);
});

test('slot is an override: written only where Aurora disagrees with the element', () => {
  const inventory = imported().character.inventory!;
  const bySlot = (id: string) => inventory.find((e) => e.instanceId === id)!.slot;
  // "Primary Hand" is `onehand`, which is what the blade declares. Nothing to record.
  assert.equal(bySlot('uuid-blade-worn'), undefined);
  // Equipped with no location at all — a cloak, a ring, boots. 11 of the 26 real ones.
  assert.equal(bySlot('uuid-cloak'), undefined);
  // "Two-Handed" is `twohand` and the plate says `body`, so the user moved it.
  assert.equal(bySlot('uuid-plate'), 'twohand');
});

test('an unrecognised location is reported, never written through as a slot', () => {
  const { character, diagnostics } = imported();
  // Aurora's words and content's words are two vocabularies. "Nose" belongs to neither.
  assert.equal(character.inventory!.find((e) => e.instanceId === 'uuid-hat')!.slot, undefined);
  assert.ok(diagnostics.some((d) => d.message.includes('"Nose" is not a slot')));
});

test('an item whose content is not loaded is kept, and said out loud', () => {
  const { character, diagnostics } = imported();
  assert.ok(
    character.inventory!.some((e) => e.elementId === 'ID_ITEM_FROM_A_BOOK_YOU_DISABLED'),
    'kept — the source may simply not be enabled',
  );
  assert.ok(
    diagnostics.some((d) => d.message.includes('The bag holds "ID_ITEM_FROM_A_BOOK_YOU_DISABLED"')),
  );
});

test('with no content loaded, no slot is guessed and the import says why', () => {
  const { character, diagnostics } = importAuroraCharacter(parseAuroraSave(SAVE));
  assert.equal(character.inventory!.length, 8, 'the bag still comes across in full');
  assert.ok(character.inventory!.every((e) => e.slot === undefined));
  assert.ok(diagnostics.some((d) => d.message.includes('no content is loaded to compare that against')));
});

test('a save with no equipment has no inventory, rather than an empty one', () => {
  const save = parseAuroraSave(SAVE.replace(/<equipment>[\s\S]*<\/equipment>/, ''));
  const { character } = importAuroraCharacter(save, { index: CONTENT });
  assert.equal(character.inventory, undefined);
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

// --- the same element picked twice — ADR 0035 ---------------------------------------------

/** A save whose class recorded one ability bump under both numbers of a select, as Aurora writes +2. */
const DOUBLE = `<character version="1.0.3">
  <build>
    <elements level-count="4">
      <element type="Level" name="4" id="ID_LEVEL_4">
        <element type="Class" name="Class" requiredLevel="1" checksum="b" registered="ID_CLASS_TEST">
          <element type="Ability Score Improvement" name="Ability Score Increase (TEST 4)" requiredLevel="4" number="1" checksum="x" registered="ID_BUMP" />
          <element type="Ability Score Improvement" name="Ability Score Increase (TEST 4)" requiredLevel="4" number="2" checksum="y" registered="ID_BUMP" />
          <element type="Proficiency" name="Skill (Test)" requiredLevel="1" number="1" checksum="p" registered="ID_PROF_ONE" />
          <element type="Proficiency" name="Skill (Test)" requiredLevel="1" number="2" checksum="q" registered="ID_PROF_ONE" />
        </element>
      </element>
    </elements>
  </build>
</character>`;

function bump(repeatable: boolean): Element {
  const e = element('ID_BUMP', 'Ability Score Improvement');
  if (repeatable) e.setters = { 'allow duplicate': { value: 'true' } };
  return e;
}

function importedDouble(content: MapElementIndex | undefined) {
  return importAuroraCharacter(parseAuroraSave(DOUBLE), { index: content });
}

const BUMP_KEY = 'ID_CLASS_TEST/select:Ability Score Increase (TEST 4)';
const SKILL_KEY = 'ID_CLASS_TEST/select:Skill (Test)';

test('an element that allows duplicates is kept once per pick, which is how +2 is written', () => {
  const { character, diagnostics } = importedDouble(
    index(bump(true), element('ID_CLASS_TEST', 'Class'), element('ID_PROF_ONE', 'Proficiency')),
  );
  assert.deepEqual(character.choices.find((c) => c.ruleKey === BUMP_KEY)!.elementIds, ['ID_BUMP', 'ID_BUMP']);
  assert.equal(
    diagnostics.filter((d) => d.message.includes('ID_BUMP')).length,
    0,
    'nothing was dropped, so nothing is reported',
  );
});

test('an element that does not is kept once and the second pick is reported, as before', () => {
  const { character, diagnostics } = importedDouble(
    index(bump(false), element('ID_CLASS_TEST', 'Class'), element('ID_PROF_ONE', 'Proficiency')),
  );
  assert.deepEqual(character.choices.find((c) => c.ruleKey === BUMP_KEY)!.elementIds, ['ID_BUMP']);
  assert.ok(diagnostics.some((d) => d.message.includes('"ID_BUMP" is recorded twice')));
  assert.deepEqual(
    character.choices.find((c) => c.ruleKey === SKILL_KEY)!.elementIds,
    ['ID_PROF_ONE'],
    'a repeated proficiency is not a +2 of anything',
  );
});

test('with no content loaded there is no way to know, so the second pick is dropped and reported', () => {
  const { character, diagnostics } = importedDouble(undefined);
  assert.deepEqual(character.choices.find((c) => c.ruleKey === BUMP_KEY)!.elementIds, ['ID_BUMP']);
  assert.ok(diagnostics.some((d) => d.message.includes('"ID_BUMP" is recorded twice')));
});

// --- hit point dice of a class of its own (ADR 0044) --------------------------------------

/** A Rogue / Wizard taken level by level, each class carrying its own list on the level it began at. */
const INTERLEAVED = `<character version="1.0.3">
  <display-properties><name>Split</name></display-properties>
  <build>
    <abilities><strength>10</strength><dexterity>10</dexterity><constitution>10</constitution>
      <intelligence>10</intelligence><wisdom>10</wisdom><charisma>10</charisma></abilities>
    <elements level-count="4">
      <element type="Level" name="1" id="ID_LEVEL_1" rndhp="8,5,6,7,1,1,1,1">
        <element type="Class" name="Class" requiredLevel="1" checksum="b" registered="ID_CLASS_ROGUE" />
      </element>
      <element type="Level" name="2" id="ID_LEVEL_2" multiclass="true" starting="true" rndhp="3,4,2,1,9,9,9,9" class="ID_MC_WIZARD" />
      <element type="Level" name="3" id="ID_LEVEL_3" />
      <element type="Level" name="4" id="ID_LEVEL_4" multiclass="true" class="ID_MC_WIZARD" />
    </elements>
  </build>
</character>`;

function interleaved() {
  const wizard = { ...element('ID_CLASS_WIZARD', 'Class'), multiclass: { id: 'ID_MC_WIZARD' } };
  return importAuroraCharacter(parseAuroraSave(INTERLEAVED), {
    index: index(element('ID_CLASS_ROGUE', 'Class'), wizard as Element),
    id: 'fixed',
    now: '2026-01-01T00:00:00.000Z',
  }).character;
}

test('each class of a multiclass save keeps its own dice, filed under the character levels it was taken at', () => {
  const character = interleaved();
  assert.deepEqual(character.advancement?.map((e) => e.elementId), [
    'ID_CLASS_ROGUE',
    'ID_CLASS_WIZARD',
    'ID_CLASS_ROGUE',
    'ID_CLASS_WIZARD',
  ]);
  // Rogue levels are character levels 1 and 3 and read the Rogue's first two entries; Wizard levels
  // are 2 and 4 and read the Wizard's own list, not the entries the Rogue's list holds at those
  // positions. Read by position (the old behaviour), level 2 would be 5 and level 4 would be 7.
  assert.deepEqual(character.rolls, {
    'hp:level:1': 8,
    'hp:level:2': 3,
    'hp:level:3': 5,
    'hp:level:4': 4,
  });
});
