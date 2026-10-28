/**
 * What playing a character would track, measured before anything was built — ROADMAP Phase 6's "play".
 *
 * Reading a sheet is built (ADR 0083). Playing one is keeping, during a session, what no formula produces: hit points
 * lost and temporary ones, spell slots spent, limited uses of features spent, and what a rest gives back. This asks,
 * reported as `ℹ` lines (ADR 0042):
 *
 * - **What an Aurora save records of play.** Every element name in the thirty samples, and the attributes of the one
 *   element that looks like it (`<slots>`). If Aurora kept current hit points or spent slots, the frozen importer
 *   (ADR 0008) would be dropping them, and that would be the first thing to fix.
 * - **What content says about uses.** Every `usage` a `<sheet>` or one of its descriptions writes, by shape: a count
 *   per rest ("3/Long Rest", "{{barbarian rage:count}}/Long Rest"), a resource's name ("Channel Divinity", "Ki"), or
 *   something else ("1/Turn").
 * - **What the samples would track.** On each sample's sheet: the listed elements whose filled usage reads as a count
 *   per rest, those whose usage is something else, the slot rows each section shows, and the pools content publishes as
 *   a stat with no usage at all (Ki Points, Sorcery Points).
 *
 * Since ADR 0084 the last test asserts, against any corpus, what the play view makes of each sample.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { BundleElementIndex, readCharacterContainer, resolveCharacterKind } from '@incudo/core';
import { CharacterBuilder, packCharacter, readUsage, type PlayTracker, type PlayView, type SheetListedElement } from '@incudo/ui';

import { runOracle } from './aurora-oracle.ts';
import { corpusProvenance, corpusSkip, realElements, savesSkip } from './real-data.ts';
import { samplePath, samplesWhere } from './sample-saves.ts';

type Diagnostic = { diagnostic: (s: string) => void };

const tally = (into: Map<string, number>, key: string, by = 1): void => void into.set(key, (into.get(key) ?? 0) + by);
const show = (m: Map<string, number>, limit = 30): string =>
  [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limit).map(([k, v]) => `${k} ${v}`).join(', ') || 'none';

/** A usage's shape: numbers and placeholders written as N and {S}, so "3/Long Rest" and "{{x}}/Long Rest" are one. */
const shape = (usage: string): string => usage.replace(/\{\{[^}]*\}\}/g, '{S}').replace(/\d+/g, 'N');
/** A count per something: "N/Long Rest" read after the placeholders are filled. */
const PER = /^(\d+)\s*\/\s*(.+)$/;

test('what an Aurora save records of play', { skip: savesSkip }, async (t: Diagnostic) => {
  const tags = new Map<string, number>();
  const slotAttributes = new Map<string, number>();
  let saves = 0;
  for (const sample of samplesWhere(() => true)) {
    const text = await readFile(samplePath(sample), 'utf8');
    saves++;
    for (const m of text.matchAll(/<([a-zA-Z][\w-]*)/g)) tally(tags, m[1]!);
    for (const m of text.matchAll(/<slots\b([^>]*)>/g)) for (const a of m[1]!.matchAll(/([\w-]+)=/g)) tally(slotAttributes, a[1]!);
  }
  assert.ok(saves > 0, 'samples were read');
  t.diagnostic(`${saves} saves; element names: ${show(tags, 200)}`);
  t.diagnostic(`<slots> attributes: ${show(slotAttributes)}`);
  const playLike = [...tags.keys()].filter((tag) => /hp|hit|damage|temp|current|spent|expend|used|death|exhaust|condition|inspiration/i.test(tag));
  t.diagnostic(`element names that might be play state: ${playLike.length ? playLike.join(', ') : 'none'}`);
});

