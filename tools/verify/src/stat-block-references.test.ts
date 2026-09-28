/**
 * The prose stat blocks, and what a reference to one beside an NPC stands on.
 *
 * ROADMAP Phase 4: "show the 2025 Monster Manual's prose stat blocks as a reference beside an NPC". ADR 0057 counted
 * them as HTML inside elements' descriptions; this measures, from content alone, what they are.
 *
 * A stat block is recognised here by the one thing every one of them prints and nothing else does: a table of the six
 * ability scores, each a bold three-letter heading cell. That is a reading of prose, fine for a measurement and the
 * reason it is not what the app offers. Everything else is read off the elements: their type, their book, their
 * headings, and what names them. No element is found by its name or its id.
 *
 * What is reported and not asserted (ADR 0042: a moving corpus fails only what must hold against any corpus): how
 * many stat blocks there are, of what types and books; how many of their type are not stat blocks; how many open with
 * the empty heading Aurora's stat blocks start with; whether one embeds another element; and what names one, by a
 * grant, a setter or an embedding `<div element>`, and whether any of that is a creature an NPC can start from. And,
 * since ADR 0068, how many of the stat blocks are of a type the NPC keeps as a reference.
 *
 * What is asserted, against whatever the corpus holds (ADR 0068): every element of the types the NPC keeps as a
 * reference is offered to a fresh NPC; an NPC from nothing and one on a creature, each keeping all of them, derive
 * exactly what they derive keeping none; and saved and reopened with no source, every one shows the same text. Fails
 * with references seeded into the derivation (the summaries differ), and with them left out of the save (a reopened
 * row is not known). The legendary creature inherits the NPC's references and is held to the same.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  BundleElementIndex,
  readCharacterContainer,
  resolveCharacterKind,
  type Element,
  type ElementIndex,
} from '@incudo/core';
import { CharacterBuilder, newCharacterOfKind, packCharacter } from '@incudo/ui';

import { summarize } from './derived-summary.ts';
import { loadShippedSystem } from './node-system.ts';
import { corpusSkip, realElements } from './real-data.ts';

const skip = corpusSkip;

const ABILITY_CELLS = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'];

/** Whether a description prints the six ability scores as a stat block's table does. */
function isStatBlock(element: Element): boolean {
  const text = element.description ?? '';
  return /<table/i.test(text) && ABILITY_CELLS.every((cell) => new RegExp(`<(b|strong)>${cell}</(b|strong)>`).test(text));
}

/** Whether it prints a challenge rating as a number: a creature's, not a summon's ("None", scaling with its caster). */
function printsRating(element: Element): boolean {
  return /<(b|strong)>(CR|Challenge)<\/(b|strong)>\s*\d/.test(element.description ?? '');
}

/** Opens with an empty heading, as Aurora's stat blocks do. */
function opensWithEmptyHeading(element: Element): boolean {
  return /^\s*<h\d[^>]*\/>/.test(element.description ?? '');
}

/** The ids an element's description embeds with Aurora's `<div element="…">`. */
function embeddedIds(element: Element): string[] {
  return [...(element.description ?? '').matchAll(/<div element="([^"]+)"/g)].map((m) => m[1]!);
}

function tally(values: string[]): string {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([v, n]) => `${n} ${v}`).join(', ') || 'none';
}

/** The types a fresh NPC starts from: its required single pick's, read off the kind. */
async function creatureTypes(): Promise<string[]> {
  const system = await loadShippedSystem('dnd5e');
  const npc = resolveCharacterKind(system, 'npc');
  const step = npc.buildSteps.find((s) => (s.required || s.pick) && s.types.length > 0 && !s.budget && !s.multiple);
  assert.ok(step, 'the NPC starts from a creature');
  return step.types;
}

/** Everything that names an element: a grant, a setter's comma-separated ids, or an embedding in a description. */
function namers(elements: ElementIndex): Map<string, { by: Element; how: string }[]> {
  const out = new Map<string, { by: Element; how: string }[]>();
  const add = (id: string, by: Element, how: string) => {
    const list = out.get(id) ?? [];
    list.push({ by, how });
    out.set(id, list);
  };
  for (const element of elements.all()) {
    for (const rule of element.rules) if (rule.kind === 'grant') add(rule.id, element, 'grant');
    for (const setter of Object.values(element.setters)) {
      for (const id of String(setter.value ?? '').split(',')) if (id.trim()) add(id.trim(), element, 'setter');
    }
    for (const id of embeddedIds(element)) add(id, element, 'embedding');
  }
  return out;
}

