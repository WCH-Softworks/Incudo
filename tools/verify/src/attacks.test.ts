/**
 * What content says about an attack, what Aurora records of one, and what the official form takes — measured before
 * deciding how a kind declares attacks (ADR 0093).
 *
 * - **Weapons**, over the corpus: how many, which setters they carry (`damage` and its `type`, `versatile`, `range`,
 *   `proficiency`), which support tags (category, property, mastery), and which of those tags name an element (and so a
 *   name a sheet can print) and which do not. Magic weapons: which carry `enhancement`, and how (an adorner, ADR 0024,
 *   or the weapon itself).
 * - **Stats content writes about attacks and damage**: every `<stat>` whose name reads like one, by whether it is a
 *   character-wide bonus for a kind of attack (`ranged:attack`), a named feature's own number, or a held creature's
 *   (`companion:attack`).
 * - **The samples**: every `<attack>` Aurora recorded (its name, range, bonus, damage, ability and the words it wrote
 *   under it), beside the character's equipped weapons, and each bonus worked from the derivation as the book says
 *   (the ability's modifier, the proficiency bonus when the character holds the weapon's proficiency, an enhancement,
 *   and `ranged:attack` for a ranged weapon).
 * - **The official 2014 form**: what its attack boxes are.
 *
 * Reported as `ℹ` lines; nothing here asserts anything (ADR 0042). Since ADR 0093 the tests after them hold what the 5e
 * declaration does against Aurora's own rows.
 */

import { test } from 'node:test';
import { readFile } from 'node:fs/promises';

import { childrenNamed, findFirst, parseXml } from '@incudo/aurora-import';
import assert from 'node:assert/strict';

import { deriveCharacter, resolveCharacterKind, type Element, type ElementIndex } from '@incudo/core';
import { CharacterBuilder, newCharacterOfKind, sheetView } from '@incudo/ui';

import { runOracle } from './aurora-oracle.ts';
import { loadShippedSystem } from './node-system.ts';
import { corpusProvenance, corpusSkip, realElements, savesSkip } from './real-data.ts';
import { readManifest, samplePath } from './sample-saves.ts';

function tally(values: readonly string[], limit = 15): string {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  const sorted = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const shown = sorted.slice(0, limit).map(([v, n]) => `${n} ${v}`);
  if (sorted.length > limit) shown.push(`${sorted.length - limit} more`);
  return shown.join(', ') || 'none';
}

/** One attack row as Aurora wrote it in a save's `<attacks>`. */
export interface AuroraAttack {
  identifier: string;
  name: string;
  range: string;
  attack: string;
  damage: string;
  ability: string;
  description: string;
}

/** Aurora's own attack rows in a save, read here and not by the frozen importer (ADR 0008). */
export function auroraAttacks(xml: string): AuroraAttack[] {
  const attacks = findFirst(parseXml(xml), 'attacks');
  if (!attacks) return [];
  return childrenNamed(attacks, 'attack').map((node) => ({
    identifier: node.attrs['identifier'] ?? '',
    name: node.attrs['name'] ?? '',
    range: node.attrs['range'] ?? '',
    attack: node.attrs['attack'] ?? '',
    damage: node.attrs['damage'] ?? '',
    ability: node.attrs['ability'] ?? '',
    description: (childrenNamed(node, 'description')[0]?.text ?? '').trim(),
  }));
}

const weapons = (elements: ElementIndex): Element[] => [...elements.all()].filter((e) => e.type === 'Weapon');

