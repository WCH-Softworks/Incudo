/**
 * A sidekick: a character of its own, built on a creature and levelled in a sidekick class — ADR 0118.
 *
 * The official corpus has no sidekick class (the rules are not open content, and upstream holds only an empty
 * "Unearthed Arcana: Sidekicks" source), so the classes come from `tools/verify/fixtures/sidekicks/`, a user's own file
 * written for this in the project's own words, loaded beside the corpus as ADR 0056 loads one. Nothing below names a
 * class, a feature or a creature: they are found in the file by type, and the kind and its steps by what the system
 * declares.
 *
 * What is asserted: the kind is unavailable until a sidekick class is loaded; the player character is offered none of
 * the file's classes and the sidekick only those; a sidekick on the file's creature starts from its print (scores,
 * hit points, hit die and dice), reads its level, proficiency by level and features by level from its class, is offered
 * improvement options at 4 (feats only with the option on), and casts with its own slots, DC and attack; each level
 * after the first adds one of the creature's dice, rolled or averaged, and the Constitution modifier; a level can be set
 * at once through the split; and packed and reopened with no source it derives and shows the same.
 *
 * What is reported and not asserted (ADR 0042): how many sidekick classes the corpus declares, and how many creatures
 * print their dice.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { addFileSource, composeSource, ContentLibrary, SourceProfile } from '@incudo/content';
import {
  BundleElementIndex,
  deriveCharacter,
  MemoryStorage,
  readCharacterContainer,
  readPrintedDice,
  resolveCharacterKind,
  type Element,
  type ElementIndex,
  type Fetcher,
  type GameSystem,
} from '@incudo/core';
import { CharacterBuilder, characterKindChoices, newCharacterOfKind, packCharacter, sheetDocument } from '@incudo/ui';

import { loadCorpus } from './corpus.ts';
import { loadShippedSystem, repoRoot } from './node-system.ts';
import { corpusSkip, requireCorpus } from './real-data.ts';
import { summarize } from './derived-summary.ts';

const skip = corpusSkip;
const FILE = 'homebrew-sidekicks.xml';

/** The kind whose `available` names a type: the sidekick, found by what it declares and not by its id. */
function sidekickKind(system: GameSystem) {
  const def = system.characterKinds.find((kind) => kind.available !== undefined);
  assert.ok(def, 'the system declares a kind that needs content loaded');
  return resolveCharacterKind(system, def.id);
}

let corpus: Promise<ContentLibrary> | undefined;
let withFile: Promise<ContentLibrary> | undefined;

/** The corpus alone, loaded once per file. */
function corpusOnly(): Promise<ContentLibrary> {
  corpus ??= loadCorpus(requireCorpus()).then((loaded) => loaded.library);
  return corpus;
}

/** The corpus, then the file added as a user adds one (ADR 0056): no network. */
function corpusAndFile(): Promise<ContentLibrary> {
  withFile ??= (async () => {
    const library = (await loadCorpus(requireCorpus())).library;
    const text = await readFile(join(repoRoot(), 'tools', 'verify', 'fixtures', 'sidekicks', FILE), 'utf8');
    const storage = new MemoryStorage();
    const added = await addFileSource(new SourceProfile(storage), storage, { name: FILE, text }, { systemId: 'dnd5e' });
    const offline: Fetcher = { fetchText: () => Promise.reject(new Error('a file source reads no network')) };
    await library.loadSource(composeSource(added.source, { fetcher: offline, storage }), added.source.url);
    return library;
  })();
  return withFile;
}

/** The file's elements of a type, in file order. */
function fileElements(elements: ElementIndex, type: string): Element[] {
  return elements.byType(type).filter((e) => e.source === 'Homebrew Sidekicks Test');
}

function stat(builder: CharacterBuilder, name: string): number | undefined {
  return builder.getState().derived.stats.get(name)?.value;
}

test('what the corpus holds for a sidekick', { skip }, async (t) => {
  const system = await loadShippedSystem('dnd5e');
  const kind = sidekickKind(system);
  const elements = (await corpusOnly()).elements;
  const [type] = kind.available!.types;
  t.diagnostic(`sidekick classes in the corpus: ${elements.byType(type!).length}`);
  const creatures = elements.byType('Companion');
  const printed = creatures.filter((c) => readPrintedDice(c.setters['hp']?.value) !== undefined);
  t.diagnostic(`creatures printing their hit dice: ${printed.length} of ${creatures.length}`);
});

