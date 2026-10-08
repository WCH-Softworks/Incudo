/**
 * What an inventory editor would offer and edit, measured before building it — ADR 0098.
 *
 * From content alone: the item types and how many of each, which of them the equip steps already offer (ADR 0072, ADR
 * 0089) and which are hidden, how items are priced (unit, fractions, no price), which magic items are made from another
 * item (an adorner: a `type` setter naming an item type, a filter setter of that name, a `name-format` reading
 * `{{parent}}`) and how many hosts each one's filter admits, what needs attunement, which slots items name, and what the
 * `<extract>` blocks list. Then the thirty samples: what their bags record that an editor must keep (names, notes,
 * quantities, adornments, attunement) and, for each entry, whether it gives the character anything.
 *
 * Everything is reported as `ℹ` lines and nothing is asserted (ADR 0042). Items are found by type and setter, never by id.
 */

import { test } from 'node:test';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import {
  matchesSupports,
  parseSupports,
  resolveCharacterKind,
  type Element,
  type ElementIndex,
} from '@incudo/core';

import { runOracle } from './aurora-oracle.ts';
import { loadShippedSystem } from './node-system.ts';
import { corpusProvenance, corpusSkip, realElements, requireCorpus, savesSkip } from './real-data.ts';
import { readManifest, samplePath } from './sample-saves.ts';

function tally(values: string[]): string {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([v, n]) => `${n} ${v}`).join(', ') || 'none';
}

function setter(element: Element, name: string) {
  return Object.entries(element.setters).find(([key]) => key.toLowerCase() === name)?.[1];
}

/**
 * Whether an element answers a filter written in content's supports language, as a pick's candidate does, and, with
 * `byName`, by its own name too: an adorner's filter names hosts ("Plate", "Longsword"), which no tag carries.
 */
function admits(filter: string, element: Element, byName = false): boolean {
  return matchesSupports(parseSupports(filter), {
    tags: new Set([...element.supports.map((s) => s.toLowerCase()), ...(byName ? [element.name.trim().toLowerCase()] : [])]),
    setterValues: new Set(Object.values(element.setters).map((s) => s.value.trim().toLowerCase())),
    id: element.id,
    resolve: () => undefined,
  });
}

async function setting() {
  const system = await loadShippedSystem('dnd5e');
  const pc = resolveCharacterKind(system, 'pc');
  const itemTypes = pc.buildSteps.find((step) => step.id === 'equipment')!.types;
  const equipSteps = pc.buildSteps.filter((step) => step.equip);
  return { system, pc, itemTypes, equipSteps };
}

function itemsOf(index: ElementIndex, types: readonly string[]): Element[] {
  return types.flatMap((type) => index.byType(type));
}

test('what an inventory editor would offer', { skip: corpusSkip }, async (t) => {
  t.diagnostic(corpusProvenance());
  const index = await realElements();
  const { pc, itemTypes, equipSteps } = await setting();
  const items = itemsOf(index, itemTypes);
  t.diagnostic(`item types ${itemTypes.join(', ')}: ${items.length} elements; ${tally(items.map((e) => e.type))}`);

  // The families the equip steps offer, by their own setter and values.
  const byStep = (e: Element) =>
    equipSteps.find((step) => {
      const value = setter(e, step.equip!.setter.toLowerCase())?.value.trim().toLowerCase();
      return step.types.includes(e.type) && value !== undefined && step.equip!.values.some((v) => v.toLowerCase() === value);
    });
  const stepped = items.filter((e) => byStep(e));
  t.diagnostic(`offered by an equip step: ${stepped.length} (${tally(stepped.map((e) => byStep(e)!.id))})`);

  const hiddenSetter = pc.inventory!.hiddenSetter!.toLowerCase();
  const hidden = items.filter((e) => setter(e, hiddenSetter)?.value.trim().toLowerCase() === 'true');
  const hiddenLeft = hidden.filter((e) => !byStep(e));
  t.diagnostic(`hidden: ${hidden.length}; not an equip step's: ${hiddenLeft.length}, categories ${tally(hiddenLeft.map((e) => setter(e, 'category')?.value ?? '(none)'))}`);
  const withRules = hiddenLeft.filter((e) => e.rules.length).length;
  const priced = hiddenLeft.filter((e) => Number(setter(e, 'cost')?.value) > 0).length;
  t.diagnostic(`  of those: ${withRules} carry rules, ${priced} have a price above 0`);

  // How items are priced.
  const offered = items.filter((e) => !byStep(e));
  const costs = offered.map((e) => setter(e, 'cost'));
  t.diagnostic(`offered by the editor: ${offered.length}`);
  t.diagnostic(`  price unit: ${tally(costs.map((c) => (c ? (c.attrs?.['currency'] ?? '(no unit)') : '(no cost)')))}`);
  const values = costs.filter((c) => c !== undefined).map((c) => c!.value.trim());
  t.diagnostic(`  price value: ${tally(values.map((v) => (v === '' ? 'empty' : !Number.isFinite(Number(v)) ? 'not a number' : Number(v) === 0 ? '0' : Number.isInteger(Number(v)) ? 'whole' : 'fraction')))}`);
  const odd = [...new Set(values.filter((v) => v !== '' && (!Number.isFinite(Number(v)) || !Number.isInteger(Number(v)))))];
  t.diagnostic(`  the values that are not whole: ${odd.slice(0, 20).join(' | ') || 'none'}`);
  const unitless = offered.filter((e) => setter(e, 'cost') && !setter(e, 'cost')!.attrs?.['currency']);
  t.diagnostic(`  no unit, by value: ${tally(unitless.map((e) => setter(e, 'cost')!.value.trim() || 'empty'))}; by type ${tally(unitless.map((e) => e.type))}`);
  const unpriced = offered.filter((e) => !setter(e, 'cost'));
  t.diagnostic(`  no price, by type: ${tally(unpriced.map((e) => e.type))}; by category ${tally(unpriced.map((e) => setter(e, 'category')?.value ?? '(none)')).split(', ').slice(0, 12).join(', ')}`);

  // Slots: what an item says it goes in, against what the kind declares.
  const slotIds = new Set(pc.inventory!.slots.map((s) => s.id));
  const slots = offered.map((e) => setter(e, 'slot')?.value.trim());
  t.diagnostic(`  slot: ${tally(slots.map((s) => (s === undefined ? '(none)' : slotIds.has(s) ? s : `undeclared ${s}`)))}`);

  // Attunement.
  const attunement = pc.inventory!.attunement!;
  const attunes = offered.filter((e) => setter(e, attunement.setter.toLowerCase())?.value.trim().toLowerCase() === attunement.requires);
  t.diagnostic(`  require attunement: ${attunes.length} (${tally(attunes.map((e) => e.type))})`);

  // Stackable: a quantity Aurora writes beside an item.
  t.diagnostic(`  setters naming a stack: ${tally(offered.flatMap((e) => Object.keys(e.setters).filter((k) => /stack|bundle|amount|quantity/i.test(k))))}`);
});

