/**
 * One thing printed in two books, measured before deciding what makes two elements the same — ADR 0125.
 *
 * AuroraLegacy carries the 2014 and 2024 printings of the same spells, feats, languages and more as different elements,
 * and a caster's cantrip pool took "Acid Splash — Player's Handbook" and then "Acid Splash — Player's Handbook (2024)".
 * Reported first (`ℹ` lines, nothing asserted: ADR 0042, a moving corpus fails only what must hold against any corpus):
 *
 * - how many names more than one element of a type declares, across books and within one;
 * - how alike the two descriptions of a cross-book pair are (shared words over all words), by type, as a reading of
 *   "a reprint" against "two things sharing a name";
 * - whether content links printings itself: an element's own requirement naming an element of its type and name;
 * - how many the thirty samples hold two of, by type, and whether any is from two books of a type 5e identifies by name;
 * - how the NPC's Traits offer reads with and without the element that gives each trait.
 *
 * At `c28ce6c`: 2,625 names declared more than once (6,780 elements); 2,238 of them across books, 430 of them spells. No
 * spell name is repeated within a book; feats are (Elemental Adept five times, Skilled nine, so a feat can be taken
 * again), and Class Features share names across classes (every class's Ability Score Improvement, Spellcasting). Content
 * links 386 pairs by a requirement, 161 of them feats and none a spell. The samples hold two of a name 21 times, every
 * one a Class Feature or a Feat Feature, never a spell, feat, language or proficiency.
 *
 * Asserted against any corpus: a 2014 Wizard who takes one printing of a cantrip is no longer offered the other on the
 * open decision, and the slot holding it may still change to it; a Cleric preparing one printing of a spell is not
 * offered the other; and no sample is offered another printing of anything it holds.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  HeldPrintings,
  deriveCharacter,
  isOtherPrinting,
  preparationPool,
  printingTypes,
  resolveCharacterKind,
  type Element,
  type ElementIndex,
} from '@incudo/core';
import { CharacterBuilder, candidateLabel, newCharacterOfKind, preparationOptions, slotOptions } from '@incudo/ui';

import { runOracle } from './aurora-oracle.ts';
import { loadShippedSystem } from './node-system.ts';
import { corpusProvenance, corpusSkip, realElements, savesSkip } from './real-data.ts';
import { readManifest, samplePath } from './sample-saves.ts';

const PHB = 'Player’s Handbook';

function tally(values: string[], limit = 12): string {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  const sorted = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const shown = sorted.slice(0, limit).map(([v, n]) => `${n} ${v}`);
  if (sorted.length > limit) shown.push(`${sorted.length - limit} more`);
  return shown.join(', ') || 'none';
}

const words = (html: string | undefined): Set<string> =>
  new Set(
    (html ?? '')
      .replace(/<[^>]*>/g, ' ')
      .replace(/&[a-z#0-9]+;/gi, ' ')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean),
  );

/** Shared words over all words of two descriptions; 1 when neither has any. */
function alike(a: Element, b: Element): number {
  const x = words(a.description);
  const y = words(b.description);
  if (!x.size && !y.size) return 1;
  let both = 0;
  for (const word of x) if (y.has(word)) both++;
  return both / (x.size + y.size - both);
}

const book = (element: Element): string => element.source.trim().toLowerCase();
const nameKey = (element: Element): string => `${element.type}\u0000${element.name.trim().toLowerCase()}`;

function byName(elements: Iterable<Element>): Element[][] {
  const groups = new Map<string, Element[]>();
  for (const element of elements) {
    const group = groups.get(nameKey(element));
    if (group) group.push(element);
    else groups.set(nameKey(element), [element]);
  }
  return [...groups.values()].filter((group) => group.length > 1);
}

