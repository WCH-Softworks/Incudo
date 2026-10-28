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

import type { Element, ElementExtension } from '@incudo/core';

import { convertCorpus, isGenerated } from './corpus.ts';
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

test('every Aurora construct read past the conversion, counted over the corpus', { skip: corpusSkip }, async (t) => {
  const location = requireCorpus();
  const { bundle } = await convertCorpus(location);
  // The files' own elements as the converter wrote them, and the appends it turned into extensions.
  const files = new Map<string, Element[]>();
  for (const element of bundle.elements) {
    if (isGenerated(element)) continue;
    const url = element.origin.fileUrl ?? '';
    files.set(url, [...(files.get(url) ?? []), element]);
  }
  const appends: ElementExtension[] = bundle.extensions ?? [];
  assert.ok(files.size > 0, 'the corpus should convert');

  const lines: string[] = [corpusProvenance()];
  const say = (line: string): void => {
    lines.push(line);
  };

  // 1. What the library invents on every load of an Aurora source.
  const generated = bundle.elements.filter(isGenerated);
  const options = generated.filter((element) => element.id.startsWith('ID_INTERNAL_CLASS_FEATURE_'));
  say(
    `converter: ${generated.length} elements no file declares, written as two files of their own (${generated.length - options.length} fixed, ` +
      `${options.length} improvement options derived from the source): convert-source.ts (since ADR 0119; the library invented them on every load before)`,
  );

  // 2. Appends, and how many reach outside the file that writes them.
  const declaredIn = new Map<string, string>();
  for (const [url, elements] of files) for (const element of elements) declaredIn.set(element.id, url);
  const elsewhere = appends.filter((append) => declaredIn.get(append.id) !== append.fileUrl);
  const nowhere = appends.filter((append) => !declaredIn.has(append.id));
  say(
    `converter: ${appends.length} <append> blocks written as extensions, ${elsewhere.length} into another file's element, ` +
      `${nowhere.length} naming nothing a file declares; the library applies extensions, whichever source declares the target`,
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
  // Counted in the converted source: since ADR 0119 step 4 the first three are written as Incudo's by the converter
  // (61 :half references, 18 negated operands and 55 [character:N] at c28ce6c), so what is left of them is what it missed.
  say(`left after conversion: ${half} stat references ending :half, ${negated} filter tags starting "!", ${characterTerms} [character:N] terms`);
  const tagged = [...files.values()].flat().filter((e) => e.setters['isRitual']?.value.trim().toLowerCase() === 'true' && e.supports.includes('Ritual')).length;
  say(`converter: ${tagged} of ${rituals} spells setting isRitual true carry the tag Ritual it gives them`);
  say(`sheet: ${placeholderHalves} {{…:half}} placeholders in sheet text, Incudo's sheet notation for half a stat: sheet-hints.ts halfPlaceholder`);
  say(
    `system: ${[...interpolations.values()].reduce((a, b) => a + b, 0)} $(…) interpolations ` +
      `(${[...interpolations].map(([key, n]) => `${key} ${n}`).join(', ')}), expanded by 5e's blockFilters (Incudo's own construct)`,
  );
  say(`system: ${typeTerms} [type:X] terms, answered by 5e's heldTypesStat; ${duplicates} elements setting "allow duplicate", read by 5e's repeatableSetter`);

  // 4. What the 5e definition names of Aurora.
  const system = await readFile(join(root, 'systems', 'dnd5e', 'system.json'), 'utf8');
  const ids = [...new Set(system.match(/ID_[A-Z0-9_]+/g) ?? [])].filter((id) => !id.endsWith('_'));
  const internal = ids.filter((id) => id.startsWith('ID_INTERNAL_'));
  say(`systems/dnd5e: names ${ids.length} Aurora ids, ${internal.length} of them Aurora's app-internal ones`);
  // The starting equipment file the system shipped until ADR 0119 step 5, kept as the converter's key.
  const equipment = await readFile(join(root, 'tools', 'verify', 'fixtures', 'starting-equipment-key.json'), 'utf8');
  say(`the starting equipment written by hand (now a fixture): names ${new Set(equipment.match(/ID_[A-Z0-9_]+/g) ?? []).size} content ids`);

  for (const line of lines) t.diagnostic(line);
});
