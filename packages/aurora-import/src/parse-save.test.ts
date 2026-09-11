/**
 * The `.dnd5e` reader, against a save written by hand.
 *
 * Every construct below is one the eight real sample saves use, transcribed by shape rather
 * than by content. The real files are somebody's characters and stay off disk here: a
 * fixture carrying a real name, backstory or portrait would be the same leak as committing
 * the file (see CLAUDE.md).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseAuroraSave, systemIdForSaveExtension } from './parse-save.ts';

const SAVE = `<?xml version="1.0" encoding="utf-8"?>
<character version="1.0.3" preview="false">
  <information>
    <group>Test</group>
    <generationOption>1</generationOption>
  </information>
  <display-properties favorite="false">
    <name>Cache Of The Derivation</name>
    <level>3</level>
    <portrait>
      <local>C:\\somewhere\\else\\face.png</local>
      <base64><![CDATA[ iVBORw0KGgo= ]]></base64>
    </portrait>
  </display-properties>
  <build>
    <input>
      <name>Testcharacter</name>
      <player-name>Tester</player-name>
      <backstory>Some prose the rules never read.</backstory>
      <notes>
        <note column="left">Left note</note>
        <note column="right">Right note</note>
      </notes>
      <currency><gold>15</gold></currency>
    </input>
    <appearance>
      <portrait>C:\\somewhere\\else\\face.png</portrait>
      <age>31</age>
      <eyes>Grey</eyes>
    </appearance>
    <abilities available-points="15">
      <strength>8</strength>
      <dexterity>15</dexterity>
      <constitution>14</constitution>
      <intelligence>10</intelligence>
      <wisdom>12</wisdom>
      <charisma>13</charisma>
    </abilities>
    <elements level-count="3" registered-count="6">
      <element type="Option" name="Feats" id="ID_INTERNAL_OPTION_ALLOW_FEATS" />
      <element type="Level" name="1" id="ID_LEVEL_1" rndhp="6,2,3,1, ,x,5" />
      <element type="Level" name="2" id="ID_LEVEL_2" />
      <element type="Level" name="3" id="ID_LEVEL_3">
        <element type="Race" name="Race" requiredLevel="1" checksum="abc123" registered="ID_RACE_TEST">
          <element type="Racial Trait" name="Keen Nose" id="ID_TRAIT_KEEN_NOSE">
            <element type="Proficiency" name="Sniffing" id="ID_PROF_SNIFFING" />
          </element>
          <element type="Sub Race" name="Subrace" requiredLevel="1" checksum="d0d0" registered="ID_SUB_RACE_TEST" />
        </element>
        <element type="Class" name="Class" requiredLevel="1" checksum="99" registered="ID_CLASS_TEST">
          <element type="Proficiency" name="Skill (Test)" requiredLevel="1" number="1" checksum="a" registered="ID_PROF_ONE" />
          <element type="Proficiency" name="Skill (Test)" requiredLevel="1" number="2" checksum="b" registered="ID_PROF_TWO" />
          <element type="Proficiency" name="Skill (Test)" requiredLevel="3" number="1" checksum="c" registered="ID_PROF_THREE" />
        </element>
        <element type="List" name="Bond" isList="true" requiredLevel="1" checksum="e" registered="4" />
        <element type="Deity" name="Deity" requiredLevel="1" />
      </element>
    </elements>
    <equipment>
      <storage name="#1" />
      <item identifier="uuid-1" name="Staff" id="ID_ITEM_STAFF" sidebar="true">
        <equipped location="Primary Hand">true</equipped>
        <attunement>false</attunement>
        <items>
          <adorner name="Sparkle" id="ID_MAGIC_SPARKLE" />
        </items>
        <details card="true"><name>Knobbly</name><notes>Traded for a goat.</notes></details>
      </item>
      <item identifier="uuid-2" name="Rations" id="ID_ITEM_RATIONS" amount="7">
        <details card="true">
          <name>
          </name>
          <notes>
          </notes>
        </details>
      </item>
    </equipment>
    <sum element-count="4">
      <element type="Level" id="ID_LEVEL_1" />
      <element type="Race" id="ID_RACE_TEST" />
      <element type="Racial Trait" id="ID_TRAIT_KEEN_NOSE" />
      <element type="Proficiency" id="ID_PROF_SNIFFING" />
    </sum>
    <magic>
      <spellcasting name="Tester" ability="Wisdom" attack="5" dc="13" source="ID_FEATURE_SPELLCASTING">
        <slots s1="4" s2="2" s3="0" s4="0" s5="0" s6="0" s7="0" s8="0" s9="0" />
        <cantrips>
          <spell name="Spark" level="0" id="ID_SPELL_SPARK" />
        </cantrips>
        <spells>
          <spell name="Mend" level="1" id="ID_SPELL_MEND" prepared="true" always-prepared="true" known="true" />
        </spells>
      </spellcasting>
    </magic>
  </build>
  <sources>
    <restricted>
      <source id="ID_SOURCE_OFF_ONE">Off One</source>
      <source id="ID_SOURCE_OFF_TWO">Off Two</source>
      <element>ID_DISABLED_A</element>
      <element>ID_DISABLED_B</element>
      <element>ID_DISABLED_C</element>
    </restricted>
  </sources>
</character>`;

test('a save reads into the shape the importer expects', () => {
  const save = parseAuroraSave(SAVE);
  assert.equal(save.version, '1.0.3');
  assert.equal(save.levelCount, 3);
  assert.equal(save.availablePoints, 15);
  assert.deepEqual(save.abilities, {
    strength: 8,
    dexterity: 15,
    constitution: 14,
    intelligence: 10,
    wisdom: 12,
    charisma: 13,
  });
});

test('`registered=` is a decision and a bare `id=` is a consequence', () => {
  const save = parseAuroraSave(SAVE);
  const registered = save.decisions.map((d) => d.registered);
  assert.deepEqual(registered.sort(), [
    '4',
    'ID_CLASS_TEST',
    'ID_PROF_ONE',
    'ID_PROF_THREE',
    'ID_PROF_TWO',
    'ID_RACE_TEST',
    'ID_SUB_RACE_TEST',
  ]);

  const granted = save.grants.map((g) => g.id);
  assert.ok(granted.includes('ID_TRAIT_KEEN_NOSE'), 'a granted trait is a grant');
  assert.ok(!registered.includes('ID_TRAIT_KEEN_NOSE'), 'and never a decision');
});

test('a decision belongs to the nearest enclosing element, which is what a rule key needs', () => {
  const save = parseAuroraSave(SAVE);
  const byRegistered = new Map(save.decisions.map((d) => [d.registered, d]));

  // The Race choice hangs off the Level element it was made at.
  assert.equal(byRegistered.get('ID_RACE_TEST')!.ownerId, 'ID_LEVEL_3');
  // The subrace hangs off the trait that offers it, not off the race.
  assert.equal(byRegistered.get('ID_SUB_RACE_TEST')!.ownerId, 'ID_RACE_TEST');
  // Skill picks hang off the class, which is itself a decision.
  assert.equal(byRegistered.get('ID_PROF_ONE')!.ownerId, 'ID_CLASS_TEST');
});

test('a repeated select keeps its number and level, so the picks can be ordered', () => {
  const save = parseAuroraSave(SAVE);
  const skills = save.decisions.filter((d) => d.ruleName === 'Skill (Test)');
  assert.equal(skills.length, 3);
  assert.deepEqual(
    skills.map((d) => [d.requiredLevel, d.number, d.registered]),
    [
      [1, 1, 'ID_PROF_ONE'],
      [1, 2, 'ID_PROF_TWO'],
      [3, 1, 'ID_PROF_THREE'],
    ],
  );
});

test('grants record their depth and parent, which is how an absence gets explained', () => {
  const save = parseAuroraSave(SAVE);
  const byId = new Map(save.grants.map((g) => [g.id, g]));

  assert.equal(byId.get('ID_INTERNAL_OPTION_ALLOW_FEATS')!.depth, 1, 'a top-level option');
  assert.equal(byId.get('ID_INTERNAL_OPTION_ALLOW_FEATS')!.parentId, undefined);
  assert.equal(byId.get('ID_PROF_SNIFFING')!.parentId, 'ID_TRAIT_KEEN_NOSE');
  assert.equal(byId.get('ID_TRAIT_KEEN_NOSE')!.parentId, 'ID_RACE_TEST');
});

test('a list pick is flagged, because its `registered` is a row number not an element id', () => {
  const save = parseAuroraSave(SAVE);
  const bond = save.decisions.find((d) => d.ruleName === 'Bond')!;
  assert.equal(bond.isList, true);
  assert.equal(bond.registered, '4');
});

test('rndhp keeps the numbers and reports the rest rather than shifting the list', () => {
  const save = parseAuroraSave(SAVE);
  assert.deepEqual(save.rndhp, [6, 2, 3, 1, 5]);
  assert.equal(
    save.diagnostics.filter((d) => d.message.includes('rndhp')).length,
    1,
    '"x" is not a number and says so; the empty entry is just formatting',
  );
});

test('an element that is neither a choice nor a grant is reported, not guessed at', () => {
  const save = parseAuroraSave(SAVE);
  assert.equal(
    save.diagnostics.filter((d) => d.message.includes('neither id nor registered')).length,
    1,
  );
});

test('the derived blocks are read intact, because they are the oracle', () => {
  const save = parseAuroraSave(SAVE);
  assert.equal(save.sumCount, 4);
  assert.deepEqual(save.sum, [
    'ID_LEVEL_1',
    'ID_RACE_TEST',
    'ID_TRAIT_KEEN_NOSE',
    'ID_PROF_SNIFFING',
  ]);

  const [block] = save.magic;
  assert.equal(block!.name, 'Tester');
  assert.equal(block!.ability, 'Wisdom');
  assert.equal(block!.dc, 13);
  assert.equal(block!.attack, 5);
  assert.equal(block!.source, 'ID_FEATURE_SPELLCASTING');
  assert.deepEqual(block!.slots, [4, 2, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(block!.cantrips.map((s) => s.id), ['ID_SPELL_SPARK']);
  assert.equal(block!.spells[0]!.alwaysPrepared, true);
  assert.equal(block!.spells[0]!.prepared, true);
});

test('equipment comes across as instances, with everything the bag needs', () => {
  const save = parseAuroraSave(SAVE);
  assert.equal(save.equipment.length, 2);
  const [staff, rations] = save.equipment;
  assert.equal(staff!.id, 'ID_ITEM_STAFF');
  // The GUID is what lets the importer carry an instanceId across instead of minting one.
  assert.equal(staff!.identifier, 'uuid-1');
  assert.equal(staff!.equipped, true);
  assert.equal(staff!.location, 'Primary Hand');
  assert.equal(staff!.attuned, undefined);
  assert.deepEqual(staff!.adorners, [{ id: 'ID_MAGIC_SPARKLE', name: 'Sparkle' }]);
  assert.deepEqual(staff!.details, { name: 'Knobbly', notes: 'Traded for a goat.' });
  assert.equal(rations!.amount, 7);
});

test('a <details> holding nothing but whitespace is absent, which is 44 of 45 real items', () => {
  const save = parseAuroraSave(SAVE);
  // Aurora writes <name> and <notes> on every item and leaves them holding a newline and a
  // tab. Reading that as the user's own name would put an indented empty string in the bag.
  assert.equal(save.equipment[1]!.details, undefined);
});

test('the blocklist is read so it can be inverted', () => {
  const save = parseAuroraSave(SAVE);
  assert.deepEqual(save.restrictedSources, ['ID_SOURCE_OFF_ONE', 'ID_SOURCE_OFF_TWO']);
  assert.equal(save.restrictedElements.length, 3);
});

test('freeform flattens, and repeated tags stay apart by their attribute', () => {
  const save = parseAuroraSave(SAVE);
  assert.equal(save.input['backstory'], 'Some prose the rules never read.');
  // The tag name stays in the path, so a `<note column="left">` cannot collide with some
  // future `<notes><left>`. Redundant-looking and unambiguous, which is the better trade.
  assert.equal(save.input['notes.note.left'], 'Left note');
  assert.equal(save.input['notes.note.right'], 'Right note');
  assert.equal(save.input['currency.gold'], '15');
  assert.equal(save.appearance['eyes'], 'Grey');
});

test('the portrait payload is read but not decoded here', () => {
  const save = parseAuroraSave(SAVE);
  assert.equal(save.portrait!.base64, 'iVBORw0KGgo=');
  assert.ok(save.portrait!.localPath?.endsWith('face.png'));
});

test('a file that is not a save says so instead of producing an empty character', () => {
  const result = parseAuroraSave('<html><body>not this</body></html>');
  assert.equal(result.diagnostics.filter((d) => d.level === 'error').length, 1);
  assert.equal(result.decisions.length, 0);
});

test('a version other than 1.0.3 warns and is read anyway', () => {
  const result = parseAuroraSave('<character version="0.9"><build><elements /></build></character>');
  assert.equal(result.diagnostics.filter((d) => d.level === 'warning').length, 1);
  assert.equal(result.diagnostics.filter((d) => d.level === 'error').length, 0);
});

test('the extension names the system, because that is what Aurora made it mean', () => {
  assert.equal(systemIdForSaveExtension('Someone.dnd5e'), 'dnd5e');
  assert.equal(systemIdForSaveExtension('C:/path/to/Someone.DND5E'), 'dnd5e');
  assert.equal(systemIdForSaveExtension('noextension'), undefined);
});
