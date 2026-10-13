/**
 * What showing every listed element's whole description would add to a sheet — measured before deciding how (ROADMAP Phase
 * 5's "Incudo's sheet shows a listed element's whole description").
 *
 * Per sample, and for every creature an NPC can be built on: how many listed elements carry a description, how many of
 * them have a sheet line already, the characters their descriptions add (embeds expanded, tags stripped, as a reader sees
 * them), how many are tables, and the same as a rough page count at a printed page's worth of text. Also the hidden
 * traits a held creature's stat block names without a line ("Primal Bond").
 *
 * Reported as `ℹ` lines; nothing here asserts anything about the corpus (ADR 0042).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { BundleElementIndex, readCharacterContainer } from '@incudo/core';
import { CharacterBuilder, expandDescription, packCharacter, sheetDocument } from '@incudo/ui';

import { runOracle } from './aurora-oracle.ts';
import { corpusSkip, realElements, savesSkip } from './real-data.ts';
import { readManifest, samplePath } from './sample-saves.ts';

/** A description as a reader sees it: tags out, entities decoded roughly, whitespace collapsed. */
function plain(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** About what a printed page in two columns holds at the print layout's size, for an order of magnitude only. */
const PAGE = 6000;

test('what each sample would gain from its listed elements’ whole descriptions (report)', { skip: savesSkip || corpusSkip }, async (t) => {
  const elements = await realElements();
  const totals: number[] = [];
  let withText = 0;
  let listedAll = 0;
  let tables = 0;
  let longest = { chars: 0, name: '' };
  const bySection = new Map<string, { elements: number; chars: number }>();
  // The 2014 form's Features and Traits flow: 43 lines of 44 and 23 of 97 at 7 pt, before any line is wrapped short.
  const FORM_FEATURES = 43 * 44 + 23 * 97;
  const featureChars: number[] = [];
  for (const sample of readManifest().samples) {
    const run = await runOracle(samplePath(sample), elements, 'sample');
    const state = new CharacterBuilder(run.imported.character, run.system, run.elements).getState();
    const document = sheetDocument(state);
    const seen = new Set<string>();
    let chars = 0;
    let described = 0;
    let lined = 0;
    const creatures = (document.companions?.creatures ?? []).flatMap((c) => c.sections);
    for (const section of [...document.sections, ...creatures]) {
      for (const listed of section.elements) {
        if (seen.has(listed.elementId)) continue;
        seen.add(listed.elementId);
        listedAll++;
        const element = run.elements.get(listed.elementId);
        const html = element ? expandDescription(element, run.elements) : '';
        const text = plain(html);
        if (!text) continue;
        described++;
        if (listed.text !== undefined) lined++;
        if (/<table/i.test(html)) tables++;
        chars += text.length;
        const part = bySection.get(section.section ?? section.id) ?? { elements: 0, chars: 0 };
        part.elements++;
        part.chars += text.length;
        bySection.set(section.section ?? section.id, part);
        if (text.length > longest.chars) longest = { chars: text.length, name: element!.name };
      }
    }
    withText += described;
    featureChars.push(document.sections.filter((s) => s.section === 'features').flatMap((s) => s.elements).reduce((sum, listed) => {
      const element = run.elements.get(listed.elementId);
      return sum + (element ? plain(expandDescription(element, run.elements)).length + listed.name.length + 2 : 0);
    }, 0));
    totals.push(chars);
    t.diagnostic(`${sample.id}: ${seen.size} listed, ${described} with a description (${lined} also with a sheet line), +${chars} characters, about ${Math.ceil(chars / PAGE)} pages`);
  }
  totals.sort((a, b) => a - b);
  t.diagnostic(`the form's Features and Traits box holds about ${FORM_FEATURES} characters; the features' whole text fits it on ${featureChars.filter((c) => c <= FORM_FEATURES).length} of ${featureChars.length} samples (${[...featureChars].sort((a, b) => a - b).join(', ')})`);
  t.diagnostic(`by section over all samples: ${[...bySection].sort((a, b) => b[1].chars - a[1].chars).map(([id, p]) => `${id} ${p.elements} elements, ${p.chars} characters`).join('; ')}`);
  t.diagnostic(`samples: ${listedAll} listed, ${withText} with a description, ${tables} with a table; +${totals[0]} to +${totals.at(-1)} characters (median ${totals[Math.floor(totals.length / 2)]}); longest one ${longest.name}, ${longest.chars}`);
  assert.ok(totals.length > 0);
});

test('every sample’s Descriptions part holds its describing sections’ described elements, the same with no source', { skip: savesSkip || corpusSkip }, async () => {
  // Fails if the part leaves out an element a describing section lists with a description, takes one from a section that
  // does not describe, or reads differently from the save's own embedded content.
  const elements = await realElements();
  let described = 0;
  for (const sample of readManifest().samples) {
    const run = await runOracle(samplePath(sample), elements, 'sample');
    const state = new CharacterBuilder(run.imported.character, run.system, run.elements).getState();
    const document = sheetDocument(state);
    const describing = [...document.sections, ...(document.companions?.creatures ?? []).flatMap((c) => c.sections)].filter((s) => s.describe);
    const expected = new Set(describing.flatMap((s) => s.elements).filter((e) => plain(expandDescription(run.elements.get(e.elementId) ?? { id: e.elementId }, run.elements))).map((e) => e.elementId));
    const got = (document.descriptions?.groups ?? []).flatMap((g) => g.entries.map((e) => e.elementId));
    assert.deepEqual(new Set(got), expected, sample.id);
    assert.equal(got.length, expected.size, `${sample.id}: each described once`);
    described += got.length;

    const packed = packCharacter(state.character, run.system, run.elements, { generator: 'test' });
    const { container } = readCharacterContainer(packed.files);
    const reopened = new CharacterBuilder(container!.character, run.system, new BundleElementIndex(container!.content.elements)).getState();
    assert.deepEqual(reopened.descriptions, state.descriptions, `${sample.id}: the same reopened with no source`);
  }
  assert.ok(described > 0, 'the samples describe something');
});
