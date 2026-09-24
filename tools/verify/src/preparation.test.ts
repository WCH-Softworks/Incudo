/**
 * Prepared lists held to Aurora — ADR 0046.
 *
 * Two halves. The first needs no corpus: `preparationViolations` is exercised on fabricated pieces, one
 * branch at a time, so a check that could never fail is caught. The second runs the check over the thirty
 * committed samples against the official corpus and then **breaks the rule in each way it can be broken**
 * and says which samples must notice. The oracle run in `aurora-oracle.test.ts` holds all thirty; that a
 * held check is a real one is what these perturbations are for, the way armour class, speed and hit points
 * were shown (ADR 0026, 0043, 0044). Which samples fail is worked out from what the saves hold and never
 * from their names or their count.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';

import {
  BundleElementIndex,
  MapElementIndex,
  collectCharacterContent,
  deriveCharacter,
  packCharacterContainer,
  readCharacterContainer,
  resolveCharacterKind,
  type Element,
  type ElementIndex,
  type GameSystem,
  type PreparedBlock,
  type Rule,
} from '@incudo/core';
import type { AuroraSave } from '@incudo/aurora-import';

import { preparationViolations, runOracle, type OracleRun } from './aurora-oracle.ts';
import { readManifest, sampleFileNames, SAMPLES_DIR } from './sample-saves.ts';
import { realElements, requireCorpus, requireSaves, savesSkip } from './real-data.ts';

// --- the check itself, with no corpus -------------------------------------------

function block(over: Partial<PreparedBlock> = {}): PreparedBlock {
  return { key: 'cleric', name: 'Cleric', limit: 3, mode: 'list', always: [], held: [], chosen: [], unavailable: [], over: 0, ...over };
}

function pieces(
  spells: Array<{ id: string; prepared?: boolean; known?: boolean }>,
  blocks: PreparedBlock[],
): Pick<OracleRun, 'save' | 'derived' | 'elements'> {
  const save = {
    magic: [{ name: 'Cleric', cantrips: [], spells: spells.map((s) => ({ name: s.id, level: 1, ...s })) }],
  } as unknown as AuroraSave;
  // No `preparation` on the kind, so the pool is empty and only what Incudo counts is on offer.
  const derived = { preparation: blocks, kind: {}, elements: [], stats: new Map() } as unknown as OracleRun['derived'];
  return { save, derived, elements: new MapElementIndex() };
}

test('a save that flags nothing prepared is held to nothing, whatever it lists', () => {
  assert.deepEqual(preparationViolations(pieces([{ id: 'A' }, { id: 'B' }], [])), []);
});

test('a flagged block Incudo has no list for is the first thing to fail', () => {
  const out = preparationViolations(pieces([{ id: 'A', prepared: true }], []));
  assert.equal(out.length, 1);
  assert.match(out[0]!, /Incudo has no prepared list for it/);
});

test('the flagged set and Incudo\'s list must be the same, in both directions', () => {
  const held = pieces([{ id: 'A', prepared: true }, { id: 'B', prepared: true }, { id: 'C' }], [block({ chosen: ['A', 'X'], always: [] })]);
  const out = preparationViolations(held);
  assert.ok(out.some((l) => /Aurora has B prepared and Incudo does not/.test(l)));
  assert.ok(out.some((l) => /Incudo has X prepared and Aurora does not/.test(l)));
  // C is listed and neither held nor offered: the pool is empty in this fixture.
  assert.ok(out.some((l) => /Aurora lists C and Incudo neither holds nor offers it/.test(l)));
  // A one Incudo counts as always prepared satisfies a flag as well as a chosen one does.
  const ok = pieces([{ id: 'A', prepared: true }, { id: 'B', prepared: true }], [block({ always: ['A'], chosen: ['B'] })]);
  assert.deepEqual(preparationViolations(ok), []);
});

test('something recorded that the block cannot prepare fails, and a book may not offer beyond what Aurora lists', () => {
  const stuck = pieces([{ id: 'A', prepared: true }], [block({ chosen: ['A'], unavailable: ['Z'] })]);
  assert.ok(preparationViolations(stuck).some((l) => /Z is recorded prepared and Incudo says the block cannot prepare it/.test(l)));
  // On a book, what is counted must be listed; Incudo counting D where Aurora's book has no D fails.
  const book = pieces([{ id: 'A', prepared: true, known: true }], [block({ mode: 'held', chosen: ['A', 'D'] })]);
  const out = preparationViolations(book);
  assert.ok(out.some((l) => /Incudo offers D from a book/.test(l)));
});

test("the way a block prepares is what Aurora's own listing says: all known is a book, anything else a list", () => {
  const listing = [{ id: 'A', prepared: true, known: true }, { id: 'B', known: true }];
  // A book of known spells that Incudo treats as a list.
  const asList = preparationViolations(pieces(listing, [block({ mode: 'list', chosen: ['A'] })]));
  assert.ok(asList.some((l) => /a book of what the character knows and Incudo prepares from the list/.test(l)));
  // A listing with a spell the character does not know is the class list, and Incudo treating it as a book fails.
  const wide = [{ id: 'A', prepared: true, known: true }, { id: 'B' }];
  const asBook = preparationViolations(pieces(wide, [block({ mode: 'held', chosen: ['A'] })]));
  assert.ok(asBook.some((l) => /the class list and Incudo prepares from a book/.test(l)));
  assert.deepEqual(preparationViolations(pieces(wide, [block({ mode: 'list', chosen: ['A'] })])).filter((l) => /prepares from/.test(l)), []);
});

test('the readout is a multiset of the non-zero limits, in any order', () => {
  const base = pieces([{ id: 'A', prepared: true }], [block({ chosen: ['A'], limit: 3 }), block({ key: 'wizard', name: 'Wizard', limit: 8 })]);
  // Wizard is a block the fixture save does not record, so only the readout speaks to it.
  assert.deepEqual(preparationViolations(base, [8, 0, 3]), []);
  assert.deepEqual(preparationViolations(base, [3, 8]), []);
  assert.match(preparationViolations(base, [3, 7])[0]!, /reads 3\/7 on Aurora's screen and 3\/8 here/);
  assert.match(preparationViolations(base, [0])[0]!, /reads nothing on Aurora's screen and 3\/8 here/);
  assert.deepEqual(preparationViolations(base), [], 'no readout, no comparison');
});

// --- the thirty samples, and breaking the rule -------------------------------------

interface Measured {
  id: string;
  run: OracleRun;
  readout: number[];
  flagged: boolean;
}

let measured: Promise<Measured[]> | undefined;

/** Every sample run through the oracle once, and what each records about preparation. */
function samples(): Promise<Measured[]> {
  measured ??= (async () => {
    const location = requireCorpus();
    requireSaves();
    const corpus = await realElements();
    const manifest = readManifest();
    const out: Measured[] = [];
    for (const name of sampleFileNames()) {
      const run = await runOracle(join(SAMPLES_DIR, name), corpus, location.index);
      const id = run.imported.character.name;
      out.push({
        id,
        run,
        readout: manifest.samples.find((s) => s.id === id)!.readout.prepared,
        flagged: run.save.magic.some((b) => b.spells.some((s) => s.prepared)),
      });
    }
    return out;
  })();
  return measured;
}