test("what content's usage hints say", { skip: corpusSkip }, async (t: Diagnostic) => {
  t.diagnostic(corpusProvenance());
  const elements = await realElements();
  const shapes = new Map<string, number>();
  let perRest = 0;
  let named = 0;
  let other = 0;
  for (const element of elements.all()) {
    const sheet = element.sheet;
    if (!sheet) continue;
    const usages = [sheet.usage, ...(sheet.descriptions ?? []).map((d) => d.usage)].filter((u): u is string => !!u && u.trim() !== '');
    for (const usage of usages) {
      const s = shape(usage.trim());
      tally(shapes, s);
      if (/^(N|\{S\})\/[A-Z][a-z]+( or [A-Z][a-z]+)? Rest\.?$|^(N|\{S\})\/Day$/.test(s)) perRest++;
      else if (!/[N{]/.test(s) && !/\//.test(s)) named++;
      else other++;
    }
  }
  t.diagnostic(`usage shapes (${[...shapes.values()].reduce((a, b) => a + b, 0)}): ${show(shapes, 60)}`);
  t.diagnostic(`a count per rest or per day: ${perRest}; a name and no count: ${named}; anything else: ${other}`);
});

test('what the samples would track', { skip: corpusSkip || savesSkip }, async (t: Diagnostic) => {
  t.diagnostic(corpusProvenance());
  const elements = await realElements();
  const perShape = new Map<string, number>();
  const notCounted = new Map<string, number>();
  const pools = new Map<string, number>();
  const lines: string[] = [];
  for (const sample of samplesWhere(() => true)) {
    const run = await runOracle(samplePath(sample), elements, 'sample');
    const state = new CharacterBuilder(run.imported.character, run.system, run.elements).getState();
    const kind = resolveCharacterKind(run.system, run.imported.character.kind);
    const listed: { section: string; element: SheetListedElement }[] = state.sheet.sections.flatMap((section) =>
      section.elements.map((element) => ({ section: section.section ?? section.id, element })),
    );
    const counted: string[] = [];
    for (const { section, element } of listed) {
      if (!element.usage) continue;
      const per = PER.exec(element.usage);
      if (per) {
        tally(perShape, `${section}: N/${per[2]}`);
        counted.push(`${element.sheetName ?? element.name} ${element.usage}`);
      } else tally(notCounted, `${section}: ${shape(element.usage)}`);
    }
    const slots = state.sheet.sections
      .filter((section) => /slots/.test(section.section ?? ''))
      .map((section) => `${section.label}: ${section.rows.map((row) => row.value).join('/')}`);
    for (const stat of ['ki:points', 'sorcery-points', 'sorcery points:amount', 'psi-points']) {
      const value = run.derived.stats.get(stat)?.value;
      if (value) tally(pools, stat);
    }
    lines.push(`${sample.id} (${kind.id}): hp ${run.derived.stats.get('hp')?.value ?? '—'}; ${slots.join('; ') || 'no slots'}; uses ${counted.join(', ') || 'none'}`);
  }
  t.diagnostic(`listed elements whose filled usage is a count per something, by section: ${show(perShape)}`);
  t.diagnostic(`listed elements with a usage that is not a count: ${show(notCounted)}`);
  t.diagnostic(`pools published as a stat with no usage: ${show(pools)}`);
  for (const line of lines) t.diagnostic(`  ${line}`);
});

/** A play view as text, for comparing two. */
const playText = (view: PlayView | undefined): string =>
  JSON.stringify(view?.groups.map((g) => [g.label, g.trackers.map((t) => [t.key, t.label, t.value, t.max, t.temporary?.value, t.restoredBy])]));

test("each sample's play view tracks what its sheet shows, and survives a pack and a reopen with no source", { skip: corpusSkip || savesSkip }, async (t: Diagnostic) => {
  // Since ADR 0084, against any corpus. Fails if 5e's play declaration loses a tracker (hit points, a slot section, the
  // uses), if a tracker's maximum is not the sheet's own number, if a usage that reads as a rest is not tracked, if a
  // play edit moves a derived number, or if the recorded play does not come back from the file.
  t.diagnostic(corpusProvenance());
  const elements = await realElements();
  let samples = 0;
  let trackers = 0;
  for (const sample of samplesWhere(() => true)) {
    const run = await runOracle(samplePath(sample), elements, 'sample');
    const builder = new CharacterBuilder(run.imported.character, run.system, run.elements);
    const state = builder.getState();
    const view = state.play;
    assert.ok(view, `${sample.id}: a player character has play`);
    const hp = view.groups.flatMap((g) => g.trackers).find((tr) => tr.key === 'hp');
    assert.equal(hp?.max, state.derived.stats.get('hp')?.value, `${sample.id}: hit points are the sheet's`);
    for (const section of state.sheet.sections.filter((s) => /slots$/.test(s.section ?? ''))) {
      for (const row of section.rows) {
        const key = `${section.section}/${row.stat}`;
        const tracked: PlayTracker | undefined = view.groups.flatMap((g) => g.trackers).find((tr) => tr.key === key);
        if (row.value === '0') assert.equal(tracked, undefined, `${sample.id}: ${key} is not tracked at zero`);
        else assert.equal(String(tracked?.max), row.value, `${sample.id}: ${key} is the sheet's ${row.value}`);
      }
    }
    const rests = run.system.characterKinds.find((k) => k.id === 'pc')!.play!.rests!;
    for (const e of state.sheet.sections.find((s) => s.section === 'features')?.elements ?? []) {
      const read = e.usage ? readUsage(e.usage, rests) : undefined;
      const tracked: PlayTracker | undefined = view.groups.flatMap((g) => g.trackers).find((tr) => tr.key === `uses/${e.elementId}`);
      assert.equal(tracked?.max, read?.count, `${sample.id}: ${e.name} (${e.usage ?? 'no usage'})`);
    }
    trackers += view.groups.reduce((n, g) => n + g.trackers.length, 0);

    // Play something: lose hit points with some temporary first, spend the first tracker of every other group, set a
    // condition. Nothing derived may move.
    builder.setPlayTemporary('hp', 4);
    builder.adjustPlay('hp', 9);
    for (const group of view.groups.slice(1)) builder.adjustPlay(group.trackers[0]!.key, 1);
    builder.setPlayCondition('Prone', true);
    const played = builder.getState();
    assert.equal(played.derived, state.derived, `${sample.id}: a play edit derives nothing`);
    // Play raises a character to 8; a multiclass one is already 14 (ADR 0119), and nothing lowers it.
    assert.equal(played.character.formatVersion, Math.max(8, state.character.formatVersion));
    assert.equal(played.play!.groups[0]!.trackers[0]!.value, hp!.max - 5, `${sample.id}: four of nine came off the temporary amount`);

    const packed = packCharacter(played.character, run.system, run.elements, { generator: 'test' });
    const { container } = readCharacterContainer(packed.files);
    const reopened = new CharacterBuilder(container!.character, run.system, new BundleElementIndex(container!.content.elements)).getState();
    assert.equal(playText(reopened.play), playText(played.play), `${sample.id}: the play view reopens identically with no source`);
    assert.deepEqual(reopened.play?.conditions, played.play?.conditions);
    samples++;
  }
  assert.ok(samples > 0, 'samples were read');
  t.diagnostic(`${samples} samples, ${trackers} trackers`);
});