test('the kind is unavailable until a sidekick class is loaded, and a player character is never offered one', { skip }, async () => {
  const system = await loadShippedSystem('dnd5e');
  const kind = sidekickKind(system);
  const bare = (await corpusOnly()).elements;
  const loaded = (await corpusAndFile()).elements;
  const [type] = kind.available!.types;

  // Unavailable while nothing of the type is loaded, whatever else is; available once the file is.
  if (bare.byType(type!).length === 0) {
    assert.equal(characterKindChoices(system, bare).find((k) => k.id === kind.id)?.unavailable, kind.available!.note);
    assert.equal(new CharacterBuilder(newCharacterOfKind(system, kind.id), system, bare).getState().unavailable, kind.available!.note);
  }
  assert.equal(characterKindChoices(system, loaded).find((k) => k.id === kind.id)?.unavailable, undefined);
  assert.equal(characterKindChoices(system).find((k) => k.id === kind.id)?.unavailable, undefined, 'no content given, nothing is judged');

  // The file's classes are offered by the sidekick's class step and by no step of a player character.
  const classes = fileElements(loaded, type!).map((e) => e.id);
  assert.equal(classes.length, 3);
  const pc = new CharacterBuilder(newCharacterOfKind(system, 'pc'), system, loaded).getState();
  for (const decision of pc.decisions) {
    assert.ok(!decision.candidates.some((id) => classes.includes(id)), `${decision.label} offers no sidekick class`);
  }
  const creature = fileElements(loaded, 'Companion')[0]!;
  const b = new CharacterBuilder(newCharacterOfKind(system, kind.id), system, loaded);
  b.choose('build/creature', [creature.id]);
  const offered = b.getState().decisions.find((d) => d.id === 'build/class');
  assert.deepEqual([...offered!.candidates].sort(), [...classes].sort());
});