test('weapons: what content states about each one', { skip: corpusSkip }, async (t) => {
  t.diagnostic(corpusProvenance());
  const elements = await realElements();
  const all = weapons(elements);
  t.diagnostic(`Weapon elements: ${all.length}, from ${tally(all.map((e) => e.source), 8)}`);
  const setters = all.flatMap((e) => Object.keys(e.setters));
  t.diagnostic(`  setters: ${tally(setters, 30)}`);
  const damage = all.filter((e) => e.setters['damage']);
  t.diagnostic(`  a damage setter: ${damage.length}; its type attribute: ${tally(damage.map((e) => e.setters['damage']!.attrs?.['type'] ?? '(none)'), 20)}`);
  t.diagnostic(`  damage values: ${tally(damage.map((e) => e.setters['damage']!.value), 20)}`);
  t.diagnostic(`  versatile values: ${tally(all.filter((e) => e.setters['versatile']).map((e) => e.setters['versatile']!.value))}`);
  t.diagnostic(`  slot values: ${tally(all.map((e) => e.setters['slot']?.value ?? '(none)'))}`);
  const proficiency = all.filter((e) => e.setters['proficiency']);
  const resolves = proficiency.filter((e) => elements.get(e.setters['proficiency']!.value.trim()));
  t.diagnostic(`  a proficiency setter: ${proficiency.length}, naming a declared element: ${resolves.length}; without one: ${tally(all.filter((e) => !e.setters['proficiency']).map((e) => e.name), 20)}`);
  t.diagnostic(`  a proficiency setter naming more than one id: ${proficiency.filter((e) => /[,|]/.test(e.setters['proficiency']!.value)).length}`);

  const tags = all.flatMap((e) => e.supports);
  const declared = tags.filter((tag) => elements.get(tag));
  t.diagnostic(`  support tags: ${tags.length}, ${new Set(tags).size} distinct; naming a declared element: ${declared.length} (${tally(declared.map((tag) => elements.get(tag)!.type))})`);
  const undeclared = [...new Set(tags.filter((tag) => !elements.get(tag)))];
  t.diagnostic(`  distinct tags naming nothing: ${undeclared.length}: ${tally(tags.filter((tag) => !elements.get(tag)), 60)}`);
  const category = (e: Element): string => e.supports.find((tag) => /WEAPON_CATEGORY_(SIMPLE|MARTIAL)_(MELEE|RANGED)/.test(tag)) ?? '(none)';
  t.diagnostic(`  by category tag: ${tally(all.map(category))}`);
  const ranged = all.filter((e) => /RANGED/.test(category(e)));
  t.diagnostic(`  ranged weapons with a range setter: ${ranged.filter((e) => e.setters['range']).length} of ${ranged.length}; melee weapons with one (thrown): ${all.filter((e) => /MELEE/.test(category(e)) && e.setters['range']).length}`);
  const finesse = all.filter((e) => e.supports.includes('ID_INTERNAL_WEAPON_PROPERTY_FINESSE'));
  t.diagnostic(`  finesse: ${finesse.length}; thrown: ${all.filter((e) => e.supports.includes('ID_INTERNAL_WEAPON_PROPERTY_THROWN')).length}; reach: ${all.filter((e) => e.supports.includes('ID_INTERNAL_WEAPON_PROPERTY_REACH')).length}`);
  t.diagnostic(`  rules on weapons: ${tally(all.flatMap((e) => e.rules.map((r) => (r.kind === 'stat' ? `stat ${r.name}` : r.kind))))}`);
  t.diagnostic(`  enhancement on a Weapon itself: ${all.filter((e) => e.setters['enhancement']).length}`);

  const adorners = [...elements.all()].filter((e) => e.type !== 'Weapon' && e.setters['weapon']);
  t.diagnostic(`elements naming a weapon they adorn (a "weapon" setter): ${adorners.length}, by type ${tally(adorners.map((e) => e.type))}`);
  t.diagnostic(`  with an enhancement: ${tally(adorners.filter((e) => e.setters['enhancement']).map((e) => e.setters['enhancement']!.value))}`);
  t.diagnostic(`  with rules: ${tally(adorners.flatMap((e) => e.rules.map((r) => (r.kind === 'stat' ? `stat ${r.name}` : r.kind))), 20)}`);
  t.diagnostic(`  a name-format: ${adorners.filter((e) => e.setters['name-format']).length}: ${tally(adorners.flatMap((e) => (e.setters['name-format'] ? [e.setters['name-format'].value] : [])), 6)}`);
  const enhancedItems = [...elements.all()].filter((e) => e.setters['enhancement']);
  t.diagnostic(`every element with an enhancement setter: ${enhancedItems.length}, by what it adorns ${tally(enhancedItems.map((e) => (e.setters['weapon'] ? 'weapon' : e.setters['armor'] ? 'armor' : e.type)))}`);
});

