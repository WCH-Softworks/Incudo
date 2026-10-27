/**
 * What building a character on a phone would need, measured before anything was built — ROADMAP Phase 6's "Full build
 * flow".
 *
 * Reading and playing a character need no content (ADRs 0083, 0084): the file carries it. Building does, so this asks,
 * reported as `ℹ` lines (ADR 0042) and asserting only that something was measured:
 *
 * - **What a load costs and what it reads.** The whole corpus loaded through `ContentLibrary` as the apps load it: files,
 *   elements, time and the heap it holds, and whether any file is not UTF-8 (`content-files.ts` decodes UTF-16 with a
 *   `TextDecoder` Hermes does not have; the network path decodes through the fetcher instead).
 * - **What the builder shows.** For a fresh character of every kind, and for every sample: the open decisions by kind,
 *   the largest candidate list, which of the builder's other parts are available (class levels, preparation, books,
 *   additions, references, features of the user's own), so the screens a phone needs first are counted, not guessed.
 * - **What a tap costs.** One `choose` on a fresh character, and re-deriving each sample, in Node on this machine: the
 *   phone pays a multiple of it for every edit.
 * - **What a save costs.** `packCharacter` and the zip, per sample, with fflate (the phone's DEFLATE): a build edit
 *   changes what the file embeds, so unlike a play edit it cannot be written by replacing `character.json` alone.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { resolveCharacterKind } from '@incudo/core';
import { CharacterBuilder, newCharacterOfKind, packCharacter, type BuilderState } from '@incudo/ui';
import { createMobileZipCodec } from '@incudo/mobile/zip';

import { runOracle } from './aurora-oracle.ts';
import { loadCorpus } from './corpus.ts';
import { loadFixtureSystem, loadShippedSystem } from './node-system.ts';
import { corpusProvenance, corpusSkip, realElements, requireCorpus, savesSkip } from './real-data.ts';
import { samplePath, samplesWhere } from './sample-saves.ts';

type Diagnostic = { diagnostic: (s: string) => void };

const tally = (into: Map<string, number>, key: string, by = 1): void => void into.set(key, (into.get(key) ?? 0) + by);
const show = (m: Map<string, number>): string =>
  [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([k, v]) => `${k} ${v}`).join(', ') || 'none';
const mb = (bytes: number): string => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
const range = (values: number[]): string => {
  if (!values.length) return 'none';
  const sorted = [...values].sort((a, b) => a - b);
  return `${sorted[0]}–${sorted[sorted.length - 1]} (median ${sorted[Math.floor(sorted.length / 2)]})`;
};

/** What a builder state shows, as the parts of a screen. */
function parts(state: BuilderState): string[] {
  const shown: string[] = [];
  if (state.steps.some((step) => step.classLevels)) shown.push('class levels');
  if (state.steps.some((step) => step.budget)) shown.push('budget');
  if (state.steps.some((step) => step.hitPoints)) shown.push('hit points');
  if (state.preparation.length) shown.push('preparation');
  if (state.publications.rows.length) shown.push('books');
  if (state.additions.available) shown.push('additions');
  if (state.references.available) shown.push('references');
  if (state.customFeatures.available) shown.push('own features');
  if (state.holderGrants.length) shown.push('holder grants');
  if (state.declined.length) shown.push('skipped');
  if (state.withdrawn.length) shown.push('not held');
  return shown;
}

function decisionKind(decision: BuilderState['decisions'][number]): string {
  return decision.multiple ? `${decision.kind} (set)` : decision.kind;
}

test('what loading the corpus costs, as an app loads it', { skip: corpusSkip }, async (t: Diagnostic) => {
  t.diagnostic(corpusProvenance());
  const location = requireCorpus();
  const root = location.root ?? join(location.index, '..');

  // The bytes each file starts with: a UTF-16 one would reach the decoder Hermes lacks if a phone added it as a file.
  const encodings = new Map<string, number>();
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (/\.(xml|index)$/i.test(entry.name)) {
        const bytes = await readFile(path);
        const kind =
          bytes[0] === 0xff && bytes[1] === 0xfe ? 'UTF-16LE' : bytes[0] === 0xfe && bytes[1] === 0xff ? 'UTF-16BE' : bytes[0] === 0xef && bytes[1] === 0xbb ? 'UTF-8 with BOM' : 'UTF-8';
        tally(encodings, kind);
      }
    }
  };
  await walk(root);
  t.diagnostic(`files by encoding: ${show(encodings)}`);

  const gc = (globalThis as { gc?: () => void }).gc;
  gc?.();
  const before = process.memoryUsage().heapUsed;
  const corpus = await loadCorpus(location);
  gc?.();
  const after = process.memoryUsage().heapUsed;
  assert.ok(corpus.elementsLoaded > 0, 'the corpus loaded');
  t.diagnostic(
    `loaded ${corpus.filesLoaded} files, ${corpus.elementsLoaded} elements in ${corpus.elapsedMs} ms from disk; ` +
      `heap ${mb(after - before)} more${gc ? '' : ' (no --expose-gc, so garbage is counted too)'}`,
  );
});