function rederived(m: Measured, options: { system?: GameSystem; elements?: ElementIndex; prepared?: false } = {}): OracleRun {
  const character = options.prepared === false ? { ...m.run.imported.character, prepared: undefined } : m.run.imported.character;
  const elements = options.elements ?? m.run.elements;
  const system = options.system ?? m.run.system;
  return { ...m.run, system, elements, derived: deriveCharacter(character, system, elements) };
}

/** The samples the check fails on, by what it says, for a way of breaking the rule. */
function failing(all: Measured[], run: (m: Measured) => OracleRun): string[] {
  return all
    .filter((m) => preparationViolations(run(m), m.readout).length > 0)
    .map((m) => m.id)
    .sort();
}

function cloneSystem(system: GameSystem, change: (preparation: NonNullable<GameSystem['characterKinds'][number]['preparation']>) => void): GameSystem {
  const copy = structuredClone(system);
  change(copy.characterKinds.find((k) => k.id === 'pc')!.preparation!);
  return copy;
}

/** An index whose elements are rewritten on the way out, so a rule can be taken away without touching the corpus. */
class RewritingIndex implements ElementIndex {
  private readonly cache = new Map<string, Element>();
  private readonly base: ElementIndex;
  private readonly rewrite: (element: Element) => Element;
  constructor(base: ElementIndex, rewrite: (element: Element) => Element) {
    this.base = base;
    this.rewrite = rewrite;
  }
  private mapped(element: Element | undefined): Element | undefined {
    if (!element) return undefined;
    let out = this.cache.get(element.id);
    if (!out) {
      out = this.rewrite(element);
      this.cache.set(element.id, out);
    }
    return out;
  }
  get(id: string): Element | undefined {
    return this.mapped(this.base.get(id));
  }
  all(): Iterable<Element> {
    return [...this.base.all()].map((e) => this.mapped(e)!);
  }
  byType(type: string): Element[] {
    return this.base.byType(type).map((e) => this.mapped(e)!);
  }
  bySupport(tag: string): Element[] {
    return this.base.bySupport(tag).map((e) => this.mapped(e)!);
  }
}

