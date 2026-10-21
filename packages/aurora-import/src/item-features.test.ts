import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseAuroraElements } from './parse-elements.ts';
import { asItemFeature, ITEM_FEATURE_FAMILIES, itemFeatureFamilyOf } from './item-features.ts';

const XML = `<elements>
  <element name="Ranger, LV01: Deft Explorer" type="Item" source="Test" id="ID_OCF">
    <description>
      <p><i>You can equip this item to “enable” it. It remains hidden from the inventory on your character sheet.</i></p>
      <p>Deft Explorer replaces Natural Explorer.</p>
    </description>
    <setters>
      <set name="category">Optional Class Features</set>
      <set name="keywords">ranger</set>
      <set name="slot">misc</set>
      <set name="inventory-hidden">true</set>
    </setters>
    <rules><grant type="Class Feature" id="ID_DEFT" /></rules>
  </element>
  <element name="Speed: Climb +5 Feet" type="Item" source="Internal" id="ID_CLIMB">
    <setters><set name="Category"> additional feature </set><set name="inventory-hidden">true</set></setters>
  </element>
  <element name="Strength +1" type="Item" source="Internal" id="ID_STR">
    <setters><set name="category">Additional Ability Score Improvement</set></setters>
  </element>
  <element name="Camel" type="Item" source="Test" id="ID_CAMEL">
    <description><p><i>You can equip this item to ride it.</i></p></description>
    <setters><set name="category">Mounts &amp; Vehicles</set><set name="inventory-hidden">true</set></setters>
  </element>
  <element name="Not an item" type="Feat" source="Test" id="ID_FEAT">
    <setters><set name="category">Optional Class Features</set></setters>
  </element>
</elements>`;

// ADR 0129. Fails if the converter keeps them items, matches the category by exact case or spacing (the climb stays an
// item), keeps Aurora's workaround setters or paragraph, touches an item of another category (the camel), or retypes an
// element that was not an item.
test('an item Aurora uses as a switch is converted into an option of its family, and nothing else is', () => {
  const { elements } = parseAuroraElements(XML, { sourceId: 's', fileUrl: 'f.xml' });
  const byId = new Map(elements.map((e) => [e.id, e]));
  const ocf = byId.get('ID_OCF')!;
  assert.equal(ocf.type, 'Optional Class Feature');
  assert.deepEqual(Object.keys(ocf.setters).sort(), ['category', 'keywords']);
  assert.equal(ocf.description, '<p>Deft Explorer replaces Natural Explorer.</p>');
  assert.equal(ocf.rules.length, 1, 'its rules are untouched');
  assert.equal(byId.get('ID_CLIMB')!.type, 'Additional Feature');
  assert.equal(byId.get('ID_STR')!.type, 'Ability Score Adjustment');
  assert.equal(byId.get('ID_CAMEL')!.type, 'Item');
  assert.ok(byId.get('ID_CAMEL')!.setters['inventory-hidden'], 'a mount keeps what it is');
  assert.equal(byId.get('ID_FEAT')!.type, 'Feat');
  assert.equal(asItemFeature(byId.get('ID_CAMEL')!), byId.get('ID_CAMEL'), 'returned as it was');
});

test('every family has a type and a rule key of its own', () => {
  assert.equal(new Set(ITEM_FEATURE_FAMILIES.map((f) => f.type)).size, ITEM_FEATURE_FAMILIES.length);
  assert.equal(new Set(ITEM_FEATURE_FAMILIES.map((f) => f.ruleKey)).size, ITEM_FEATURE_FAMILIES.length);
  for (const family of ITEM_FEATURE_FAMILIES) assert.equal(itemFeatureFamilyOf(family.type), family);
  assert.equal(itemFeatureFamilyOf('Item'), undefined);
});
