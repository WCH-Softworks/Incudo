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

import { DEFAULT_SAVES_DIR } from './real-data.ts';

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

export function readManifest(): SampleManifest {
  return JSON.parse(readFileSync(join(SAMPLES_DIR, 'manifest.json'), 'utf8')) as SampleManifest;
}

/** Every `.dnd5e` in the samples folder, sorted, by file name. */
export function sampleFileNames(): string[] {
  return readdirSync(SAMPLES_DIR)
    .filter((name) => extname(name).toLowerCase() === '.dnd5e')
    .sort();
}

/** The samples that satisfy a question about what they are. */
export function samplesWhere(predicate: (sample: SampleEntry) => boolean): SampleEntry[] {
  return readManifest().samples.filter(predicate);
}

export function samplePath(sample: SampleEntry): string {
  return join(SAMPLES_DIR, sample.file);
}
