/**
 * Starting equipment read out of the corpus's prose by the converter — ADR 0119 decision 9's measurement.
 *
 * Decision 9: a pattern is codified only where it rescues a good share of what a plain lookup misses, a generic line is
 * a pick, and the rest is a pending item. This measures that against the answer key there was: the file ADR 0087 wrote
 * by hand (`git show <commit>:systems/dnd5e/starting-equipment.json`, kept here as `fixtures/starting-equipment-key.json`
 * since the file left the system). For every class and background both cover, the items the key names and the parser
 * found, the ones it left pending, and what it reads that the key does not have. Reported (ADR 0042), and two things
 * asserted: every class and background stating starting equipment in a shape the parser reads gives a package, and at
 * least 85 in a hundred of the key's items are found (86 when measured).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { ItemNames, patternRescues, readStartingEquipment } from '@incudo/aurora-import';
import type { StartingBundle, StartingLine, StartingOption } from '@incudo/core';

import { repoRoot } from './node-system.ts';
import { corpusProvenance, corpusSkip, realElements } from './real-data.ts';

interface Key {
  packages: Array<{ for: string; options: StartingOption[] }>;
}

function bundles(options: StartingOption[] | undefined): StartingBundle[] {
  const out: StartingBundle[] = [];
  const line = (l: StartingLine) => ('choose' in l ? out.push(...l.choose) : out.push(l));
  for (const option of options ?? []) for (const l of option.lines ?? []) line(l);
  return out;
}

function itemIds(options: StartingOption[] | undefined): Set<string> {
  const ids = new Set<string>();
  for (const b of bundles(options)) {
    for (const item of b.items ?? []) ids.add(item.id);
    for (const pick of b.picks ?? []) for (const id of pick.from ?? []) ids.add(id);
  }
  return ids;
}

test('starting equipment read from the prose, against the hand-written key', { skip: corpusSkip }, async (t) => {
  const index = await realElements();
  const key = JSON.parse(await readFile(join(repoRoot(), 'tools', 'verify', 'fixtures', 'starting-equipment-key.json'), 'utf8')) as Key;
  const names = new ItemNames(index.all());
  t.diagnostic(corpusProvenance());

  let keyed = 0;
  let found = 0;
  let pending = 0;
  let picks = 0;
  const missed = new Map<string, number>();
  const pendingTexts = new Map<string, number>();
  let read = 0;
  let unread = 0;
  for (const type of ['Class', 'Background']) {
    for (const element of index.byType(type)) {
      const options = readStartingEquipment(element, names);
      if (options) read++;
      else if (/starting equipment|Equipment:|You start with the following equipment/i.test(element.description ?? '')) unread++;
      for (const b of bundles(options)) {
        for (const p of b.pending ?? []) {
          pending++;
          pendingTexts.set(p.text.toLowerCase(), (pendingTexts.get(p.text.toLowerCase()) ?? 0) + 1);
        }
        picks += b.picks?.length ?? 0;
      }
      const entry = key.packages.find((p) => p.for === element.id);
      if (!entry) continue;
      const got = itemIds(options);
      for (const id of itemIds(entry.options)) {
        keyed++;
        if (got.has(id)) found++;
        else missed.set(index.get(id)?.name ?? id, (missed.get(index.get(id)?.name ?? id) ?? 0) + 1);
      }
    }
  }
  const top = (m: Map<string, number>, n: number) => [...m].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, c]) => `${c} ${k}`).join('; ');
  t.diagnostic(`read: ${read} classes and backgrounds give a package; ${unread} mention starting equipment in no shape the parser reads`);
  t.diagnostic(`the key's items found: ${found} of ${keyed} (${Math.round((100 * found) / Math.max(1, keyed))}%); picks written: ${picks}; parts left pending: ${pending}`);
  t.diagnostic(`the key's items most often not found: ${top(missed, 15)}`);
  t.diagnostic(`pending most often: ${top(pendingTexts, 25)}`);
  t.diagnostic(`lookups each pattern rescued: ${top(patternRescues, 10) || 'none'}`);
  assert.ok(read > 0, 'the parser reads some starting equipment');
  // 86% when measured (2026-10-28, c28ce6c); the rest of each line is a pending item the user resolves on Build.
  assert.ok(found / Math.max(1, keyed) >= 0.85, `${found} of ${keyed} of the key's items found`);
});
