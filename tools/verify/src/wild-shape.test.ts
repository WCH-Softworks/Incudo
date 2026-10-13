/**
 * A 2014 Druid's Wild Shape tier on the sheet — ADR 0113, on the real corpus through the builder. The Beast Shapes table is
 * prose in the 2014 book, so 5e's player character declares it; the 2024 Druid's own sheet line already states its tier.
 * Each test names the part of the declaration whose removal fails it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { Element } from '@incudo/core';
import { CharacterBuilder, newCharacterOfKind } from '@incudo/ui';

import { loadShippedSystem } from './node-system.ts';
import { corpusSkip, realElements } from './real-data.ts';

const PHB = 'Player’s Handbook';
const PHB24 = 'Player’s Handbook (2024)';

async function druid(book: string, level: number, circle?: string, className = 'Druid') {
  const system = await loadShippedSystem('dnd5e');
  const elements = await realElements();
  const b = new CharacterBuilder(newCharacterOfKind(system, 'pc'), system, elements);
  const pick = (stepId: string, test: (e: Element) => boolean) => {
    const decision = b.getState().decisions.find((d) => d.stepId === stepId && d.kind === 'pick');
    const id = decision?.candidates.find((c) => test(elements.get(c)!));
    assert.ok(decision && id, `the ${stepId} step offers what is asked for`);
    b.choose(decision.id, [id]);
  };
  pick('race', (e) => e.name === 'Human' && e.source === PHB);
  pick('class', (e) => e.name === className && e.source === book);
  b.setProgress(level);
  if (circle) {
    const decision = b.getState().decisions.find((d) => d.candidates.some((c) => elements.get(c)?.name === circle && elements.get(c)?.source === book));
    assert.ok(decision, `${circle} is offered`);
    b.choose(decision.id, [decision.candidates.find((c) => elements.get(c)?.name === circle && elements.get(c)?.source === book)!]);
  }
  const state = b.getState();
  return {
    rows: state.sheet.sections.find((s) => s.id === 'wild-shape')?.rows.map((r) => [r.label, r.value]),
    features: state.sheet.sections.flatMap((s) => s.elements),
  };
}

test('a 2014 Druid reads the Beast Shapes row for its level', { skip: corpusSkip }, async () => {
  // Fails if any literal's requirement is off by a level, or the section's showWhen hides it.
  assert.deepEqual((await druid(PHB, 2)).rows, [['Highest Challenge Rating', '1/4'], ['Limitations', 'No flying or swimming speed']]);
  assert.deepEqual((await druid(PHB, 4)).rows, [['Highest Challenge Rating', '1/2'], ['Limitations', 'No flying speed']]);
  assert.deepEqual((await druid(PHB, 8)).rows, [['Highest Challenge Rating', '1'], ['Limitations', 'None']]);
});

test('a 2014 Druid at 1 has no Wild Shape, so no section', { skip: corpusSkip }, async () => {
  // Fails if the contributions are not keyed on holding the feature.
  assert.equal((await druid(PHB, 1)).rows, undefined);
});

test("a 2014 Moon druid reads its Circle Forms' rating and keeps the table's limits", { skip: corpusSkip }, async () => {
  // Fails if the Circle Forms contribution is removed (the row reads the table's 1/2) or the literals ignore it.
  assert.deepEqual((await druid(PHB, 6, 'Circle of the Moon')).rows, [['Highest Challenge Rating', '2'], ['Limitations', 'No flying speed']]);
  assert.deepEqual((await druid(PHB, 2, 'Circle of the Moon')).rows, [['Highest Challenge Rating', '1'], ['Limitations', 'No flying or swimming speed']]);
});

test('a 2024 Druid shows no section, and its own sheet line names its tier; a Wizard shows none', { skip: corpusSkip }, async () => {
  // Fails if the contributions are keyed on anything a 2024 druid holds.
  const modern = await druid(PHB24, 4);
  assert.equal(modern.rows, undefined);
  const wildShape = modern.features.find((e) => /Wild Shape$/.test(e.name));
  assert.match(wildShape?.text ?? '', /CR 1\/2 or lower without a Fly Speed/);
  assert.equal((await druid(PHB, 8, undefined, 'Wizard')).rows, undefined);
});