test('stats content writes about attacks and damage', { skip: corpusSkip }, async (t) => {
  const elements = await realElements();
  const writes = [...elements.all()].flatMap((e) =>
    e.rules.flatMap((r) => (r.kind === 'stat' && /attack|damage/.test(r.name) && !/type|immun|resist|vulnerab/.test(r.name) ? [{ e, r }] : [])),
  );
  t.diagnostic(`stat rules naming an attack or damage: ${writes.length} on ${new Set(writes.map((w) => w.e.id)).size} elements`);
  const shape = (name: string): string => {
    if (/^(melee|ranged|unarmed|weapon|thrown)(:| )/.test(name)) return 'a bonus for a kind of attack';
    if (name.startsWith('companion:')) return 'a held creature\'s';
    if (/spellcasting/.test(name)) return 'a casting block\'s';
    return 'a feature\'s own number';
  };
  const groups = new Map<string, typeof writes>();
  for (const w of writes) groups.set(shape(w.r.name), [...(groups.get(shape(w.r.name)) ?? []), w]);
  for (const [kind, group] of groups) {
    t.diagnostic(`  ${kind}: ${group.length}: ${tally(group.map((w) => `${w.r.name}${w.r.equipped ? ' (equipped=)' : ''}`), 12)}`);
  }
  // A stat named after a weapon (Bracers of Archery's `longbow:damage`) is a bonus for that weapon alone.
  const weaponNames = new Set(weapons(elements).map((e) => e.name.trim().toLowerCase()));
  const named = writes.filter((w) => weaponNames.has(w.r.name.split(':')[0]!));
  t.diagnostic(`  named after a weapon: ${named.length}: ${tally(named.map((w) => `${w.r.name} on ${w.e.type} "${w.e.name}"`))}`);
  const forKind = writes.filter((w) => shape(w.r.name) === 'a bonus for a kind of attack' || shape(w.r.name) === 'a held creature\'s');
  for (const { e, r } of forKind) t.diagnostic(`  ${r.name} ${JSON.stringify(r.value)} on ${e.type} "${e.name}" (${e.source})${r.requirements ? ' with requirements' : ''}${r.equipped ? ` equipped=${r.equipped}` : ''}`);
});

test('the samples: Aurora\'s attack rows beside the weapons equipped, and each bonus worked from the book', { skip: corpusSkip || savesSkip }, async (t) => {
  const elements = await realElements();
  const system = await loadShippedSystem('dnd5e');
  const kind = resolveCharacterKind(system, 'pc');
  let rows = 0;
  let agree = 0;
  for (const sample of readManifest().samples) {
    const file = samplePath(sample);
    const attacks = auroraAttacks(await readFile(file, 'utf8'));
    const run = await runOracle(file, elements, 'sample');
    const derived = deriveCharacter(run.imported.character, run.system, run.elements, { kind });
    const bagWeapons = (run.imported.character.inventory ?? []).filter((entry) => run.elements.get(entry.elementId)?.type === 'Weapon');
    const named = (entry: (typeof bagWeapons)[number]): string =>
      run.elements.get(entry.elementId)!.name + (entry.adorners?.length ? ` + ${entry.adorners.map((a) => run.elements.get(a.elementId)?.name).join(', ')}` : '');
    if (!attacks.length && !bagWeapons.length) continue;
    t.diagnostic(
      `${sample.id}: ${attacks.length} attack rows; weapons equipped: ${bagWeapons.filter((e) => e.equipped).map(named).join(', ') || 'none'}; ` +
        `carried: ${bagWeapons.filter((e) => !e.equipped).map(named).join(', ') || 'none'}; ` +
        `with no row: ${bagWeapons.filter((e) => !attacks.some((a) => a.identifier === e.instanceId)).map(named).join(', ') || 'none'}`,
    );
    const value = (key: string): number => derived.stats.get(key)?.value ?? 0;
    for (const attack of attacks) {
      rows++;
      const entry = (run.imported.character.inventory ?? []).find((e) => e.instanceId === attack.identifier);
      const weapon = entry ? run.elements.get(entry.elementId) : undefined;
      const ranged = weapon?.supports.some((tag) => /CATEGORY_.*_RANGED/.test(tag)) ?? false;
      const finesse = weapon?.supports.includes('ID_INTERNAL_WEAPON_PROPERTY_FINESSE') ?? false;
      const str = value('strength:modifier');
      const dex = value('dexterity:modifier');
      const ability = ranged ? dex : finesse ? Math.max(str, dex) : str;
      const proficient = weapon?.setters['proficiency'] ? derived.elementIds.has(weapon.setters['proficiency'].value.trim()) : false;
      const enhancement = (entry?.adorners ?? []).reduce((sum, a) => sum + Number(run.elements.get(a.elementId)?.setters['enhancement']?.value ?? 0), 0);
      const bonus = ability + (proficient ? value('proficiency') : 0) + enhancement + (ranged ? value('ranged:attack') : 0);
      const book = `${bonus >= 0 ? '+' : ''}${bonus} vs AC`;
      const damage = `${weapon?.setters['damage']?.value}+${ability + enhancement} ${weapon?.setters['damage']?.attrs?.['type']}`;
      const versatile = weapon?.setters['versatile'] ? `${weapon.setters['versatile'].value}+${ability + enhancement} ${weapon.setters['damage']?.attrs?.['type']}` : undefined;
      const same = attack.attack === book && (attack.damage === damage || attack.damage === versatile);
      if (same) agree++;
      t.diagnostic(
        `  ${attack.name} (${attack.ability}): Aurora ${attack.attack}, ${attack.damage}, range "${attack.range}", "${attack.description}"; ` +
          `the book ${book}, ${damage}${versatile ? ` or ${versatile}` : ''} (${ranged ? 'ranged' : 'melee'}${finesse ? ', finesse' : ''}, ${proficient ? 'proficient' : 'not proficient'}${enhancement ? `, +${enhancement}` : ''}${ranged && value('ranged:attack') ? `, ranged:attack ${value('ranged:attack')}` : ''})${same ? '' : ' DIFFERS'}`,
      );
    }
  }
  t.diagnostic(`attack rows: ${rows}; the book's bonus and damage agree with Aurora's on ${agree}`);
});

