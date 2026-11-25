/**
 * The committed sample saves (docs/SAMPLE-SAVES.md), and how a test finds one.
 *
 * **A test finds a sample by what it is**, never by its file name, its position or how many others sit
 * beside it: `samplesWhere((s) => s.split.length === 2 && s.edition === '2014')`. What each one is lives in
 * `tools/verify/fixtures/saves/manifest.json`, which `sample-saves.test.ts` checks against the saves
 * themselves, so a manifest that drifts from a save fails there and not somewhere confusing.
 *
 * `readout` is what the maintainer read off Aurora's own screen and typed in: the only referee hit points,
 * armour class and speed have, because Aurora's file records none of them. It is a human transcription and
 * is labelled as one wherever it is asserted. `recorded` is the table of differences against Aurora the
 * sample had when it was last understood, and, as ADR 0042 says, a report and not a pin.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { extname, join } from 'node:path';

import { DEFAULT_SAVES_DIR, corpusSuite } from './real-data.ts';

export interface SampleClassRun {
  class: string;
  levels: number;
}

export interface SampleEntry {
  /** The character's name inside the file, `Sample NN`. */
  id: string;
  file: string;
  edition: '2014' | '2024';
  /** Consecutive runs of levels by class, in the order they were taken. */
  split: SampleClassRun[];
  /** True when a class comes back after another (Rogue, Wizard, Rogue, ...) rather than in blocks. */
  interleaved: boolean;
  /** The campaign options the save turned on. */
  options: string[];
  readout: { ac: number; hp: number; hpMethod: string; speed: number; prepared: number[]; note?: string };
  recorded: { kinds: Record<string, number>; problems: number; blocks: number };
}

export interface SampleManifest {
  formatVersion: 1;
  /** The corpus commit `recorded` was last confirmed against. */
  recordedAt: string | null;
  samples: SampleEntry[];
}

export const SAMPLES_DIR: string = DEFAULT_SAVES_DIR;

/**
 * The samples a quick run sweeps (`INCUDO_CORPUS_SUITE=quick`, a pull request's run; real-data.ts), each named by what
 * it is and why it is there, the first match of each kept. Together they cover both editions, single and multiclass,
 * an interleaved split, no casting block, one and two blocks, every campaign option a sample records, both hit point
 * methods, a shield and armour, and the Artificer's negated filters and withdrawn firearms.
 */
const ARTIFICER = (s: SampleEntry): boolean => s.split.some((run) => run.class === 'Artificer');
export const QUICK_SAMPLES: ReadonlyArray<{ why: string; is: (s: SampleEntry) => boolean }> = [
  { why: 'an interleaved multiclass with two casting blocks and an Aurora referee', is: (s) => s.interleaved },
  { why: 'a 2024 multiclass of two half-casters', is: (s) => s.edition === '2024' && s.split.length > 1 },
  { why: "a 2014 single-class caster with Tasha's customisations", is: (s) => s.edition === '2014' && s.split.length === 1 && s.recorded.blocks > 0 && s.options.some((o) => o.includes('CUSTOMIZED_ASI')) },
  { why: 'a 2014 martial with rolled hit points and no casting', is: (s) => s.edition === '2014' && s.split.length === 1 && s.recorded.blocks === 0 && s.readout.hpMethod === 'rolled' },
  { why: 'a 2024 single class with no casting', is: (s) => s.edition === '2024' && s.split.length === 1 && s.recorded.blocks === 0 },
  { why: 'an Artificer: negated filters and a withdrawn grant', is: (s) => ARTIFICER(s) && s.split.length === 1 },
];

/**
 * `'suite'` is what the run sweeps: every sample in a full run, `QUICK_SAMPLES` in a quick one. `'all'` is every
 * sample whatever the run, for the checks that are about the whole set (the manifest, anonymity, the oracle).
 */
export type SampleScope = 'suite' | 'all';

function inScope(samples: SampleEntry[], scope: SampleScope): SampleEntry[] {
  if (scope === 'all' || corpusSuite === 'full') return samples;
  const picked = new Set<SampleEntry>();
  for (const { why, is } of QUICK_SAMPLES) {
    const match = samples.find(is);
    if (!match) throw new Error(`no sample is ${why}: QUICK_SAMPLES no longer matches the manifest`);
    picked.add(match);
  }
  return samples.filter((s) => picked.has(s));
}

export function readManifest(scope: SampleScope = 'suite'): SampleManifest {
  const manifest = JSON.parse(readFileSync(join(SAMPLES_DIR, 'manifest.json'), 'utf8')) as SampleManifest;
  return { ...manifest, samples: inScope(manifest.samples, scope) };
}

/** Every `.dnd5e` in the samples folder in scope, sorted, by file name. */
export function sampleFileNames(scope: SampleScope = 'suite'): string[] {
  const all = readdirSync(SAMPLES_DIR)
    .filter((name) => extname(name).toLowerCase() === '.dnd5e')
    .sort();
  if (scope === 'all' || corpusSuite === 'full') return all;
  const kept = new Set(readManifest('suite').samples.map((s) => s.file));
  return all.filter((name) => kept.has(name));
}

/**
 * The samples that satisfy a question about what they are. In a quick run, those of `QUICK_SAMPLES` when any of them
 * does, else the first that does: a test looking for one particular character still finds it.
 */
export function samplesWhere(predicate: (sample: SampleEntry) => boolean): SampleEntry[] {
  const quick = readManifest('suite').samples.filter(predicate);
  if (quick.length > 0 || corpusSuite === 'full') return quick;
  return readManifest('all').samples.filter(predicate).slice(0, 1);
}

export function samplePath(sample: SampleEntry): string {
  return join(SAMPLES_DIR, sample.file);
}
