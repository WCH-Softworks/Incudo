/**
 * The content browser over the official corpus — ADR 0053.
 *
 * What must hold against any corpus (ADR 0042): every loaded element is in the browser, under its own type
 * whether the system declares it or not, and a search for its name finds it; every inline list item names the
 * select that offers it, and that is the select the importer minted it for; and building the browser and
 * searching it leaves what a builder offers exactly as it was, in the same order. Sizes and timings are printed,
 * never pinned: the corpus moves, and a machine's speed is not a property of the code.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

import { createCharacter, validateGameSystem, type ElementIndex, type GameSystem } from '@incudo/core';
import { CharacterBuilder, ContentCatalog, type BuilderState } from '@incudo/ui';

import { loadSchemas } from './node-system.ts';
import { corpusSkip, realElements, requireCorpus } from './real-data.ts';

async function shippedSystem(): Promise<GameSystem> {
  const path = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'systems', 'dnd5e', 'system.json');
  const result = validateGameSystem(JSON.parse(await readFile(path, 'utf8')), await loadSchemas());
  assert.deepEqual(result.errors, [], 'systems/dnd5e should validate');
  return result.value!;
}

/** What a fresh character is offered, every list in the order the builder gives it. */
function offers(state: BuilderState): string[][] {
  return state.decisions.map((decision) => [decision.id, ...(decision.candidates ?? [])]);
}

function ms(since: number): string {
  return `${(performance.now() - since).toFixed(1)} ms`;
}

// First in the file: the corpus is loaded once per file, so a catalog built by an earlier test would already have
// done whatever this one is here to catch before it looked.
test('building and searching the browser leaves what a builder offers exactly as it was', { skip: corpusSkip }, async () => {
  requireCorpus();
  const system = await shippedSystem();
  const index: ElementIndex = await realElements();

  const before = offers(new CharacterBuilder(createCharacter('dnd5e', 'pc', { progress: 1 }), system, index).getState());
  assert.ok(before.length > 0, 'a fresh character has decisions to compare');

  const catalog = new ContentCatalog(index, system);
  for (const query of ['elf', 'wizard', 'a']) catalog.search({ text: query });
  for (const type of system.elementTypes) catalog.search({ text: '', type: type.name, limit: 5 });
  for (const element of [...index.all()].slice(0, 200)) catalog.describe(element.id);

  const after = offers(new CharacterBuilder(createCharacter('dnd5e', 'pc', { progress: 1 }), system, index).getState());
  assert.deepEqual(after, before, 'every decision offers the same candidates, in the same order');
});

test('every loaded element is in the browser, under its own type, and found by its name', { skip: corpusSkip }, async (t) => {
  requireCorpus();
  const system = await shippedSystem();
  const index = await realElements();

  let started = performance.now();
  const catalog = new ContentCatalog(index, system);
  t.diagnostic(`built over ${catalog.size} elements in ${ms(started)}`);
  assert.equal(catalog.size, index.size, 'every loaded element is in the browser');

  // Timings, printed only. The first query that reaches descriptions builds their text, so it goes first.
  started = performance.now();
  catalog.search({ text: 'fire' });
  t.diagnostic(`first description search, text built: ${ms(started)}`);
  for (const query of ['fire', 'elf', 'a', 'shield master', 'zzzz']) {
    started = performance.now();
    const result = catalog.search({ text: query });
    const took = ms(started);
    const names = catalog.search({ text: query, descriptions: false }).count;
    t.diagnostic(`"${query}": ${result.count} matches (${names} by name or id alone) in ${took}`);
  }

  const idle = catalog.search({ text: '' });
  assert.equal(idle.idle, true);
  assert.equal(idle.rows.length, 0);
  const declared = new Set(system.elementTypes.map((type) => type.name));
  const present = new Set([...index.all()].map((element) => element.type));
  assert.deepEqual(new Set(idle.types.map((type) => type.type)), present, 'every type present is listed, and no other');
  for (const type of idle.types) {
    assert.equal(type.count, index.byType(type.type).length, `${type.type}: counted as the index holds it`);
    assert.equal(type.group === 'undeclared', !declared.has(type.type), `${type.type}: grouped by what the system declares`);
  }

  // Found by name: the first element of every type, which includes every type the system does not declare.
  for (const type of present) {
    const first = index.byType(type)[0]!;
    const found = catalog.search({ text: first.name, type, limit: Infinity });
    assert.ok(found.rows.some((row) => row.id === first.id), `${type}: "${first.name}" is found by its name`);
  }

  const group = (name: string): string =>
    idle.types
      .filter((type) => type.group === name)
      .map((type) => `${type.label} ${type.count}`)
      .join(', ');
  t.diagnostic(`browsable: ${group('browsable')}`);
  t.diagnostic(`not declared by the system: ${group('undeclared') || 'none'}`);

});

test('every inline list item names the select the importer minted it for', { skip: corpusSkip }, async (t) => {
  requireCorpus();
  const system = await shippedSystem();
  const index = await realElements();
  const catalog = new ContentCatalog(index, system);

  // The importer's shape, `<owner id>/list:<select name>/<item id>`, is read here as the record to compare with.
  // The browser never reads it: it follows the owner's select filter.
  const items = [...index.all()].filter((element) => element.id.includes('/list:'));
  let described = 0;
  for (const item of items) {
    const owner = item.id.slice(0, item.id.indexOf('/list:'));
    const select = item.id.slice(item.id.indexOf('/list:') + '/list:'.length, item.id.lastIndexOf('/'));
    const detail = catalog.describe(item.id);
    assert.deepEqual(
      detail?.offeredBy.map((offer) => [offer.ownerId, offer.select]),
      [[owner, select]],
      `${item.id}: offered by exactly its owner's select`,
    );
    described++;
  }
  t.diagnostic(`inline list items: ${described}, each offered by exactly one select, its owner's`);

  // How far the same lookup reaches beyond them. Printed, not pinned.
  let offered = 0;
  let many = 0;
  for (const element of index.all()) {
    const count = catalog.describe(element.id)!.offeredBy.length;
    if (count > 0) offered++;
    if (count > 20) many++;
  }
  t.diagnostic(`elements offered by at least one single-tag select: ${offered}; by more than twenty: ${many}`);
});