test('the official 2014 form\'s attack boxes', async (t) => {
  const map = JSON.parse(await readFile(new URL('../../../systems/dnd5e/forms/official-2014.json', import.meta.url), 'utf8')) as { fields: Record<string, string> };
  const boxes = Object.keys(map.fields).filter((name) => /^Wpn|Attacks/.test(name));
  t.diagnostic(`attack boxes: ${boxes.length}: ${boxes.map((b) => JSON.stringify(b)).join(', ')}`);
});

// --- Since ADR 0093: what 5e's declaration does, held against Aurora's own rows and through the builder. ---------

test('every weapon in a sample\'s bag is an attack on its sheet, and every row Aurora recorded agrees with it', { skip: corpusSkip || savesSkip }, async (t) => {
  const elements = await realElements();
  const system = await loadShippedSystem('dnd5e');
  const kind = resolveCharacterKind(system, 'pc');
  let compared = 0;
  const differ: string[] = [];
  for (const sample of readManifest().samples) {
    const file = samplePath(sample);
    const recorded = auroraAttacks(await readFile(file, 'utf8'));
    const run = await runOracle(file, elements, 'sample');
    const derived = deriveCharacter(run.imported.character, run.system, run.elements, { kind });
    const attacks = sheetView(derived, kind).sections.find((s) => s.id === 'attacks')?.attacks ?? [];
    // Aurora writes a row for every weapon in the bag, carried too; so does the sheet.
    const weapons = (run.imported.character.inventory ?? []).filter((e) => run.elements.get(e.elementId)?.type === 'Weapon').map((e) => e.instanceId);
    // And after them the rows no bag entry gives, which Aurora records none of: the kind's own (an unarmed strike, ADR
    // 0110) and the cantrips' (ADR 0111).
    assert.deepEqual(attacks.filter((a) => a.instanceId !== undefined).map((a) => a.instanceId), weapons, `${sample.id}: an attack per weapon in the bag, in bag order`);
    for (const row of recorded) {
      const attack = attacks.find((a) => a.instanceId === row.identifier);
      compared++;
      // Aurora writes "+6 vs AC" and one row per die; the sheet writes "+6" and the other die beside the first.
      const damages = attack ? [attack.damage, ...attack.alternatives.map((a) => a.damage)] : [];
      const properties = attack?.properties.join(', ') ?? '';
      if (!attack || `${attack.bonus} vs AC` !== row.attack || !damages.includes(row.damage) || properties !== row.description) {
        differ.push(`${sample.id} ${row.name}: Aurora ${row.attack}, ${row.damage}, "${row.description}"; the sheet ${attack ? `${attack.bonus}, ${damages.join(' or ')}, "${properties}"` : 'none'}`);
      }
    }
  }
  t.diagnostic(`Aurora's attack rows compared: ${compared}; differing: ${differ.length}`);
  for (const line of differ) t.diagnostic(`  ${line}`);
  // Fails if the ability, the proficiency term, ranged:attack or a property's name is dropped from the declaration (each
  // moves at least one of Aurora's eight rows), or if a carried weapon is left out (two of the rows are carried weapons).
  assert.ok(compared > 0, 'the samples record attack rows');
  assert.deepEqual(differ, []);
});

