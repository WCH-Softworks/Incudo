/**
 * Aurora matches element ids ignoring case, and a save can spell one differently from the
 * file that declares it. Fixtures are written by hand.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { MapElementIndex, type Element } from '@incudo/core';
import { importAuroraCharacter } from './import-character.ts';
import { parseAuroraSave } from './parse-save.ts';
import { canonicalizeSaveIds } from './canonical-ids.ts';

function element(id: string, type: string): Element {
  return {
    id,
    type,
    name: id,
    source: 'Test',
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

// The domain is spelled `Test_DOMAIN` in the save and `TEST_DOMAIN` in the content.
const SAVE = `<character version="1.0.3">
  <build>
    <elements level-count="1">
      <element type="Level" name="1" id="ID_LEVEL_1">
        <element type="Class" name="Class" requiredLevel="1" checksum="a" registered="ID_CLASS_TEST">
          <element type="Archetype" name="Domain" requiredLevel="1" checksum="b" registered="ID_ARCH_Test_DOMAIN">
            <element type="Class Feature" name="Feature" id="ID_FEATURE_TEST" />
          </element>
        </element>
      </element>
    </elements>
    <equipment>
      <item identifier="uuid-1" name="Blade" id="ID_Item_BLADE" />
    </equipment>
    <sum element-count="3">
      <element type="Archetype" id="ID_ARCH_Test_DOMAIN" />
      <element type="Class Feature" id="ID_FEATURE_TEST" />
      <element type="Weapon" id="ID_Item_BLADE" />
    </sum>
  </build>
</character>`;

const CONTENT = index(
  element('ID_CLASS_TEST', 'Class'),
  element('ID_ARCH_TEST_DOMAIN', 'Archetype'),
  element('ID_FEATURE_TEST', 'Class Feature'),
  element('ID_ITEM_BLADE', 'Weapon'),
);

test('an id spelled in another case is recorded under the content\'s spelling', () => {
  const { character, extraIds } = importAuroraCharacter(parseAuroraSave(SAVE), { index: CONTENT });
  const recorded = character.choices.flatMap((c) => c.elementIds);
  assert.ok(recorded.includes('ID_ARCH_TEST_DOMAIN'), `recorded: ${recorded.join(', ')}`);
  assert.ok(!recorded.includes('ID_ARCH_Test_DOMAIN'));
  assert.deepEqual(character.inventory?.map((e) => e.elementId), ['ID_ITEM_BLADE']);
  assert.ok(extraIds.includes('ID_ARCH_TEST_DOMAIN'));
  assert.ok(!extraIds.includes('ID_ARCH_Test_DOMAIN'));
});

test('the import says how many ids it matched ignoring case', () => {
  const { diagnostics } = importAuroraCharacter(parseAuroraSave(SAVE), { index: CONTENT });
  const note = diagnostics.find((d) => /ignoring case/.test(d.message));
  assert.ok(note, 'expected a diagnostic');
  assert.match(note!.message, /^2 /);
});

test('an id the content spells exactly is left alone, and so is one it does not have', () => {
  const save = parseAuroraSave(SAVE);
  const out = canonicalizeSaveIds(save, index(element('ID_FEATURE_TEST', 'Class Feature'))).save;
  assert.ok(out.sum.includes('ID_FEATURE_TEST'));
  assert.ok(out.sum.includes('ID_ARCH_Test_DOMAIN'), 'nothing to fold it to');
});

test('two content ids that differ only by case are ambiguous, so nothing is folded', () => {
  const save = parseAuroraSave(SAVE);
  const both = index(element('ID_ARCH_TEST_DOMAIN', 'Archetype'), element('ID_ARCH_TEST_domain', 'Archetype'));
  const { save: out, changed } = canonicalizeSaveIds(save, both);
  assert.equal(changed, 0);
  assert.ok(out.sum.includes('ID_ARCH_Test_DOMAIN'));
});

test('the input save is not modified', () => {
  const save = parseAuroraSave(SAVE);
  const before = JSON.stringify(save);
  canonicalizeSaveIds(save, CONTENT);
  assert.equal(JSON.stringify(save), before);
});
