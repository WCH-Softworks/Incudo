/**
 * What refreshing a character against today's content would change, measured before a refresh exists.
 *
 * ROADMAP Phase 5's "Content has been updated — refresh?" flow. A character carries every element it uses (ADR 0012) and
 * opens from that copy, in front of whatever its sources load now; ADR 0028 records each source's version so the app can
 * say a source "moved". This asks whether the version says anything, and what a refresh, putting today's definitions in
 * place of the copies, would change.
 *
 * The samples are imported against an **older** corpus, as if saved then (`INCUDO_BASE_CORPUS_INDEX`, a checkout of
 * AuroraLegacy/elements at an older commit; skipped when unset), packed the way the app saves them, and compared with
 * today's corpus:
 *
 * - **The index's version** then and now: what ADR 0028's `moved` state compares.
 * - **Per character, its embedded elements**: the same today, different (and in which part: rules, description, …), or
 *   gone from today's content.
 * - **What a refresh would change**: the character derived as it opens today (its copies in front of today's content)
 *   against the same with today's definitions in front, by elements held and by stats.
 *
 * Report-only (ADR 0042): `ℹ` lines, nothing asserted but that samples were read.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  BundleElementIndex,
  collectCharacterContent,
  containerElementIndex,
  deriveCharacter,
  LayeredElementIndex,
  readCharacterContainer,
  resolveCharacterKind,
  type Element,
} from '@incudo/core';
import { contentChanges, packCharacter, refreshNotice } from '@incudo/ui';

import { runOracle } from './aurora-oracle.ts';
import { loadCorpus } from './corpus.ts';
import { summarize } from './derived-summary.ts';
import { baseCorpusSkip, corpusProvenance, corpusSkip, realElements, requireBaseCorpus, savesSkip } from './real-data.ts';
import { samplePath, samplesWhere } from './sample-saves.ts';

type Diagnostic = { diagnostic: (s: string) => void };

const comparable = (element: Element): string => JSON.stringify({ ...element, origin: undefined });
const PARTS = ['name', 'setters', 'rules', 'supports', 'requirements', 'description', 'sheet', 'multiclass', 'spellcasting'] as const;
const indexVersion = (path: string): string => /<index[^>]*>[\s\S]*?version="([^"]*)"/.exec(readFileSync(path, 'utf8'))?.[1] ?? '(none)';

test('the samples, saved against an older corpus: what a refresh against today\'s would change', { skip: baseCorpusSkip || corpusSkip || savesSkip }, async (t: Diagnostic) => {
  const base = requireBaseCorpus();
  t.diagnostic(corpusProvenance());
  const then = (await loadCorpus(base)).library.elements;
  const now = await realElements();
  t.diagnostic(`the index's version then ${indexVersion(base.index)}`);

  let samples = 0;
  let changed = 0;
  let embedded = 0;
  let differ = 0;
  let gone = 0;
  let gainedTotal = 0;
  let lostTotal = 0;
  let statsMoved = 0;
  const parts = new Map<string, number>();
  const lines: string[] = [];
  for (const sample of samplesWhere(() => true)) {
    samples++;
    const run = await runOracle(samplePath(sample), then, 'sample');
    const kind = resolveCharacterKind(run.system, run.imported.character.kind);
    const content = collectCharacterContent(run.imported.character, run.elements, { kind, extraIds: run.imported.extraIds });
    const copies = new BundleElementIndex(content.elements);
    let d = 0;
    let g = 0;
    for (const element of content.elements) {
      const today = now.get(element.id);
      if (!today) g++;
      else if (comparable(today) !== comparable(element)) {
        d++;
        for (const part of PARTS) if (JSON.stringify(today[part]) !== JSON.stringify(element[part])) parts.set(part, (parts.get(part) ?? 0) + 1);
      }
    }
    const asOpened = summarize(deriveCharacter(run.imported.character, run.system, new LayeredElementIndex([copies, now]), { kind }));
    const refreshed = summarize(deriveCharacter(run.imported.character, run.system, new LayeredElementIndex([now, copies]), { kind }));
    const before = new Set(asOpened.elements);
    const after = new Set(refreshed.elements);
    const gained = [...after].filter((id) => !before.has(id)).length;
    const lost = [...before].filter((id) => !after.has(id)).length;
    const stats = new Set([...Object.keys(asOpened.stats), ...Object.keys(refreshed.stats)]);
    const moved = [...stats].filter((s) => JSON.stringify(asOpened.stats[s]) !== JSON.stringify(refreshed.stats[s])).length;
    embedded += content.elements.length;
    differ += d;
    gone += g;
    gainedTotal += gained;
    lostTotal += lost;
    statsMoved += moved;
    if (d || g || gained || lost || moved) changed++;
    lines.push(`${sample.id}: ${content.elements.length} embedded, ${d} differ today, ${g} gone; a refresh gains ${gained} elements, loses ${lost}, moves ${moved} stats`);
  }
  assert.ok(samples > 0, 'samples were read');
  t.diagnostic(`${samples} samples, ${changed} that a refresh would change; ${embedded} elements embedded, ${differ} differ today, ${gone} gone from today's content`);
  t.diagnostic(`what differs: ${[...parts].sort((a, b) => b[1] - a[1]).map(([p, n]) => `${p} ${n}`).join(', ')}`);
  t.diagnostic(`a refresh would gain ${gainedTotal} held elements, lose ${lostTotal}, and move ${statsMoved} stats across the samples`);
  for (const line of lines) t.diagnostic(`  ${line}`);
});

// ADR 0082: an offer is news only when a source changed something. Fails if a character saved against the content
// loaded now is offered a refresh: a definition that does not survive the save read as a change, or an element only the
// save has (Aurora's generated ones) read as changed rather than kept, would put the offer on every imported character.
test("a character saved against today's content is offered no refresh", { skip: corpusSkip || savesSkip }, async (t: Diagnostic) => {
  t.diagnostic(corpusProvenance());
  const now = await realElements();
  let read = 0;
  for (const sample of samplesWhere(() => true)) {
    const run = await runOracle(samplePath(sample), now, 'sample');
    const packed = packCharacter(run.imported.character, run.system, run.elements, { generator: 'test', extraIds: run.imported.extraIds });
    const { container } = readCharacterContainer(packed.files);
    assert.ok(container, `${sample.id}: the save reads back`);
    // Against what the app loads: the corpus, without the elements Aurora made up for this save, which only the save has.
    const changes = contentChanges(containerElementIndex(container), now);
    assert.deepEqual(changes.changed.map((e) => e.id), [], `${sample.id}: copies that read as changed`);
    assert.equal(refreshNotice(changes), undefined, `${sample.id}: offered a refresh`);
    read++;
  }
  assert.ok(read > 0, 'samples were read');
  t.diagnostic(`${read} samples saved and reopened against the same content: no refresh offered`);
});