test('what the prose stat blocks are, read from content alone', { skip }, async (t) => {
  const elements = await realElements();
  const blocks = [...elements.all()].filter(isStatBlock);
  const types = [...new Set(blocks.map((e) => e.type))];
  t.diagnostic(`stat blocks in prose: ${blocks.length}, of type ${tally(blocks.map((e) => e.type))}`);
  t.diagnostic(`by book: ${tally(blocks.map((e) => e.source ?? '(none)'))}`);
  t.diagnostic(
    `printing a challenge rating as a number: ${blocks.filter(printsRating).length}; the rest print none and scale with whoever summons them`,
  );

  // Is the type enough to find one? Every element of each type a stat block is found in, and per book how many of
  // that book's elements of the type are stat blocks.
  for (const type of types) {
    const all = elements.byType(type);
    const rest = all.filter((e) => !isStatBlock(e));
    t.diagnostic(`${type}: ${all.length} elements, ${all.length - rest.length} stat blocks, ${rest.length} not`);
    const books = [...new Set(all.map((e) => e.source ?? '(none)'))];
    const whole = books.filter((book) => all.filter((e) => (e.source ?? '(none)') === book).every(isStatBlock));
    t.diagnostic(`${type}: books whose every element of it is a stat block: ${whole.join(', ') || 'none'} (of ${books.length})`);
    t.diagnostic(
      `${type}: description opening with an empty heading: ${all.filter(opensWithEmptyHeading).length}, ` +
        `${blocks.filter((e) => e.type === type && opensWithEmptyHeading(e)).length} of them stat blocks`,
    );
  }
  t.diagnostic(
    `stat blocks carrying setters, rules, supports or requirements: ${
      blocks.filter((e) => Object.keys(e.setters).length || e.rules.length || e.supports.length || e.requirements).length
    }`,
  );
  t.diagnostic(`stat blocks embedding another element: ${blocks.filter((e) => embeddedIds(e).length > 0).length}`);

  // What names a stat block, and whether anything ties one to a creature an NPC can start from.
  const creatures = new Set(await creatureTypes());
  const named = namers(elements);
  const ways = blocks.flatMap((block) => (named.get(block.id) ?? []).map((n) => `${n.how} from ${n.by.type}`));
  t.diagnostic(`named by: ${tally(ways)}`);
  t.diagnostic(`stat blocks named by nothing: ${blocks.filter((b) => !named.has(b.id)).length}`);
  const byCreature = blocks.filter((b) => (named.get(b.id) ?? []).some((n) => creatures.has(n.by.type)));
  t.diagnostic(`named by a creature an NPC starts from (${[...creatures].join(', ')}): ${byCreature.length}`);
  const creatureNamers = [...creatures].flatMap((type) => elements.byType(type));
  const namesACreature = blocks.filter((b) =>
    creatureNamers.some((c) => c.name.toLowerCase() === b.name.toLowerCase() && c.source === b.source),
  );
  t.diagnostic(
    `sharing a name and a book with such a creature: ${namesACreature.length} (a coincidence of text, which nothing reads)`,
  );

  const system = await loadShippedSystem('dnd5e');
  const kept = new Set(resolveCharacterKind(system, 'npc').references?.types ?? []);
  t.diagnostic(
    `of a type an NPC keeps as a reference (${[...kept].join(', ') || 'none'}): ${blocks.filter((b) => kept.has(b.type)).length} of ${blocks.length}`,
  );
});

test('an NPC keeps every element of its reference types beside it, moves nothing, and shows them with no source', { skip }, async (t) => {
  const system = await loadShippedSystem('dnd5e');
  const elements = await realElements();
  for (const kindId of ['npc', 'legendary']) {
    const kind = resolveCharacterKind(system, kindId);
    const types = kind.references?.types ?? [];
    assert.ok(types.length > 0, `the ${kind.name} keeps references`);
    const all = types.flatMap((type) => elements.byType(type)).map((e) => e.id);

    const creatureStep = kind.buildSteps.find((s) => (s.required || s.pick) && s.types.length > 0 && !s.budget && !s.multiple)!;
    const fresh = new CharacterBuilder(newCharacterOfKind(system, kindId), system, elements);
    const creature = fresh.getState().decisions.find((d) => d.stepId === creatureStep.id)!.candidates[0]!;
    const starts: [string, (b: CharacterBuilder) => void][] = [
      ['from nothing', () => {}],
      ['on a creature', (b) => b.choose(`build/${creatureStep.id}`, [creature])],
    ];
    for (const [label, start] of starts) {
      const b = new CharacterBuilder(newCharacterOfKind(system, kindId), system, elements);
      start(b);
      assert.deepEqual([...b.referenceOptionsFor()].sort(), [...all].sort(), `${kind.name} ${label}: every one is offered`);
      const before = summarize(b.getState().derived);
      for (const id of all) assert.equal(b.addReference(id), true, `${kind.name} ${label}: ${id} is kept`);
      const state = b.getState();
      assert.equal(state.character.formatVersion, 7);
      assert.deepEqual(summarize(state.derived), before, `${kind.name} ${label}: nothing derived moves`);
      assert.ok(state.references.rows.every((r) => r.shown), `${kind.name} ${label}: every one is shown`);

      // Saved, and reopened against nothing but what the save embeds.
      const packed = packCharacter(state.character, system, elements, { generator: 'test' });
      const { container } = readCharacterContainer(packed.files);
      const reopened = new CharacterBuilder(container!.character, system, new BundleElementIndex(container!.content.elements));
      assert.deepEqual(reopened.getState().references, state.references, `${kind.name} ${label}: the same with no source`);
      assert.deepEqual(summarize(reopened.getState().derived), before, `${kind.name} ${label}: and derives the same`);
    }
    t.diagnostic(`${kind.name}: ${all.length} offered and kept, from nothing and on a creature`);
  }
});
