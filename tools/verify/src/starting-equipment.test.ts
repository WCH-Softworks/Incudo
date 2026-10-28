/**
 * 5e's starting equipment as the converter writes it from the official corpus — ADR 0087, ADR 0119 decision 9.
 *
 * The packages are read from content's prose by the converter, onto each class and background, and this is what holds
 * them to the rest of content: they fit the shipped system, every id they name is one the corpus declares, every
 * filtered pick offers something, and each 2024 package agrees with the pack item the 2024 book itself ships for that
 * class or background (an `<extract>` block listing the package's contents, which this test reads from the XML). What
 * is pending (a line matched to no item) and what has no package is reported, not asserted.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { resolveCharacterKind } from '@incudo/core';
import { pickCandidates, startingEquipmentFits, startingEquipmentFor, type StartingBundle, type StartingEquipmentFile } from '@incudo/ui';

import { loadShippedSystem } from './node-system.ts';
import { corpusProvenance, corpusSkip, realElements, requireCorpus } from './real-data.ts';

/** What a player character is offered, assembled from the converted corpus as the builder assembles it. */
async function convertedFile(): Promise<StartingEquipmentFile> {
  const system = await loadShippedSystem('dnd5e');
  const kind = resolveCharacterKind(system, 'pc');
  const file = startingEquipmentFor(system, kind, kind.buildSteps, await realElements());
  assert.ok(file, 'the converted packages fit the 5e system');
  return file;
}

function bundlesOf(file: StartingEquipmentFile): Array<{ forId: string; option: string; bundle: StartingBundle }> {
  return file.packages.flatMap((entry) =>
    entry.options.flatMap((option) =>
      (option.lines ?? []).flatMap((line) => ('choose' in line ? line.choose : [line]).map((bundle) => ({ forId: entry.for, option: option.id, bundle }))),
    ),
  );
}

test('the converted packages fit the 5e system', { skip: corpusSkip }, async (t) => {
  // Fails if the converter writes a unit the system does not declare: the builder would then offer no package at all.
  t.diagnostic(corpusProvenance());
  const file = await convertedFile();
  assert.deepEqual(startingEquipmentFits(file, await loadShippedSystem('dnd5e')), []);
  const pending = bundlesOf(file).flatMap(({ bundle }) => bundle.pending ?? []);
  t.diagnostic(`packages: ${file.packages.length}; pending lines: ${pending.length}`);
});

test('every id the file names is one the corpus declares, and every filtered pick offers something', { skip: corpusSkip }, async (t) => {
  t.diagnostic(corpusProvenance());
  const index = await realElements();
  const file = await convertedFile();
  const named = new Set<string>();
  for (const entry of file.packages) named.add(entry.for);
  for (const { bundle } of bundlesOf(file)) {
    for (const item of bundle.items ?? []) named.add(item.id);
    for (const pick of bundle.picks ?? []) for (const id of pick.from ?? []) named.add(id);
  }
  const unknown = [...named].filter((id) => !index.get(id)).sort();
  t.diagnostic(`ids named: ${named.size}; declared by nothing: ${unknown.length ? unknown.join(', ') : 'none'}`);
  assert.deepEqual(unknown, []);

  // A class entry is for a class and a background entry for a background: a typo between the two would offer nothing.
  const types = new Map<string, number>();
  for (const entry of file.packages) types.set(index.get(entry.for)!.type, (types.get(index.get(entry.for)!.type) ?? 0) + 1);
  t.diagnostic(`entries: ${[...types].map(([type, n]) => `${n} ${type}`).join(', ')}`);
  assert.deepEqual([...types.keys()].sort(), ['Background', 'Class']);

  const empty: string[] = [];
  const sizes: string[] = [];
  for (const { forId, bundle } of bundlesOf(file)) {
    for (const pick of bundle.picks ?? []) {
      const n = pickCandidates(pick, index).length;
      if (!pick.from) sizes.push(`${pick.label} ${n}`);
      if (n === 0) empty.push(`${forId}: ${pick.label}`);
    }
  }
  t.diagnostic(`filtered picks offer: ${[...new Set(sizes)].join(', ')}`);
  assert.deepEqual(empty, []);

  // Reported: what the corpus has that no package is read for, by book.
  for (const type of ['Class', 'Background']) {
    const covered = new Set(file.packages.map((p) => p.for));
    const left = index.byType(type).filter((e) => !covered.has(e.id));
    const books = new Map<string, number>();
    for (const e of left) books.set(e.source, (books.get(e.source) ?? 0) + 1);
    t.diagnostic(`${type} not covered: ${left.length} (${[...books].sort((a, b) => b[1] - a[1]).map(([b, n]) => `${n} ${b}`).join(', ')})`);
  }
});

