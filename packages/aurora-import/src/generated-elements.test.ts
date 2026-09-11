import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  auroraGeneratedElements,
  GENERATED_ELEMENT_TYPES,
  GENERATED_SOURCE_ID,
  KNOWN_UPSTREAM_TYPOS,
} from './generated-elements.ts';

test('the overlay is deterministic, because saves checksum what it produces', () => {
  const a = auroraGeneratedElements();
  const b = auroraGeneratedElements();
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  assert.deepEqual(
    a.map((e) => e.id),
    [...a.map((e) => e.id)].sort(),
    'sorted, so content.json bytes do not move for no reason',
  );
});

test('every id is unique and carries an origin', () => {
  const elements = auroraGeneratedElements();
  assert.equal(new Set(elements.map((e) => e.id)).size, elements.length);
  for (const element of elements) {
    assert.equal(element.origin.sourceId, GENERATED_SOURCE_ID);
    assert.equal(element.origin.format, 'aurora');
    assert.ok(element.name.length > 0, `${element.id} has no name`);
    assert.ok(element.type.length > 0, `${element.id} has no type`);
  }
});

test('the ability score elements carry the one mechanic the corpus states outright', () => {
  const elements = auroraGeneratedElements();
  const strength = elements.find((e) => e.id === 'ID_INTERNAL_ASI_STRENGTH')!;
  assert.equal(strength.type, 'Ability Score Improvement');
  // Aurora's own item for this is named "…ITEM_ASI_STRENGTH_INCREASE_1", and the changeling
  // offers the six of them as its single +1. Two independent statements of the same thing.
  assert.deepEqual(strength.rules, [
    { kind: 'stat', key: 'stat-0', name: 'strength', value: { kind: 'number', value: 1 } },
  ]);
});

test('an inventory proxy grants the one thing it exists to grant', () => {
  const elements = auroraGeneratedElements();
  // "Additional Language, Orc" that does not give you Orc is not a marker with a missing
  // mechanic; it is nothing at all. Aurora's own save writes the grant as the proxy's only
  // child in the build tree, so nothing here is inferred.
  const orc = elements.find((e) => e.id === 'ID_PHB_INTERNAL_ITEM_LANGUAGE_PROXY_LANGUAGE_ORC')!;
  assert.equal(orc.type, 'Item');
  assert.deepEqual(orc.rules, [
    { kind: 'grant', key: 'grant-0', type: 'Language', id: 'ID_LANGUAGE_ORC' },
  ]);
  // The size of the bump is not invented here either: ID_INTERNAL_ASI_INTELLIGENCE is in
  // this same overlay and already carries its +1.
  const asi = elements.find((e) => e.id === 'ID_PHB_INTERNAL_ITEM_PROXY_ASI_INTELLIGENCE')!;
  assert.deepEqual(asi.rules, [
    {
      kind: 'grant',
      key: 'grant-0',
      type: 'Ability Score Improvement',
      id: 'ID_INTERNAL_ASI_INTELLIGENCE',
    },
  ]);
  assert.ok(elements.some((e) => e.id === 'ID_INTERNAL_ASI_INTELLIGENCE'));
});

test('markers carry identity and no invented mechanics', () => {
  const elements = auroraGeneratedElements();
  for (const id of [
    'ID_INTERNAL_GRANTS_STEALTH_DISADVANTAGE',
    'ID_INTERNAL_CONDITION_DAMAGE_RESISTANCE_FIRE',
    'ID_INTERNAL_GRANTS_ARMOR_CLASS_BASE',
    'ID_SIZE_MEDIUM',
  ]) {
    const element = elements.find((e) => e.id === id);
    assert.ok(element, `${id} is missing from the overlay`);
    assert.deepEqual(element!.rules, [], `${id} should assert no mechanics`);
  }
});

test('every level a 5e character can reach exists', () => {
  const levels = auroraGeneratedElements().filter((e) => e.type === 'Level');
  assert.equal(levels.length, 20);
  assert.equal(levels.find((e) => e.id === 'ID_LEVEL_1')!.name, '1');
  assert.ok(levels.some((e) => e.id === 'ID_LEVEL_20'));
});

test('the overlay and the known typos are disjoint', () => {
  const ids = new Set(auroraGeneratedElements().map((e) => e.id));
  for (const typo of KNOWN_UPSTREAM_TYPOS) {
    assert.ok(
      !ids.has(typo.id),
      `${typo.id} is listed as an upstream typo and must stay unresolved — synthesizing it would hide the mistake forever`,
    );
    assert.ok(typo.note.length > 20, `${typo.id} needs a note saying what it was meant to be`);
  }
});

test('the types the overlay introduces are named, so a system can declare them', () => {
  const types = new Set(auroraGeneratedElements().map((e) => e.type));
  for (const type of GENERATED_ELEMENT_TYPES) {
    assert.ok(types.has(type), `${type} is advertised but nothing uses it`);
  }
});

test('the source id is overridable, for a caller that tracks provenance its own way', () => {
  const elements = auroraGeneratedElements({ sourceId: 'somewhere-else' });
  assert.ok(elements.every((e) => e.origin.sourceId === 'somewhere-else'));
});
