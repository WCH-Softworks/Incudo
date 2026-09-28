/**
 * Where a legendary creature's legendary actions, lair actions and regional effects come from — ADR 0065.
 *
 * The types are the ones the system's legendary kind adds to the NPC's, read off the two kinds and never spelled
 * here, and a sheet heading is a type's plural label, so nothing below names a type, a creature or a book.
 *
 * What is asserted, with no corpus at all: legendary content from a user's own Aurora file (ADR 0056) reaches a
 * legendary creature, granted by its creature or taken from its steps; a DM may write one on the creature instead,
 * listed where the type is; the uses a stat block prints are a number on the sheet a feature changes; and all of it
 * survives a save opened with no source. The file is `tools/verify/fixtures/legendary/`, generic and written for this.
 *
 * Perturbations that fail it, each checked: the legendary kind's two steps back to single optional picks (the file's
 * spare legendary action is offered nowhere), its `legendary actions` stat removed (the sheet has no uses), the
 * legendary types left out of its `customFeatures.types` (a written legendary action is not held), and its
 * `customFeatures.sections` without the legendary section (a feature cannot change the uses).
 *
 * What is reported and not asserted (ADR 0042: a moving corpus fails only what must hold against any corpus): how
 * many elements of those types the corpus declares, how many creature setters and grants name one, and how many
 * prose stat blocks carry a heading for one and print a cost. At c28ce6c every count is 0 except the prose: seven
 * stat blocks with a Legendary Actions heading, none with a lair or regional heading, and none printing a cost.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { ContentLibrary, addFileSource, composeSource, SourceProfile } from '@incudo/content';
import {
  BundleElementIndex,
  collectDeclaredBlocks,
  deriveCharacter,
  MemoryStorage,
  readCharacterContainer,
  renderSheetSection,
  resolveCharacterKind,
  type DerivedCharacter,
  type Element,
  type ElementIndex,
  type Fetcher,
  type GameSystem,
  type ResolvedCharacterKind,
} from '@incudo/core';
import { CharacterBuilder, newCharacterOfKind, packCharacter } from '@incudo/ui';

import { loadShippedSystem, repoRoot } from './node-system.ts';
import { corpusSkip, realElements } from './real-data.ts';

const skip = corpusSkip;

/** The types the legendary kind has and the NPC does not, as the system declares them. */
function legendaryTypes(system: GameSystem) {
  const npc = resolveCharacterKind(system, 'npc');
  const legendary = resolveCharacterKind(system, 'legendary');
  const own = legendary.elementTypes.filter((type) => !npc.elementTypes.includes(type));
  return own.map((name) => {
    const def = system.elementTypes.find((t) => t.name === name);
    return { name, heading: def?.plural ?? name };
  });
}

/** The text of every `<h…>` heading in an element's description, as a stat block prints it. */
function headings(element: Element): string[] {
  return [...(element.description ?? '').matchAll(/<h\d[^>]*>([^<]*)<\/h\d>/g)].map((m) => m[1]!.trim());
}

test('what the corpus holds for the types a legendary creature adds', { skip }, async (t) => {
  const system = await loadShippedSystem('dnd5e');
  const elements = await realElements();
  const types = legendaryTypes(system);
  assert.ok(types.length > 0, 'the legendary kind adds types of its own to the NPC');
  const names = new Set(types.map((type) => type.name));

  // Declared as elements, and named by anything as something a holder has: a setter or a grant.
  const declared = new Map(types.map((type) => [type.name, elements.byType(type.name).length]));
  let namedBySetter = 0;
  let namedByGrant = 0;
  for (const element of elements.all()) {
    for (const setter of Object.values(element.setters)) {
      for (const id of String(setter.value ?? '').split(',')) {
        const named = elements.get(id.trim());
        if (named && names.has(named.type)) namedBySetter++;
      }
    }
    for (const rule of element.rules) {
      if (rule.kind !== 'grant') continue;
      const named = elements.get(rule.id);
      if ((named && names.has(named.type)) || (rule.type !== undefined && names.has(rule.type))) namedByGrant++;
    }
  }
  for (const type of types) t.diagnostic(`${type.name}: ${declared.get(type.name)} elements declared`);
  t.diagnostic(`named by a setter: ${namedBySetter}; granted: ${namedByGrant}`);

  // Written as prose: a description carrying the heading a stat block prints for the type, and whether that
  // section prints a cost ("Costs 2 Actions", the 2014 books' way of pricing one).
  for (const type of types) {
    const blocks = [...elements.all()].filter((element) => headings(element).includes(type.heading));
    const kinds = [...new Set(blocks.map((element) => element.type))].join(', ') || 'none';
    const priced = blocks.filter((element) => {
      const text = element.description ?? '';
      const from = text.indexOf(`>${type.heading}<`);
      const section = text.slice(from, text.indexOf('<h', from + 1) >= 0 ? text.indexOf('<h', from + 1) : undefined);
      return /Costs \d+ Actions?/i.test(section);
    });
    // How many uses a section prints ("Uses: 3", "Uses: 3 (4 in Lair)"), read only to be counted here.
    const uses = blocks.map((element) => /Uses: (\d+)( \([^)]*\))?/.exec(element.description ?? '')?.slice(1, 3).join('') ?? '?');
    const tally = [...new Set(uses)].map((u) => `${uses.filter((x) => x === u).length} × ${u}`).join(', ') || 'none';
    t.diagnostic(
      `"${type.heading}" as a heading in prose: ${blocks.length} (of type ${kinds}), ${priced.length} printing a cost; uses printed: ${tally}`,
    );
  }

  // What must hold against any corpus: the legendary creature's steps for these types offer exactly what is
  // declared of them, so a corpus that gains some has them offered, and one with none offers nothing.
  const kind = resolveCharacterKind(system, 'legendary');
  const steps = kind.buildSteps.filter((step) => step.types.some((type) => names.has(type)));
  assert.ok(steps.length > 0, 'the legendary kind has a step for its own types');
  const state = new CharacterBuilder(newCharacterOfKind(system, 'legendary'), system, elements).getState();
  for (const step of steps) {
    const offered = state.decisions.find((d) => d.stepId === step.id)?.candidates ?? [];
    const declaredOfStep = step.types.flatMap((type) => elements.byType(type)).filter((e) => e.requirements === undefined);
    for (const element of declaredOfStep) assert.ok(offered.includes(element.id), `${step.id} offers ${element.id}`);
    t.diagnostic(`step "${step.label}": ${offered.length} offered to a fresh legendary creature`);
  }
});