async function xmlFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const path = join(root, entry.name);
    if (entry.isDirectory()) out.push(...(await xmlFiles(path)));
    else if (entry.name.endsWith('.xml')) out.push(path);
  }
  return out;
}

test('each 2024 package holds what the book\'s own pack item for it extracts to', { skip: corpusSkip }, async (t) => {
  // Fails if a package leaves out, or misnames, an item the 2024 book's "Class Equipment Pack (Fighter, Option A)" and
  // its siblings list in their <extract> block. A pack excludes the armour and the coins, which the package carries too.
  const index = await realElements();
  const file = await convertedFile();
  const location = requireCorpus();
  const packs: Array<{ owner: string; option: string; items: string[] }> = [];
  for (const path of await xmlFiles(location.root ?? dirname(location.index))) {
    const xml = (await readFile(path, 'utf8')).replace(/<!--[\s\S]*?-->/g, '');
    for (const m of xml.matchAll(/<element name="(?:Class|Background) Equipment Pack \(([^,)]+)(?:, Option ([A-Z]))?\)"[\s\S]*?<\/element>/g)) {
      const items = [...m[0].matchAll(/<item(?: amount="(\d+)")?>([^<]+)<\/item>/g)].map((i) => i[2]!.trim());
      packs.push({ owner: m[1]!.trim(), option: (m[2] ?? 'A').toLowerCase(), items });
    }
  }
  t.diagnostic(`pack items with an <extract>: ${packs.length}`);
  const disagree: string[] = [];
  const dangling: string[] = [];
  let compared = 0;
  for (const pack of packs) {
    const entry = file.packages.find((p) => {
      const e = index.get(p.for);
      return e?.name === pack.owner && e.source.includes('2024');
    });
    const option = entry?.options.find((o) => o.id === pack.option);
    if (!entry || !option) {
      disagree.push(`${pack.owner} option ${pack.option}: no package in the file`);
      continue;
    }
    const offered = new Set<string>();
    for (const line of option.lines ?? []) {
      for (const bundle of 'choose' in line ? line.choose : [line]) {
        for (const item of bundle.items ?? []) offered.add(item.id);
        for (const pick of bundle.picks ?? []) for (const id of pickCandidates(pick, index)) offered.add(id);
      }
    }
    for (const id of pack.items) {
      if (!index.get(id)) dangling.push(`${pack.owner} ${pack.option.toUpperCase()}: ${id}`);
      else if (!offered.has(id)) disagree.push(`${pack.owner} ${pack.option.toUpperCase()}: ${id}`);
      else compared += 1;
    }
  }
  t.diagnostic(`items compared: ${compared}; named by a pack and declared by nothing (upstream): ${dangling.join(', ') || 'none'}`);
  // The one known difference: the 2024 Wizard's prose says "Spellbook", which the 2024 book declares no item for, and
  // its pack lists a plain Book. The converter takes the 2014 Spellbook, the item the prose names.
  assert.deepEqual(disagree, ['Wizard A: ID_WOTC_PHB24_ITEM_BOOK']);
});
