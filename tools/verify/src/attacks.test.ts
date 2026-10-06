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
import { deriveCharacter, resolveCharacterKind, type Element, type ElementIndex } from '@incudo/core';

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
  for (const [kind, group] of Map.groupBy(writes, (w) => shape(w.r.name))) {
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
