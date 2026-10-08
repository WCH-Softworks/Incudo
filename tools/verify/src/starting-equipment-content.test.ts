/**
 * Starting equipment and money, read from content and the samples before building the step — ADR 0087.
 *
 * Reported, from content alone: how each class and background describes its starting equipment (a 2014 list of (a) /
 * (b) lines, a 2024 "Choose A or B" row, a background's "Equipment:" line), whether any rule of theirs gives or offers an
 * item, how items state their price, and the `<extract>` blocks that list what a pack holds, which the parser does not
 * read. Then the thirty samples: what their `<currency>` records.
 *
 * Everything is reported as `ℹ` lines and nothing is asserted (ADR 0042). Classes and backgrounds are found by type, the
 * edition by the shape of the prose, never by an id.
 */

import { test } from 'node:test';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { parseAuroraSave } from '@incudo/aurora-import';
import type { Element } from '@incudo/core';

import { corpusProvenance, corpusSkip, realElements, requireCorpus, savesSkip } from './real-data.ts';
import { readManifest, samplePath } from './sample-saves.ts';

const ITEM_TYPES = ['Item', 'Weapon', 'Armor', 'Magic Item'];

function text(element: Element): string {
  return (element.description ?? '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
}

function tally(values: string[]): string {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([v, n]) => `${n} ${v}`).join(', ') || 'none';
}

/** How a description states starting equipment, by its shape. */
function shapeOf(prose: string): string {
  if (/You start with the following equipment/i.test(prose)) return 'lines of (a)/(b)';
  const row = prose.match(/Choose (A(?:, B)*,? (?:or|and) [A-Z])\b/);
  if (row) return `"Choose ${row[1]}"`;
  if (/Equipment: /.test(prose)) return '"Equipment:" list';
  if (/equipment/i.test(prose)) return 'mentions equipment only';
  return 'none';
}

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

test('how content states starting equipment', { skip: corpusSkip }, async (t) => {
  t.diagnostic(corpusProvenance());
  const index = await realElements();
  const itemIds = new Set(ITEM_TYPES.flatMap((type) => index.byType(type).map((e) => e.id)));

  for (const type of ['Class', 'Background']) {
    const elements = index.byType(type);
    const shapes = elements.map((e) => shapeOf(text(e)));
    t.diagnostic(`${type}: ${elements.length} elements; equipment written as ${tally(shapes)}`);
    // Which books write each shape: the edition shows in the shape, not in an id.
    for (const shape of [...new Set(shapes)].sort()) {
      const books = elements.filter((e) => shapeOf(text(e)) === shape).map((e) => e.source);
      t.diagnostic(`  ${shape}: ${tally(books)}`);
    }
    // A rule of theirs that gives or offers an item would be content stating the package.
    const itemRules = elements.flatMap((e) =>
      e.rules.filter((rule) => (rule.kind === 'grant' && itemIds.has(rule.id)) || (rule.kind === 'select' && ITEM_TYPES.includes(rule.type))),
    );
    t.diagnostic(`  rules granting or selecting an item: ${itemRules.length}`);
    const gold = elements.filter((e) => /\(B\) \d+ GP|\(C\) \d+ GP/.test(text(e))).length;
    t.diagnostic(`  rows whose last option is gold alone: ${gold}`);
  }

  // How items are priced: the unit content writes beside a cost is the unit a purse must be counted in.
  const costs = [...itemIds].map((id) => index.get(id)!).map((e) => {
    const cost = Object.entries(e.setters).find(([name]) => name.toLowerCase() === 'cost')?.[1];
    return cost ? (cost.attrs?.['currency'] ?? '(no unit)') : '(no cost)';
  });
  t.diagnostic(`items: ${itemIds.size}; priced in ${tally(costs)}`);
});

test('what a pack holds is written in an <extract> block, which the parser does not read', { skip: corpusSkip }, async (t) => {
  const location = requireCorpus();
  const files = await xmlFiles(location.root ?? dirname(location.index));
  let blocks = 0;
  const where: string[] = [];
  const names: string[] = [];
  for (const file of files) {
    const xml = await readFile(file, 'utf8');
    const live = xml.replace(/<!--[\s\S]*?-->/g, '');
    const found = live.match(/<extract>/g)?.length ?? 0;
    if (!found) continue;
    blocks += found;
    where.push(`${found} in ${file.slice((location.root ?? dirname(location.index)).length + 1).replace(/\\/g, '/')}`);
    for (const m of live.matchAll(/<element name="([^"]+)"[^>]*>(?:(?!<\/element>)[\s\S])*?<extract>/g)) names.push(m[1]!.replace(/\(.*\)/, '(…)'));
  }
  t.diagnostic(`<extract> blocks: ${blocks}, ${where.join('; ')}`);
  t.diagnostic(`  on: ${tally(names)}`);
});

test('what the samples record of money', { skip: savesSkip }, async (t) => {
  const manifest = await readManifest();
  const counts: string[] = [];
  for (const entry of manifest.samples) {
    const save = parseAuroraSave(await readFile(samplePath(entry), 'utf8'));
    for (const unit of ['copper', 'silver', 'electrum', 'gold', 'platinum']) {
      const value = save.input[`currency.${unit}`];
      counts.push(`${unit} ${value === undefined ? 'absent' : Number(value) === 0 ? '0' : 'non-zero'}`);
    }
  }
  t.diagnostic(`samples: ${manifest.samples.length}; currency counts: ${tally(counts)}`);
});