test('how often one name is declared more than once, and whether content links the printings (report)', { skip: corpusSkip }, async (t) => {
  t.diagnostic(corpusProvenance());
  const system = await loadShippedSystem('dnd5e');
  const elements = await realElements();
  const identified = printingTypes(system);
  t.diagnostic(`5e identifies by name: ${[...identified].join(', ')}`);

  const groups = byName(elements.all());
  t.diagnostic(`names declared more than once: ${groups.length} (${groups.reduce((n, g) => n + g.length, 0)} elements)`);
  const across = groups.filter((group) => new Set(group.map(book)).size > 1);
  const within = groups.filter((group) => new Set(group.map(book)).size < group.length);
  t.diagnostic(`across books: ${across.length}: ${tally(across.map((g) => g[0]!.type))}`);
  t.diagnostic(`a name repeated within one book: ${within.length}: ${tally(within.map((g) => g[0]!.type))}`);
  for (const type of identified) {
    const same = within.filter((group) => group[0]!.type === type);
    if (same.length) t.diagnostic(`${type} names one book repeats: ${tally(same.map((g) => g[0]!.name))}`);
  }

  // How alike each cross-book pair reads, by type: most spells and feats are the same text revised, and the few that
  // are not (Blade Ward, True Strike, the 2024 Alert) are still the spell or feat of that name.
  const readings: Array<[string, string]> = [];
  for (const group of across) {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        if (book(group[i]!) === book(group[j]!)) continue;
        const score = alike(group[i]!, group[j]!);
        readings.push([group[i]!.type, score >= 0.6 ? 'alike' : score >= 0.3 ? 'revised' : 'rewritten']);
      }
    }
  }
  const read = (keep: (type: string) => boolean): string =>
    tally(readings.filter(([type]) => keep(type)).map(([type, reading]) => `${type} ${reading}`), 20);
  t.diagnostic(`cross-book pairs of those types, by how alike their text is: ${read((type) => identified.has(type))}`);
  t.diagnostic(`and of the other types: ${read((type) => !identified.has(type))}`);

  // Content's own links: an element whose own requirements name an element of its type and name.
  const linked: string[] = [];
  const linkedGroups = new Set<string>();
  for (const element of elements.all()) {
    for (const match of JSON.stringify(element.requirements ?? '').matchAll(/"id":"([^"]+)"/g)) {
      const other = elements.get(match[1]!);
      if (!other || other.id === element.id || nameKey(other) !== nameKey(element)) continue;
      linked.push(element.type);
      linkedGroups.add(nameKey(element));
    }
  }
  t.diagnostic(`requirements naming an element of the same type and name: ${linked.length} (${tally(linked)})`);
  for (const type of identified) {
    const ofType = across.filter((group) => group[0]!.type === type);
    t.diagnostic(`${type}: ${ofType.length} names across books, ${ofType.filter((g) => linkedGroups.has(nameKey(g[0]!))).length} of them linked by content`);
  }
});

test('how often a sample holds two of one name (report), and that none is offered another printing of what it holds', { skip: savesSkip }, async (t) => {
  // Fails if a pool offers a printing of something the character holds: the engine's filter is gone, or reads ids only.
  const elements = await realElements();
  t.diagnostic(corpusProvenance());
  const held: string[] = [];
  const twice: string[] = [];
  let pools = 0;
  for (const sample of readManifest().samples) {
    const run = await runOracle(samplePath(sample), elements, 'sample');
    const types = printingTypes(run.system);
    for (const group of byName(run.derived.elements)) {
      held.push(`${group[0]!.type}${types.has(group[0]!.type) && new Set(group.map(book)).size > 1 ? ' (two books)' : ''}`);
    }
    twice.push(...run.derived.problems.filter((p) => p.code === 'printing-twice').map((p) => p.message));
    const printings = new HeldPrintings(run.derived.elements, types);
    for (const pool of [...run.derived.pendingChoices, ...run.derived.answeredChoices]) {
      pools++;
      for (const id of pool.candidates) {
        const candidate = run.elements.get(id);
        const other = candidate && printings.otherPrintings(candidate)[0];
        assert.ok(!other, `${pool.label} offers ${candidate?.name} (${candidate?.source}) to a character holding ${other?.source}'s`);
      }
    }
  }
  t.diagnostic(`two of one name held: ${held.length} (${tally(held)})`);
  t.diagnostic(`held from two books, warned: ${twice.length}${twice.length ? `: ${twice.join('; ')}` : ''}; pools checked: ${pools}`);
});

/** A 2014 Human of a class at level 1, built through the builder's own decisions. */
function build2014(system: Awaited<ReturnType<typeof loadShippedSystem>>, elements: ElementIndex, className: string): CharacterBuilder {
  const b = new CharacterBuilder(newCharacterOfKind(system, 'pc'), system, elements);
  for (const [step, name] of [['race', 'Human'], ['class', className]] as const) {
    const decision = b.getState().decisions.find((d) => d.stepId === step);
    const id = decision?.candidates.find((c) => elements.get(c)?.name === name && elements.get(c)?.source === PHB);
    assert.ok(decision && id, `a 2014 ${name} is offered`);
    b.choose(decision.id, [id]);
  }
  return b;
}