function rewriteRules(element: Element, change: (rule: Rule) => Rule): Element {
  return { ...element, rules: element.rules.map(change) };
}

const readsHalf = (rule: Rule): boolean =>
  rule.kind === 'stat' && rule.value.kind === 'ref' && /:half(:up)?$/.test(rule.value.stat);

test('every sample agrees with Aurora about its prepared lists', { skip: savesSkip }, async () => {
  const all = await samples();
  assert.ok(all.some((m) => m.flagged), 'some sample records a prepared spell');
  assert.deepEqual(failing(all, (m) => m.run), []);
});

test('perturbation: without the importer copying the flags, every sample that records one fails, and no other', { skip: savesSkip }, async () => {
  const all = await samples();
  const expected = all.filter((m) => m.flagged).map((m) => m.id).sort();
  assert.ok(expected.length > 0);
  assert.deepEqual(failing(all, (m) => rederived(m, { prepared: false })), expected);
});

test('perturbation: a limit that names the wrong stat fails every sample whose screen showed a count', { skip: savesSkip }, async () => {
  const all = await samples();
  const expected = all.filter((m) => m.readout.some((n) => n > 0)).map((m) => m.id).sort();
  assert.ok(expected.length > 0);
  const wrong = (m: Measured) =>
    rederived(m, { system: cloneSystem(m.run.system, (p) => (p.limit = '{name}:spellcasting:prepared')) });
  assert.deepEqual(failing(all, wrong), expected);
});

test('perturbation: a limit one too low fails the same samples, so no sample agrees by accident', { skip: savesSkip }, async () => {
  const all = await samples();
  const expected = all.filter((m) => m.readout.some((n) => n > 0)).map((m) => m.id).sort();
  const shifted = (m: Measured) => {
    const run = rederived(m);
    const stats = new Map(run.derived.stats);
    const preparation = run.derived.preparation.map((b) => ({ ...b, limit: b.limit - 1 }));
    return { ...run, derived: { ...run.derived, stats, preparation } };
  };
  assert.deepEqual(failing(all, shifted), expected);
});

test('perturbation: reading :half as nothing fails the samples with a half-caster that prepares, and no other', { skip: savesSkip }, async () => {
  const all = await samples();
  // The classes whose limit content writes with :half, found in the corpus and not named here.
  const corpus = await realElements();
  const halved = new Set<string>();
  for (const element of corpus.byType('Class Feature')) {
    for (const block of element.spellcasting ?? []) {
      if (block.prepare === 'true' && element.rules.some((r) => readsHalf(r))) halved.add(block.name.trim().toLowerCase());
    }
  }
  assert.ok(halved.size >= 2, 'the corpus has preparing classes whose limit is halved');
  const expected = all
    .filter((m) => m.run.save.magic.some((b) => halved.has(b.name.trim().toLowerCase()) && b.spells.some((s) => s.prepared)))
    .map((m) => m.id)
    .sort();
  assert.ok(expected.length > 0);

  // The behaviour before ADR 0046: a reference with the suffix names a stat nothing publishes.
  const before = (m: Measured) => {
    const elements = new RewritingIndex(m.run.elements, (e) =>
      rewriteRules(e, (rule) => (readsHalf(rule) ? { ...rule, value: { kind: 'number', value: 0 } } as Rule : rule)),
    );
    return rederived(m, { elements });
  };
  assert.deepEqual(failing(all, before), expected);
});