test("a Beast Master's companion shows what its ranger adds to its attack and damage rolls", { skip: corpusSkip }, async () => {
  // Built by name: the 2014 Human Ranger and its Beast Master archetype at level 3, its companion the first offered.
  const system = await loadShippedSystem('dnd5e');
  const elements = await realElements();
  const b = new CharacterBuilder(newCharacterOfKind(system, 'pc'), system, elements);
  const pick = (stepId: string, test: (e: Element) => boolean) => {
    const decision = b.getState().decisions.find((d) => d.stepId === stepId && d.kind === 'pick');
    const id = decision?.candidates.find((c) => test(elements.get(c)!));
    assert.ok(decision && id, `the ${stepId} step offers what is asked for`);
    b.choose(decision.id, [id]);
  };
  pick('race', (e) => e.name === 'Human' && e.source === 'Player’s Handbook');
  pick('class', (e) => e.name === 'Ranger' && e.source === 'Player’s Handbook');
  b.setProgress(3);
  const archetype = b.getState().decisions.find((d) => d.candidates.some((c) => elements.get(c)?.name === 'Beast Master'));
  assert.ok(archetype, 'the archetype is offered');
  b.choose(archetype.id, [archetype.candidates.find((c) => elements.get(c)?.name === 'Beast Master')!]);
  const beast = b.getState().decisions.find((d) => d.candidates.some((c) => elements.get(c)?.type === 'Companion'));
  assert.ok(beast, 'a companion is offered');
  b.choose(beast.id, [beast.candidates[0]!]);
  const state = b.getState();
  const creature = state.companions?.creatures[0];
  assert.ok(creature, 'the ranger holds a creature');
  const holder = creature.sections.find((s) => s.section === 'holder');
  // Fails if the section is removed from the scope's sheet, or its stats lose their labels (rows called by their keys).
  assert.deepEqual(holder?.rows.map((r) => [r.label, r.value]), [
    ['Attack Rolls', '+2'],
    ['Damage Rolls', '+2'],
  ]);
  // Each action says where those apply (ADR 0112). Fails if the Actions section's elementNote is removed.
  const actions = creature.sections.find((s) => s.section === 'actions')?.elements ?? [];
  assert.ok(actions.length > 0, 'the beast has actions');
  for (const action of actions) {
    assert.equal(action.note, 'If it is an attack, its holder adds 2 to the attack roll and 2 to the damage.', action.name);
  }
  // A ranger with no weapon attacks unarmed and with nothing else (ADR 0110); no weapon is invented.
  assert.deepEqual(state.sheet.sections.find((s) => s.id === 'attacks')?.attacks?.map((a) => a.name), ['Unarmed Strike']);
});

// --- ADR 0110: an unarmed strike, an off-hand row and a melee weapon's reach, on the real corpus ---------------------

/** A character built by name through the builder: a race and a class of one book, a level, scores, and what it takes. */
async function built(book: string, className: string, level: number, scores: Record<string, number>) {
  const system = await loadShippedSystem('dnd5e');
  const elements = await realElements();
  const b = new CharacterBuilder(newCharacterOfKind(system, 'pc'), system, elements);
  const pick = (stepId: string, test: (e: Element) => boolean) => {
    const decision = b.getState().decisions.find((d) => d.stepId === stepId && d.kind === 'pick');
    const id = decision?.candidates.find((c) => test(elements.get(c)!));
    assert.ok(decision && id, `the ${stepId} step offers what is asked for`);
    b.choose(decision.id, [id]);
  };
  pick('race', (e) => e.name === 'Human' && e.source.startsWith('Player’s Handbook'));
  pick('class', (e) => e.name === className && e.source === book);
  b.setProgress(level);
  for (const [stat, value] of Object.entries(scores)) b.setBaseStat(stat, value);
  const answer = (name: string) => {
    const decision = b.getState().decisions.find((d) => d.candidates.some((c) => elements.get(c)?.name === name));
    assert.ok(decision, `${name} is offered`);
    b.choose(decision.id, [...decision.chosen, decision.candidates.find((c) => elements.get(c)?.name === name)!]);
  };
  const wield = (name: string, from = 'Player’s Handbook') => {
    const weapon = elements.byType('Weapon').find((e) => e.name === name && e.source === from)!;
    b.addItem(weapon.id);
    const entry = b.getState().character.inventory!.at(-1)!;
    assert.equal(b.equipItem(entry.instanceId, true), undefined, `${name} is equipped`);
  };
  const attacks = () => b.getState().sheet.sections.find((s) => s.id === 'attacks')?.attacks ?? [];
  return { answer, wield, attacks };
}