test('a 2014 Wizard taking one printing of a cantrip is not offered the other, and may change book', { skip: corpusSkip }, async (t) => {
  // Fails if the open decision still offers the other printing, or the slot holding one cannot change to the other.
  t.diagnostic(corpusProvenance());
  const system = await loadShippedSystem('dnd5e');
  const elements = await realElements();
  const types = printingTypes(system);
  const b = build2014(system, elements, 'Wizard');
  const cantrips = b.getState().decisions.find((d) => d.candidates.some((id) => elements.get(id)?.type === 'Spell'));
  assert.ok(cantrips, 'a level 1 Wizard has a spell decision');
  const offered = cantrips.candidates.map((id) => elements.get(id)!);
  const pairs = offered.flatMap((a) => offered.filter((o) => isOtherPrinting(a, o, types)).map((o) => [a, o] as const));
  const pair = pairs.find(([a]) => a.source === PHB) ?? pairs[0];
  assert.ok(pair, 'the decision offers two printings of one spell before either is taken');
  const [first, second] = pair;
  t.diagnostic(`took ${first.name} (${first.source}); the other is ${second.source}'s`);
  b.choose(cantrips.id, [first.id]);
  const after = b.getState().decisions.find((d) => d.id === cantrips.id);
  assert.ok(after && !after.candidates.includes(second.id), 'the open decision no longer offers the other printing');
  const pick = b.getState().picks.find((p) => p.ruleKey === cantrips.id);
  assert.ok(pick && slotOptions(pick, 0).includes(second.id), 'the slot holding it may change to the other printing');
});

test('a 2014 Cleric preparing one printing of a spell is not offered the other to prepare', { skip: corpusSkip }, async () => {
  // Fails if the offer to prepare (`preparationOptions`) includes another printing of what the block already prepares,
  // or if the pool under it stops being the class's whole list (Aurora lists both printings, and the oracle holds it).
  const system = await loadShippedSystem('dnd5e');
  const elements = await realElements();
  const types = printingTypes(system);
  const b = build2014(system, elements, 'Cleric');
  const derived = b.getState().derived;
  const block = derived.preparation[0];
  assert.ok(block, 'a 2014 Cleric prepares spells');
  const pool = preparationPool(derived, elements, block.key);
  const first = pool.find((a) => pool.some((o) => isOtherPrinting(a, o, types)));
  assert.ok(first, 'the list offers two printings of one spell before either is prepared');
  const character = { ...derived.character, prepared: { [block.key]: [first.id] } };
  const prepared = deriveCharacter(character, system, elements, { kind: resolveCharacterKind(system, 'pc') });
  const offered = preparationOptions(prepared, elements, block.key).map((item) => elements.get(item.id)!);
  assert.ok(
    !offered.some((spell) => isOtherPrinting(spell, first, types)),
    `${first.name} from another book is offered after ${first.source}'s is prepared`,
  );
  assert.ok(
    preparationPool(prepared, elements, block.key).some((spell) => isOtherPrinting(spell, first, types)),
    'the class list itself still holds the other printing',
  );
});

test("the NPC's Traits offer, told apart by what gives each trait (report)", { skip: corpusSkip }, async (t) => {
  const system = await loadShippedSystem('dnd5e');
  const elements = await realElements();
  const b = new CharacterBuilder(newCharacterOfKind(system, 'npc'), system, elements);
  const kind = resolveCharacterKind(system, 'npc');
  const traits = b.getState().decisions.find((d) => d.label === 'Traits');
  if (!traits) return void t.skip('no Traits decision on a new NPC');
  const duplicates = (labels: string[]): number => labels.length - new Set(labels).size;
  const plain = traits.candidates.map((id) => candidateLabel(elements.get(id)!, kind.candidateNotes));
  const told = traits.candidates.map((id) => candidateLabel(elements.get(id)!, kind.candidateNotes, elements));
  const left = told.filter((label, at) => told.indexOf(label) !== at);
  t.diagnostic(
    `Traits offered: ${traits.candidates.length}; rows reading the same as another: ${duplicates(plain)} by name and book, ` +
      `${duplicates(told)} with what gives them${left.length ? ` (${tally(left, 6)})` : ''}`,
  );
});