test('which magic items are made from another item, and how many hosts each admits', { skip: corpusSkip }, async (t) => {
  const index = await realElements();
  const { itemTypes } = await setting();
  const items = itemsOf(index, itemTypes);
  const typeNames = new Set(itemTypes.map((type) => type.toLowerCase()));
  const made = items.filter((e) => typeNames.has(setter(e, 'type')?.value.trim().toLowerCase() ?? ''));
  t.diagnostic(`a "type" setter naming an item type: ${made.length}; ${tally(made.map((e) => `${e.type} of ${setter(e, 'type')!.value.trim()}`))}`);
  const filtered = made.filter((e) => setter(e, setter(e, 'type')!.value.trim().toLowerCase()) !== undefined);
  t.diagnostic(`  with a filter setter of that name: ${filtered.length}`);
  const parent = made.filter((e) => /\{\{parent\}\}/.test(setter(e, 'name-format')?.value ?? ''));
  t.diagnostic(`  with a name-format reading {{parent}}: ${parent.length}`);
  const other = items.filter((e) => !made.includes(e) && /\{\{parent\}\}/.test(setter(e, 'name-format')?.value ?? ''));
  t.diagnostic(`  {{parent}} on an item with no such type: ${other.length}`);

  const hostsOf = (e: Element, byName = true) => {
    const hostType = setter(e, 'type')!.value.trim();
    const filter = setter(e, hostType.toLowerCase())?.value ?? '';
    return index.byType(hostType).filter((host) => !made.includes(host) && (filter.trim() === '' || admits(filter, host, byName)));
  };
  const bucket = (n: number) => (n === 0 ? '0' : n < 10 ? '1-9' : n < 50 ? '10-49' : '50+');
  t.diagnostic(`  hosts admitted per filter, by tag, id and setter only: ${tally(filtered.map((e) => bucket(hostsOf(e, false).length)))}`);
  t.diagnostic(`  hosts admitted per filter, the host's name too: ${tally(filtered.map((e) => bucket(hostsOf(e).length)))}`);
  const unfiltered = made.filter((e) => !filtered.includes(e));
  t.diagnostic(`  with no filter setter, hosts of the type: ${tally(unfiltered.map((e) => bucket(index.byType(setter(e, 'type')!.value.trim()).filter((h) => !made.includes(h)).length)))}`);
  const none = filtered.filter((e) => hostsOf(e).length === 0);
  t.diagnostic(`  admitting none: ${none.slice(0, 15).map((e) => `${e.name} [${setter(e, setter(e, 'type')!.value.trim().toLowerCase())!.value}]`).join('; ')}`);
  const filters = tally(filtered.map((e) => setter(e, setter(e, 'type')!.value.trim().toLowerCase())!.value.trim()));
  t.diagnostic(`  filters, most common: ${filters.split(', ').slice(0, 12).join(', ')}`);
  const attunes = made.filter((e) => setter(e, 'attunement')?.value.trim().toLowerCase() === 'true').length;
  t.diagnostic(`  of them requiring attunement: ${attunes}`);
});

