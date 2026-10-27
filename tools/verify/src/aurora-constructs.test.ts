/**
 * What of Aurora is still read past the conversion — ADR 0119's first step, report-only.
 *
 * ADR 0119 decides that Aurora is an input format and nothing else: the converter writes down what Aurora's app did at
 * run time, and nothing past it (the content library, the engine, the system definitions) depends on Aurora's spelling.
 * This is the measurement that comes first: every Aurora construct the library and the engine still interpret, counted
 * over the official corpus, each with where it is read. Nothing here is asserted but that the corpus loaded: the corpus
 * moves (ADR 0042), and the counts are the record of a moment, printed as `ℹ` lines.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ElementAppend } from '@incudo/aurora-import';
import { ContentLibrary, type ContentSource, type ElementFile, type FileRef } from '@incudo/content';
import type { Element } from '@incudo/core';

import { corpusSource } from './corpus.ts';
import { corpusProvenance, corpusSkip, requireCorpus } from './real-data.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** Every node of a parsed tree carrying a `kind`, depth first. Requirement, filter and stat expressions all do. */
function* nodes(value: unknown): Generator<Record<string, unknown>> {
  if (Array.isArray(value)) {
    for (const item of value) yield* nodes(item);
  } else if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (typeof record['kind'] === 'string') yield record;
    for (const child of Object.values(record)) yield* nodes(child);
  }
}

/** A source that hands the library what it reads and keeps each file's appends as the parser returned them. */
function recording(source: ContentSource, appends: ElementAppend[], files: Map<string, Element[]>): ContentSource {
  return {
    id: source.id,
    loadIndex: (url) => source.loadIndex(url),
    checkForUpdates: (index) => source.checkForUpdates(index),
    async loadFile(ref: FileRef): Promise<ElementFile> {
      const file = await source.loadFile(ref);
      appends.push(...structuredClone(file.appends ?? []));
      files.set(ref.url, file.elements);
      return file;
    },
  };
}

test('every Aurora construct read past the conversion, counted over the corpus', { skip: corpusSkip }, async (t) => {
  const location = requireCorpus();
  const appends: ElementAppend[] = [];
  const files = new Map<string, Element[]>();
  const library = new ContentLibrary();
  await library.loadSource(recording(corpusSource(location), appends, files), location.index);
  const plain = new ContentLibrary();
  await plain.loadSource(corpusSource(location), location.index, { withoutGeneratedElements: true });
  assert.ok(files.size > 0, 'the corpus should load');

  const lines: string[] = [corpusProvenance()];
  const say = (line: string): void => {
    lines.push(line);
  };

  // 1. What the library invents on every load of an Aurora source.
  const generated = [...library.elements.all()].filter((element) => !plain.elements.get(element.id));
  const options = generated.filter((element) => element.id.startsWith('ID_INTERNAL_CLASS_FEATURE_'));
  say(
    `library: ${generated.length} elements no file declares (${generated.length - options.length} fixed, ` +
      `${options.length} improvement options derived from what is loaded): generated-elements.ts, improvement-options.ts`,
  );

  // 2. Appends, and how many reach outside the file that writes them.
  const declaredIn = new Map<string, string>();
  for (const [url, elements] of files) for (const element of elements) declaredIn.set(element.id, url);
  const elsewhere = appends.filter((append) => declaredIn.get(append.id) !== append.fileUrl);
  const nowhere = appends.filter((append) => !declaredIn.has(append.id));
  say(
    `library: ${appends.length} <append> blocks folded at load, ${elsewhere.length} into another file's element, ` +
      `${nowhere.length} naming nothing a file declares: library.ts applyAppends`,
  );

  // 3. The engine's evaluation-time readings, over every element as the parser wrote it.
  let half = 0;
  let negated = 0;
  let typeTerms = 0;
  let characterTerms = 0;
  let rituals = 0;
  let duplicates = 0;
  let placeholderHalves = 0;
  const interpolations = new Map<string, number>();
  for (const elements of files.values()) {
    for (const element of elements) {
      for (const node of nodes([element.rules, element.requirements, element.multiclass, element.spellcasting])) {
        if (node['kind'] === 'ref' && /:half(:up)?$/i.test(String(node['stat']))) half++;
        if (node['kind'] === 'tag' && /^!./.test(String(node['tag']))) negated++;
        if (node['kind'] === 'interpolate') {
          const key = String(node['key']);
          interpolations.set(key, (interpolations.get(key) ?? 0) + 1);
        }
        if ((node['kind'] === 'equals' || node['kind'] === 'atLeast') && node['stat'] === 'type') typeTerms++;
        if ((node['kind'] === 'equals' || node['kind'] === 'atLeast') && node['stat'] === 'character') characterTerms++;
      }
      if (element.setters['isRitual']?.value.trim().toLowerCase() === 'true') rituals++;
      if (element.setters['allow duplicate']) duplicates++;
      for (const description of element.sheet?.descriptions ?? []) {
        placeholderHalves += (description.text.match(/\{\{[^}]*:half(:up)?\s*\}\}/gi) ?? []).length;
      }
    }
  }
  say(`engine: ${half} stat references ending :half or :half:up, halved at evaluation: expression.ts statNumber`);
  say(`sheet: ${placeholderHalves} {{…:half}} placeholders in sheet text, halved when filled: sheet-hints.ts, ui sheet.ts`);
  say(`engine: ${negated} filter operands starting "!", negated at evaluation: supports.ts matchesSupports`);
  say(
    `engine: ${[...interpolations.values()].reduce((a, b) => a + b, 0)} $(…) interpolations ` +
      `(${[...interpolations].map(([key, n]) => `${key} ${n}`).join(', ')}), expanded through 5e's blockFilters`,
  );
  say(`engine: ${typeTerms} [type:X] terms, answered by 5e's heldTypesStat; ${characterTerms} [character:N], by 5e's "character" stat`);
  say(`engine: ${rituals} spells setting isRitual true, read as the tag Ritual by 5e's setterTags`);
  say(`engine: ${duplicates} elements setting "allow duplicate", read by 5e's repeatableSetter`);

  // 4. What the 5e definition names of Aurora.
  const system = await readFile(join(root, 'systems', 'dnd5e', 'system.json'), 'utf8');
  const ids = [...new Set(system.match(/ID_[A-Z0-9_]+/g) ?? [])].filter((id) => !id.endsWith('_'));
  const internal = ids.filter((id) => id.startsWith('ID_INTERNAL_'));
  say(`systems/dnd5e: names ${ids.length} Aurora ids, ${internal.length} of them Aurora's app-internal ones`);
  const equipment = await readFile(join(root, 'systems', 'dnd5e', 'starting-equipment.json'), 'utf8');
  say(`systems/dnd5e/starting-equipment.json: names ${new Set(equipment.match(/ID_[A-Z0-9_]+/g) ?? []).size} content ids`);

  for (const line of lines) t.diagnostic(line);
});