test('what the builder shows a fresh character of each kind', { skip: corpusSkip }, async (t: Diagnostic) => {
  const elements = await realElements();
  for (const systemId of ['dnd5e', 'cairn']) {
    const system = await (systemId === 'cairn' ? loadFixtureSystem(systemId) : loadShippedSystem(systemId));
    for (const kind of system.characterKinds) {
      const started = performance.now();
      const builder = new CharacterBuilder(newCharacterOfKind(system, kind.id), system, elements);
      const state = builder.getState();
      const opened = performance.now() - started;
      const kinds = new Map<string, number>();
      for (const decision of state.decisions) tally(kinds, decisionKind(decision));
      const largest = Math.max(0, ...state.decisions.map((decision) => decision.candidates.length));
      let tap = '';
      const first = state.decisions.find((decision) => decision.kind === 'pick' && decision.candidates.length);
      if (first) {
        const at = performance.now();
        builder.choose(first.id, [first.candidates[0]!]);
        builder.getState();
        tap = `; one ${first.label} pick re-derives in ${(performance.now() - at).toFixed(0)} ms`;
      }
      t.diagnostic(
        `${systemId}/${kind.id}: ${state.steps.length} steps, ${state.decisions.length} open (${show(kinds)}), largest list ${largest}; ` +
          `parts: ${parts(state).join(', ') || 'none'}; opened in ${opened.toFixed(0)} ms${tap}`,
      );
    }
  }
});

test('what the builder shows each sample, and what saving one costs', { skip: corpusSkip || savesSkip }, async (t: Diagnostic) => {
  t.diagnostic(corpusProvenance());
  const elements = await realElements();
  const zip = createMobileZipCodec();
  const decisionKinds = new Map<string, number>();
  const partCounts = new Map<string, number>();
  const largest: number[] = [];
  const settled: number[] = [];
  const derive: number[] = [];
  const pack: number[] = [];
  const sizes: number[] = [];
  let samples = 0;
  for (const sample of samplesWhere(() => true)) {
    const run = await runOracle(samplePath(sample), elements, 'sample');
    resolveCharacterKind(run.system, run.imported.character.kind);
    const started = performance.now();
    const state = new CharacterBuilder(run.imported.character, run.system, run.elements).getState();
    derive.push(Math.round(performance.now() - started));
    samples++;
    for (const decision of state.decisions) tally(decisionKinds, decisionKind(decision));
    for (const part of parts(state)) tally(partCounts, part);
    largest.push(Math.max(0, ...state.picks.map((pick) => pick.candidates.length), ...state.decisions.map((d) => d.candidates.length)));
    settled.push(state.picks.reduce((total, pick) => total + pick.chosen.length, 0));
    const at = performance.now();
    const packed = packCharacter(state.character, run.system, run.elements);
    const bytes = await zip.zip(packed.files);
    pack.push(Math.round(performance.now() - at));
    sizes.push(Math.round(bytes.length / 1024));
  }
  assert.ok(samples > 0, 'samples were read');
  t.diagnostic(`${samples} samples; open decisions by kind: ${show(decisionKinds)}`);
  t.diagnostic(`builder parts shown, samples showing each: ${show(partCounts)}`);
  t.diagnostic(`answered slots per sample: ${range(settled)}; the longest list a settled or open decision offers: ${range(largest)}`);
  t.diagnostic(`opening a builder (derive and every view) in Node: ${range(derive)} ms`);
  t.diagnostic(`packCharacter and fflate zip in Node: ${range(pack)} ms, ${range(sizes)} KB`);
});