test('an unarmed strike: Strength and 1 for anyone, the Martial Arts die and the better ability for a Monk', { skip: corpusSkip }, async () => {
  // Fails if the innate row is not declared, if Martial Arts' die or Dexterity is not read, or if a die replaces the 1.
  const fighter = await built('Player’s Handbook', 'Fighter', 1, { strength: 16, dexterity: 10 });
  const unarmed = (rows: ReturnType<typeof fighter.attacks>) => rows.find((a) => a.innate);
  assert.deepEqual(
    [unarmed(fighter.attacks())?.name, unarmed(fighter.attacks())?.bonus, unarmed(fighter.attacks())?.damage],
    ['Unarmed Strike', '+5', '4 bludgeoning'],
  );
  const monk = await built('Player’s Handbook', 'Monk', 5, { strength: 10, dexterity: 16 });
  assert.deepEqual([unarmed(monk.attacks())?.bonus, unarmed(monk.attacks())?.damage], ['+6', '1d6+3 bludgeoning'], 'a 2014 Monk 5: d6, Dexterity');
  const monk24 = await built('Player’s Handbook (2024)', 'Monk', 1, { strength: 10, dexterity: 16 });
  assert.deepEqual([unarmed(monk24.attacks())?.bonus, unarmed(monk24.attacks())?.damage], ['+5', '1d6+3 bludgeoning'], 'a 2024 Monk 1: d6');
});

test('two Light weapons in hand each show an off-hand row, its ability added only with the style', { skip: corpusSkip }, async () => {
  // Fails if slots do not publish support tags, if the variant is not declared, or if the style is not read.
  const rogue = await built('Player’s Handbook', 'Rogue', 1, { strength: 10, dexterity: 16 });
  rogue.wield('Shortsword');
  assert.deepEqual(rogue.attacks().find((a) => a.name === 'Shortsword')?.alternatives, [], 'one Light weapon held');
  rogue.wield('Shortsword');
  const swords = rogue.attacks().filter((a) => a.name === 'Shortsword');
  assert.equal(swords.length, 2);
  for (const sword of swords) {
    assert.equal(sword.damage, '1d6+3 piercing');
    assert.deepEqual(sword.alternatives, [{ label: 'off-hand', damage: '1d6 piercing' }]);
  }
  const fighter = await built('Player’s Handbook', 'Fighter', 1, { strength: 10, dexterity: 16 });
  fighter.answer('Two-Weapon Fighting');
  fighter.wield('Shortsword');
  fighter.wield('Scimitar');
  assert.deepEqual(fighter.attacks().find((a) => a.name === 'Scimitar')?.alternatives, [{ label: 'off-hand', damage: '1d6+3 slashing' }]);
});

test('a melee weapon writing no range shows its reach, 5 ft or 10 ft with Reach; one writing a range keeps it', { skip: corpusSkip }, async () => {
  // Fails if `reach` is not declared, or if it overrides a range the weapon writes.
  const fighter = await built('Player’s Handbook', 'Fighter', 1, { strength: 16 });
  // The 2014 Reach weapons write "10 ft" themselves; the 2024 ones write none, and the rule gives it.
  for (const name of ['Glaive', 'Longsword', 'Longbow']) fighter.wield(name);
  fighter.wield('Pike', 'Player’s Handbook (2024)');
  const range = (name: string) => fighter.attacks().find((a) => a.name === name)?.range;
  assert.deepEqual([range('Glaive'), range('Pike'), range('Longsword'), range('Longbow')], ['10 ft', '10 ft', '5 ft', '150/600']);
});