test('what <extract> lists, as an editor would open it', { skip: corpusSkip }, async (t) => {
  const location = requireCorpus();
  const root = location.root ?? dirname(location.index);
  const index = await realElements();
  const files: string[] = [];
  const walk = async (dir: string) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.name.endsWith('.xml')) files.push(path);
    }
  };
  await walk(root);
  let blocks = 0;
  const lines: string[] = [];
  const children: string[] = [];
  for (const file of files) {
    const xml = (await readFile(file, 'utf8')).replace(/<!--[\s\S]*?-->/g, '');
    for (const m of xml.matchAll(/<extract>([\s\S]*?)<\/extract>/g)) {
      blocks++;
      for (const c of m[1]!.matchAll(/<(\w+)([^>]*)>([^<]*)<\/\1>/g)) {
        children.push(`<${c[1]}${c[2]!.includes('amount=') ? ' amount' : ''}>`);
        if (c[1] !== 'item') continue;
        const id = c[3]!.trim();
        lines.push(index.get(id) ? 'declared' : 'declared by nothing');
      }
      const other = m[1]!.replace(/<(\w+)([^>]*)>([^<]*)<\/\1>/g, '').trim();
      if (other) children.push(`other: ${other.slice(0, 40)}`);
    }
  }
  t.diagnostic(`<extract> blocks: ${blocks}; children ${tally(children)}; ids ${tally(lines)}`);
});

test('what the samples\' bags record, and what each entry gives the character', { skip: savesSkip || corpusSkip }, async (t) => {
  const corpus = await realElements();
  const manifest = readManifest();
  const { pc, itemTypes, equipSteps } = await setting();
  const labelled = new Set((pc.stats ?? []).filter((s) => s.label).map((s) => s.name.toLowerCase()));
  const recorded: string[] = [];
  const gives: string[] = [];
  const moved: string[] = [];
  const heldNotInBag: string[] = [];
  for (const sample of manifest.samples) {
    const run = await runOracle(samplePath(sample), corpus, 'aurora');
    const { derived, elements } = run;
    // An item the character holds that no bag entry names: what a sheet listing the bag instead would lose.
    const named = new Set((run.imported.character.inventory ?? []).flatMap((e) => [e.elementId, ...(e.adorners ?? []).map((a) => a.elementId)]));
    for (const e of derived.elements) if (itemTypes.includes(e.type) && !named.has(e.id)) heldNotInBag.push(e.name);
    for (const entry of run.imported.character.inventory ?? []) {
      if (entry.name) recorded.push('a name');
      if (entry.notes) recorded.push('notes');
      if ((entry.quantity ?? 1) > 1) recorded.push('a quantity');
      if (entry.adorners?.length) recorded.push('an adornment');
      if (entry.attuned) recorded.push('attuned');
      if (entry.slot) recorded.push('a slot override');
      recorded.push(entry.equipped ? 'equipped' : 'carried');
      const element = elements.get(entry.elementId);
      if (element && equipSteps.some((step) => step.types.includes(element.type) && step.equip!.values.some((v) => v.toLowerCase() === setter(element, step.equip!.setter.toLowerCase())?.value.trim().toLowerCase()))) recorded.push("an equip step's");
      // What it gives: a stat it contributes to, or an element it grants that the character holds.
      const ids = [entry.elementId, ...(entry.adorners ?? []).map((a) => a.elementId)];
      const moves = [...derived.stats.values()].filter((s) => s.contributions.some((c) => c.value !== 0 && ids.includes(c.from)));
      const granted = ids.flatMap((id) => elements.get(id)?.rules ?? []).filter((r) => r.kind === 'grant' && derived.elementIds.has(r.id));
      for (const stat of moves) moved.push(labelled.has(stat.name) ? 'a labelled stat' : 'an unlabelled stat');
      const attack = derived.attacks.some((a) => a.instanceId === entry.instanceId);
      const suppressed = ids.some((id) => derived.equipment.suppressed.has(id));
      gives.push(
        !entry.equipped
          ? attack ? 'carried, an attack' : 'carried'
          : suppressed
            ? 'equipped, not attuned'
            : moves.length || granted.length
              ? `equipped, gives (${moves.length ? 'stats' : ''}${moves.length && granted.length ? '+' : ''}${granted.length ? 'elements' : ''})`
              : attack ? 'equipped, an attack only' : 'equipped, gives nothing',
      );
    }
  }
  t.diagnostic(`sample bag entries: ${tally(recorded)}`);
  t.diagnostic(`what each gives: ${tally(gives)}`);
  t.diagnostic(`  the stats they move: ${tally(moved)}`);
  t.diagnostic(`held items no bag entry names: ${heldNotInBag.length} (${tally(heldNotInBag)})`);
});