/** A user's own file, added and loaded as ADR 0056 adds one: no network, no corpus. */
async function homebrew(): Promise<ElementIndex> {
  const name = 'homebrew-legendary.xml';
  const text = await readFile(join(repoRoot(), 'tools', 'verify', 'fixtures', 'legendary', name), 'utf8');
  const storage = new MemoryStorage();
  const added = await addFileSource(new SourceProfile(storage), storage, { name, text }, { systemId: 'dnd5e' });
  const offline: Fetcher = { fetchText: () => Promise.reject(new Error('a file source reads no network')) };
  const library = new ContentLibrary();
  await library.loadSource(composeSource(added.source, { fetcher: offline, storage }), added.source.url);
  return library.elements;
}

interface ShownSection {
  stats: Map<string, unknown>;
  names: string[];
}

/** Each sheet section's stats and the names of the elements it lists, as the sheet shows them. */
function sheet(derived: DerivedCharacter, kind: ResolvedCharacterKind): Map<string, ShownSection> {
  const reader = { statValue: (key: string) => derived.stats.get(key.toLowerCase())?.value, elements: derived.elements };
  const blocks = collectDeclaredBlocks(derived.elements);
  const out = new Map<string, ShownSection>();
  for (const rendering of kind.sheet.sections.flatMap((s) => renderSheetSection(s, blocks, reader))) {
    out.set(rendering.id, {
      stats: new Map(rendering.stats.map((stat) => [stat, reader.statValue(stat)])),
      names: derived.elements.filter((e) => rendering.types.includes(e.type)).map((e) => e.name).sort(),
    });
  }
  return out;
}

/** The sheet section that lists a type. */
function sectionOf(kind: ResolvedCharacterKind, type: string): string {
  const section = kind.sheet.sections.find((s) => s.types?.includes(type));
  assert.ok(section, `the ${kind.name} sheet lists ${type}`);
  return section.id;
}

function grantedIds(element: Element): string[] {
  return element.rules.flatMap((rule) => (rule.kind === 'grant' ? [rule.id] : []));
}

