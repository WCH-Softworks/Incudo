/**
 * The sample saves are what they say they are, and generic (docs/SAMPLE-SAVES.md, ADR 0042).
 *
 * Aurora writes things into a save that have nothing to do with the build: a portrait as inline image
 * bytes *and* the path it was loaded from (a path with the person's account name in it), the player's
 * name, and the list of every source the user has turned off, which is megabytes. A sample is committed
 * to a public repository forever, so each of those is checked here rather than trusted, and a later
 * sample cannot bring one in.
 *
 * The first half needs no corpus and runs in every CI job. The second reads each sample against the
 * manifest, which needs the real content.
 *
 * Nothing here prints what a field holds. A failure names the file's character (`Sample NN`) and the
 * field, never its value.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';

import { importAuroraCharacter, parseAuroraSave } from '@incudo/aurora-import';

import { readManifest, sampleFileNames, samplePath, type SampleClassRun } from './sample-saves.ts';
import { corpusSkip, realElements, savesSkip } from './real-data.ts';

/** A sample is a few dozen kilobytes. A portrait or an exclusion list is megabytes. */
const MAX_BYTES = 256 * 1024;

/** The text of a tag's first occurrence inside a section, or `undefined` when the section or tag is absent. */
function textIn(xml: string, section: string, tag: string): string | undefined {
  const a = xml.indexOf(`<${section}`);
  if (a < 0) return undefined;
  const end = xml.indexOf(`</${section}>`, a);
  const seg = xml.slice(a, end < 0 ? undefined : end);
  return new RegExp(`<${tag}(?:\\s[^>]*)?>([^<]*)</${tag}>`).exec(seg)?.[1];
}

test('the manifest lists exactly the sample files that are there', () => {
  const manifest = readManifest();
  const listed = manifest.samples.map((s) => s.file).sort();
  assert.deepEqual(listed, sampleFileNames(), 'a sample without a manifest entry, or an entry without a sample');
  assert.equal(new Set(manifest.samples.map((s) => s.id)).size, manifest.samples.length, 'ids are unique');
  assert.ok(manifest.samples.length > 0, 'there are samples at all');
});

test('every sample is generic: named by number, with no portrait, no path, no person and no exclusion list', async () => {
  const problems: string[] = [];
  for (const sample of readManifest().samples) {
    const label = sample.id;
    const file = samplePath(sample);
    const xml = await readFile(file, 'utf8');
    const number = /^sample-(\d\d)-/.exec(sample.file)?.[1];
    if (!number) problems.push(`${label}: the file is not named sample-NN-<descriptor>.dnd5e`);
    if (sample.id !== `Sample ${number}`) problems.push(`${label}: the id is not "Sample <the file's number>"`);

    // The character's name, in both places Aurora writes it.
    for (const section of ['display-properties', 'input']) {
      const name = textIn(xml, section, 'name');
      if (name?.trim() !== sample.id) problems.push(`${label}: the name in <${section}> is not the sample id`);
    }
    // Free text about a person.
    for (const tag of ['player-name', 'gender', 'age', 'height', 'weight', 'eyes', 'skin', 'hair']) {
      if ((textIn(xml, 'input', tag) ?? '').trim() !== '') problems.push(`${label}: <${tag}> is not empty`);
    }
    // The portrait: bytes, and the path they came from.
    if (/<base64>\s*(?:<!\[CDATA\[)?\s*\S/.test(xml.replace(/<base64>\s*<\/base64>/g, ''))) problems.push(`${label}: portrait bytes are embedded`);
    if ((textIn(xml, 'display-properties', 'local') ?? '').trim() !== '') problems.push(`${label}: a portrait path is recorded`);
    if ((textIn(xml, 'input', 'portrait') ?? '').trim() !== '') problems.push(`${label}: a portrait path is recorded in <input>`);
    // Any path at all: a drive letter or a home folder. Aurora writes a person's account name into one.
    if (/[A-Za-z]:\\[A-Za-z]/.test(xml)) problems.push(`${label}: a drive path is recorded`);
    if (/\/(?:Users|home)\//.test(xml)) problems.push(`${label}: a home-folder path is recorded`);
    // The exclusion list is preference, not build, and is what makes a save megabytes.
    const restricted = /<restricted>([\s\S]*?)<\/restricted>/.exec(xml)?.[1] ?? '';
    if (restricted.trim() !== '') problems.push(`${label}: the exclusion list is not empty`);
    if ((await stat(file)).size > MAX_BYTES) problems.push(`${label}: larger than ${MAX_BYTES / 1024} KB`);
  }
  assert.deepEqual(problems, [], 'a sample is not generic (the values are not printed). See docs/SAMPLE-SAVES.md.');
});

test('the guard notices each thing it guards, on a sample made wrong on purpose', () => {
  // Not the real samples: the same checks' inputs, so a guard that stopped guarding would show here.
  const portrait = '<display-properties><name>Sample 01</name><portrait><local>x</local><base64>QUJD</base64></portrait></display-properties>';
  assert.equal(textIn(portrait, 'display-properties', 'local'), 'x');
  assert.equal(textIn(portrait, 'display-properties', 'name'), 'Sample 01');
  assert.equal(textIn('<input><player-name></player-name></input>', 'input', 'player-name'), '');
  assert.equal(textIn('<other/>', 'input', 'name'), undefined);
});

// --- against the real content ---------------------------------------------------------------

/** Consecutive runs of levels by class, as `manifest.json` records them. */
function runsOf(names: string[]): SampleClassRun[] {
  const runs: SampleClassRun[] = [];
  for (const name of names) {
    const last = runs[runs.length - 1];
    if (last && last.class === name) last.levels += 1;
    else runs.push({ class: name, levels: 1 });
  }
  return runs;
}

test('each sample is the character its manifest entry says it is', { skip: corpusSkip || savesSkip }, async () => {
  const corpus = await realElements();
  for (const sample of readManifest().samples) {
    const imported = importAuroraCharacter(parseAuroraSave(await readFile(samplePath(sample), 'utf8')), {
      index: corpus,
      systemId: 'dnd5e',
    });
    const c = imported.character;
    const classIds = c.advancement
      ? c.advancement.map((e) => e.elementId)
      : Array<string>(c.progress).fill(
          c.choices.flatMap((k) => k.elementIds).find((id) => corpus.get(id)?.type === 'Class')!,
        );
    const split = runsOf(classIds.map((id) => corpus.get(id)?.name ?? id));
    assert.deepEqual(split, sample.split, `${sample.id}: the class split`);
    assert.equal(
      split.length > new Set(split.map((r) => r.class)).size,
      sample.interleaved,
      `${sample.id}: whether the levels are interleaved`,
    );
    const edition = /2024/.test(corpus.get(classIds[0]!)?.source ?? '') ? '2024' : '2014';
    assert.equal(edition, sample.edition, `${sample.id}: the edition`);
    const options = c.choices.filter((k) => k.ruleKey === 'build/options').flatMap((k) => k.elementIds).sort();
    assert.deepEqual(options, sample.options, `${sample.id}: the campaign options`);
  }
});
