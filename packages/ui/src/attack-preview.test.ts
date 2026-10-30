import { test } from 'node:test';
import assert from 'node:assert/strict';

import { BundleElementIndex, statedAttack, type AttacksDef, type Element } from '@incudo/core';

import { statedAttackLines } from './attack-preview.ts';

// No game: a "Blade" with a "cut" die and a "both hands" one, and a "Swift" property element.
const DEF = {
  types: ['Blade'], tagStat: 't', bonus: 'b', damage: 'd', stats: [], dice: 'cut', damageType: 'kind',
  alternatives: [{ setter: 'held', label: 'both hands' }], range: 'reach', properties: { types: ['Quality'], labels: { heavy: 'Heavy' } },
} as unknown as AttacksDef;

const element = (over: Partial<Element>): Element =>
  ({ id: 'X', type: 'Blade', name: 'X', source: 't', setters: {}, rules: [], supports: [], origin: { sourceId: 't', format: 'incudo' }, ...over }) as Element;

const SWIFT = element({ id: 'SWIFT', type: 'Quality', name: 'Swift' });

test("a preview names an attack's die and type, its other dice, its range and its properties", () => {
  // Perturbation: drop the alternatives and "both hands 1d10" is lost; read the type off the wrong setter and it is too.
  const blade = element({
    setters: { cut: { value: '1d8', attrs: { kind: 'slashing' } }, held: { value: '1d10' }, reach: { value: '20/60' } },
    supports: ['SWIFT', 'heavy', 'unlabelled'],
  });
  const stated = statedAttack(blade, DEF, new BundleElementIndex([SWIFT]));
  assert.deepEqual(statedAttackLines(stated), ['Damage: 1d8 slashing, both hands 1d10', 'Range: 20/60', 'Properties: Heavy, Swift']);
});

test('an element of no attack type, or one that writes nothing, has no lines', () => {
  assert.equal(statedAttack(element({ type: 'Other' }), DEF, new BundleElementIndex([])), undefined);
  assert.deepEqual(statedAttackLines(statedAttack(element({}), DEF, new BundleElementIndex([]))), []);
  assert.deepEqual(statedAttackLines(undefined), []);
});