test("a user's own file brings a legendary creature its legendary content, granted or taken from the steps", async () => {
  const system = await loadShippedSystem('dnd5e');
  const elements = await homebrew();
  const kind = resolveCharacterKind(system, 'legendary');
  const types = legendaryTypes(system).map((t) => t.name);
  const creatureStep = kind.buildSteps.find((s) => s.required && s.types.length > 0 && !s.budget)!;
  const creature = creatureStep.types.flatMap((type) => elements.byType(type))[0]!;
  assert.ok(creature, 'the file declares a creature');
  const granted = grantedIds(creature);
  const spare = types.flatMap((type) => elements.byType(type)).filter((e) => !granted.includes(e.id));
  assert.ok(granted.length > 0 && spare.length > 0, 'the file grants legendary content and declares some it does not grant');

  const b = new CharacterBuilder(newCharacterOfKind(system, 'legendary'), system, elements);
  b.choose(`build/${creatureStep.id}`, [creature.id]);
  let state = b.getState();
  // What the creature grants is held and listed under its own type's section.
  for (const id of granted) {
    const element = elements.get(id)!;
    assert.ok(state.derived.elementIds.has(id), `${element.name} is held`);
    assert.ok(sheet(state.derived, kind).get(sectionOf(kind, element.type))!.names.includes(element.name), `${element.name} is listed`);
  }

  // What it does not grant is offered by the step for its type, and what is held is not.
  for (const element of spare) {
    const step = kind.buildSteps.find((s) => s.types.includes(element.type))!;
    const decision = state.decisions.find((d) => d.stepId === step.id);
    assert.ok(decision?.candidates.includes(element.id), `${step.label} offers ${element.name}`);
    assert.ok(!decision!.candidates.some((id) => granted.includes(id)), `${step.label} does not offer what the creature grants`);
    b.choose(`build/${step.id}`, [...decision!.chosen, element.id]);
    state = b.getState();
  }
  for (const element of spare) assert.ok(state.derived.elementIds.has(element.id), `${element.name} is held once taken`);

  // Saved and reopened with no source, it is the same creature.
  const packed = packCharacter(state.character, system, elements, { generator: 'test' });
  const { container } = readCharacterContainer(packed.files);
  const reopened = deriveCharacter(container!.character, system, new BundleElementIndex(container!.content.elements));
  assert.deepEqual([...reopened.elementIds].sort(), [...state.derived.elementIds].sort());
  assert.deepEqual(sheet(reopened, kind), sheet(state.derived, kind));
});

test('a DM writes legendary content on the creature, listed where its type is, and the uses are a number a feature changes', async () => {
  const system = await loadShippedSystem('dnd5e');
  const elements = await homebrew();
  const kind = resolveCharacterKind(system, 'legendary');
  const legendary = legendaryTypes(system).map((t) => t.name);
  const uses = kind.sheet.sections.find((s) => s.id === sectionOf(kind, legendary[0]!))!.stats?.[0];
  assert.ok(uses, 'the legendary actions section shows how many a creature takes');

  // From nothing: no creature and nothing taken from the file, only what the DM writes.
  const b = new CharacterBuilder(newCharacterOfKind(system, 'legendary'), system, elements);
  assert.equal(b.getState().derived.stats.get(uses)?.value, 3, 'a legendary creature takes three unless something says otherwise');
  const offered = b.getState().customFeatures.types.map((t) => t.type);
  assert.deepEqual(offered.filter((type) => legendary.includes(type)), legendary, 'a written feature may be listed under each');
  const written = new Map<string, string>();
  for (const type of legendary) {
    const id = b.addCustomFeature(`Written ${type}`)!;
    b.updateCustomFeature(id, { type, description: 'Written by the DM.' });
    written.set(type, `Written ${type}`);
  }
  const lair = b.addCustomFeature('Lair')!;
  b.updateCustomFeature(lair, { stats: [{ stat: uses, mode: 'add', value: 1 }] });

  const state = b.getState();
  assert.equal(state.character.formatVersion, 6);
  assert.deepEqual(state.derived.problems.filter((p) => p.code.startsWith('custom-feature')), []);
  assert.equal(state.derived.stats.get(uses)?.value, 4, 'the lair adds one use');
  const shown = sheet(state.derived, kind);
  for (const [type, name] of written) assert.ok(shown.get(sectionOf(kind, type))!.names.includes(name), `${name} is listed with its type`);

  const packed = packCharacter(state.character, system, elements, { generator: 'test' });
  const { container } = readCharacterContainer(packed.files);
  const reopened = deriveCharacter(container!.character, system, new BundleElementIndex(container!.content.elements));
  assert.deepEqual(sheet(reopened, kind), shown, 'the same after a save opened with no source');
});

test('an NPC built on a legendary creature holds what it grants, and its sheet lists none of it', async (t) => {
  // Reported, not asserted as a rule: the legendary kind is the one for that creature (ADR 0065).
  const system = await loadShippedSystem('dnd5e');
  const elements = await homebrew();
  const npc = resolveCharacterKind(system, 'npc');
  const creatureStep = npc.buildSteps.find((s) => s.required && s.types.length > 0 && !s.budget)!;
  const creature = creatureStep.types.flatMap((type) => elements.byType(type))[0]!;
  const b = new CharacterBuilder(newCharacterOfKind(system, 'npc'), system, elements);
  b.choose(`build/${creatureStep.id}`, [creature.id]);
  const derived = b.getState().derived;
  const names = new Set(legendaryTypes(system).map((type) => type.name));
  const held = derived.elements.filter((e) => names.has(e.type));
  const listed = [...sheet(derived, npc).values()].flatMap((s) => s.names).filter((name) => held.some((e) => e.name === name));
  t.diagnostic(`an NPC on the file's creature holds ${held.length} of its legendary elements and lists ${listed.length}`);
  assert.ok(held.length > 0);
});