test('perturbation: a block with no book prepares from its list, and the book blocks notice', { skip: savesSkip }, async () => {
  const all = await samples();
  const books = all.filter((m) => m.run.derived.preparation.some((b) => b.mode === 'held')).map((m) => m.id).sort();
  assert.ok(books.length > 0);
  const noBook = (m: Measured) =>
    rederived(m, { system: cloneSystem(m.run.system, (p) => delete p.heldSelect) });
  assert.deepEqual(failing(all, noBook), books);
});

test('perturbation: a list filter that offers only first-level spells drops what Aurora lists above it', { skip: savesSkip }, async () => {
  const all = await samples();
  // A list block whose save lists a spell of a level above the first.
  const expected = all
    .filter((m) => {
      const lists = new Set(m.run.derived.preparation.filter((b) => b.mode === 'list').map((b) => b.key));
      return m.run.save.magic.some(
        (b) => lists.has(b.name.trim().toLowerCase()) && b.spells.some((s) => s.level > 1),
      );
    })
    .map((m) => m.id)
    .sort();
  assert.ok(expected.length > 0);
  const firstOnly = (m: Measured) =>
    rederived(m, { system: cloneSystem(m.run.system, (p) => (p.listFilter = '$(spellcasting:list), 1')) });
  assert.deepEqual(failing(all, firstOnly), expected);
});

test('perturbation: what content makes always prepared must not count against the limit', { skip: savesSkip }, async () => {
  const all = await samples();
  // Problems a list can have: past its limit, or holding what its block cannot prepare.
  const trouble = (run: OracleRun): number =>
    run.derived.problems.filter((p) => p.code === 'over-prepared' || p.code === 'not-preparable').length;
  const baseline = new Map(all.map((m) => [m.id, trouble(m.run)]));
  assert.ok([...baseline.values()].some((n) => n > 0), 'one sample records a list past its limit');

  // With no grant marking anything always prepared, every always-prepared spell in a save is an ordinary
  // recorded one: it counts against the limit, and if it is not on the block's own list (an Alchemist's
  // spells are the Wizard's and Cleric's) it cannot be prepared at all. Either is a new problem.
  const stripped = (m: Measured) => {
    const elements = new RewritingIndex(m.run.elements, (e) =>
      rewriteRules(e, (rule) => (rule.kind === 'grant' && rule.prepared ? { ...rule, prepared: false } : rule)),
    );
    return rederived(m, { elements });
  };
  const worse = all
    .filter((m) => trouble(stripped(m)) > (baseline.get(m.id) ?? 0))
    .map((m) => m.id)
    .sort();
  // Every list that Incudo counts past its limit *if* its always-prepared spells counted.
  const wouldBeOver = all
    .filter((m) => m.run.derived.preparation.some((b) => b.always.length > 0 && b.chosen.length + b.always.length > b.limit))
    .map((m) => m.id)
    .sort();
  assert.ok(wouldBeOver.length > 0);
  assert.deepEqual(wouldBeOver.filter((id) => !worse.includes(id)), [], 'each of those gets worse when nothing is always prepared');
  // And a list whose always-prepared spells fit under its limit does not: nothing else moves.
  const fits = all.filter((m) => !wouldBeOver.includes(m.id) && !worse.includes(m.id));
  assert.ok(fits.length > 0, 'samples that never depended on it stay as they were');
});

test('a saved character opens with no source and prepares exactly as it did (ADR 0012)', { skip: savesSkip }, async () => {
  const all = await samples();
  const withLists = all.filter((m) => m.flagged);
  assert.ok(withLists.length > 0);
  for (const m of withLists) {
    const { imported, system, elements, derived } = m.run;
    const kind = resolveCharacterKind(system, imported.character.kind);
    const content = collectCharacterContent(imported.character, elements, { kind, extraIds: imported.extraIds });
    const { container, problems } = readCharacterContainer(packCharacterContainer(imported.character, content, {}));
    assert.deepEqual(problems, [], m.id);
    // Nothing but the save's own embedded elements: the whole list a Cleric prepares from is not among them.
    const reopened = deriveCharacter(container!.character, system, new BundleElementIndex(container!.content.elements));
    assert.deepEqual(reopened.preparation, derived.preparation, `${m.id}: the same prepared lists with zero sources`);
    assert.deepEqual(
      reopened.problems.filter((p) => p.code === 'not-preparable'),
      [],
      `${m.id}: every prepared spell is in the save`,
    );
  }
});