test('a sidekick starts from its creature and grows by its class', { skip }, async () => {
  const system = await loadShippedSystem('dnd5e');
  const kind = sidekickKind(system);
  const elements = (await corpusAndFile()).elements;
  const creature = fileElements(elements, 'Companion')[0]!;
  const martial = fileElements(elements, kind.available!.types[0]!)[0]!;
  const printed = readPrintedDice(creature.setters['hp']!.value)!;
  const b = new CharacterBuilder(newCharacterOfKind(system, kind.id), system, elements);
  b.choose('build/creature', [creature.id]);
  b.choose('build/class', [martial.id]);

  // Level 1: the creature's print, the class's level 1 features, a proficiency bonus of +2.
  assert.equal(stat(b, 'dexterity'), Number(creature.setters['dexterity']!.value));
  assert.equal(stat(b, 'hp'), 11, 'the printed hit points');
  assert.equal(stat(b, 'hit die'), printed.sides);
  assert.equal(stat(b, 'hit dice'), printed.count);
  assert.equal(stat(b, `level:${martial.name.toLowerCase()}`), 1);
  assert.equal(stat(b, 'proficiency'), 2);
  const grants = martial.rules.flatMap((rule) => (rule.kind === 'grant' && rule.level !== undefined ? [{ id: rule.id, level: rule.level }] : []));
  for (const grant of grants) assert.equal(b.getState().derived.elementIds.has(grant.id), grant.level <= 1, `${grant.id} at level 1`);
  // The first level owes no roll: the print covers it.
  const levels = b.getState().steps.find((step) => step.id === 'levels');
  assert.equal(levels?.hitPoints?.levels.length ?? 0, 0);

  // Level 4 at once: features to 4, an improvement option, and three rolls owed of the creature's die.
  b.setProgress(4);
  let state = b.getState();
  for (const grant of grants) assert.equal(state.derived.elementIds.has(grant.id), grant.level <= 4, `${grant.id} at level 4`);
  const hitpoints = state.steps.find((step) => step.id === 'levels')?.hitPoints;
  assert.deepEqual(hitpoints?.levels.map((level) => [level.level, level.dieSides, level.isFirst]), [
    [2, printed.sides, false],
    [3, printed.sides, false],
    [4, printed.sides, false],
  ]);
  const improvement = state.decisions.find((d) => d.label.startsWith('Improvement Option'));
  assert.ok(improvement, 'an improvement option is owed at 4');
  const feats = improvement!.candidates.filter((id) => id.includes('_FEAT_'));
  assert.ok(feats.length > 0, 'feats are offered while the campaign option is on, as for a new player character');
  b.choose('build/options', []);
  const without = b.getState().decisions.find((d) => d.id === improvement!.id);
  assert.ok(without && !without.candidates.some((id) => id.includes('_FEAT_')), 'and not once it is off');

  // Each later level: a recorded roll, or the average, plus the Constitution modifier.
  const con = stat(b, 'constitution:modifier')!;
  for (const level of [2, 3, 4]) b.changeHitPoints('levels', level, { value: 5 });
  assert.equal(stat(b, 'hp'), 11 + 3 * (5 + con));
  b.choose('build/options', ['ID_INTERNAL_OPTION_ALLOW_AVERAGE_HP']);
  assert.equal(stat(b, 'hp'), 11 + 3 * (Math.floor(printed.sides / 2) + 1 + con));
  assert.equal(stat(b, 'hit dice'), printed.count + 3);
  assert.equal(stat(b, 'proficiency'), 2);
  b.setProgress(20);
  assert.equal(stat(b, 'proficiency'), 6);

  // The sheet writes the class with its level and the creature's dice.
  state = b.getState();
  const listed = state.sheet.sections.flatMap((section) => section.elements).find((e) => e.elementId === martial.id);
  assert.deepEqual([listed?.progress, listed?.dice], [20, { count: printed.count + 19, sides: printed.sides }]);

  // Saved and reopened with no source, it derives and shows the same.
  const packed = packCharacter(state.character, system, elements, { generator: 'test' });
  const { container } = readCharacterContainer(packed.files);
  const reopened = deriveCharacter(container!.character, system, new BundleElementIndex(container!.content.elements), { kind });
  assert.deepEqual(summarize(reopened), summarize(state.derived));
  const again = new CharacterBuilder(container!.character, system, new BundleElementIndex(container!.content.elements)).getState();
  assert.deepEqual(sheetDocument(again), sheetDocument(state));
});

test('a caster sidekick casts with its own slots, DC and attack', { skip }, async () => {
  const system = await loadShippedSystem('dnd5e');
  const kind = sidekickKind(system);
  const elements = (await corpusAndFile()).elements;
  const creature = fileElements(elements, 'Companion')[0]!;
  const caster = fileElements(elements, kind.available!.types[0]!).find((e) => (e.spellcasting?.length ?? 0) > 0)!;
  const block = caster.spellcasting![0]!.name.toLowerCase();
  const b = new CharacterBuilder(newCharacterOfKind(system, kind.id), system, elements);
  b.choose('build/creature', [creature.id]);
  b.choose('build/class', [caster.id]);
  b.setProgress(3);
  const ability = Math.floor((Number(creature.setters[caster.spellcasting![0]!.ability!.toLowerCase()]!.value) - 10) / 2);
  assert.equal(stat(b, `${block}:spellcasting:dc`), 8 + 2 + ability);
  assert.equal(stat(b, `${block}:spellcasting:attack`), 2 + ability);
  assert.equal(stat(b, `${block}:spellcasting:slots:1`), 3);
  assert.equal(stat(b, `${block}:spellcasting:slots:2`), 2);
  // The spell selects offer the list's spells of a level the slots reach, and nothing higher.
  const spells = b.getState().decisions.find((d) => d.label.startsWith('Spell ('));
  assert.ok(spells && spells.candidates.length > 0, 'spells are offered');
  for (const id of spells!.candidates) {
    assert.ok(Number(elements.get(id)!.setters['level']?.value) <= 2, `${id} is of a level a slot reaches`);
  }
  // The sheet shows the block's slots by their labels.
  const slots = b.getState().sheet.sections.find((section) => section.section === 'block-slots');
  assert.ok(slots && slots.rows.length === 2 && slots.rows.every((row) => !row.label.includes(':')), 'two labelled slot rows');
});
