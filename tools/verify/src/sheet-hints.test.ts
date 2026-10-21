/**
 * What content's `<sheet>` hints say, and what reading them would take — measured before deciding (ADR 0074 decision 7).
 *
 * Aurora's elements carry display metadata for a character sheet: `<sheet display="false" alt="…" usage="…"
 * action="…">` with one or more `<description>` children, a short text written for the sheet rather than the rulebook.
 * The importer parses it into `Element.sheet`, and nothing reads it. A printable sheet (Phase 5: the fillable PDF, the
 * print layout) wants it: a feature's line on a sheet is "Rage (Bonus Action, 3/Long Rest): …", not its page of rules.
 * This asks, reported as `ℹ` lines and asserting nothing (ADR 0042):
 *
 * - **What content writes**, read from the raw XML of every file the load reads (captured through the load's own
 *   fetcher, so no file outside the index is counted): each attribute, how many `<description>`s a sheet has and what
 *   they carry (`level=`, `usage=`, `action=`), the markup inside them, and the vocabularies of `usage` and `action`.
 * - **What the importer keeps of it**: `parseSheet` reads the first `<description>` only, so every later one, and the
 *   attributes on a description, are compared with what reached `Element.sheet`.
 * - **The placeholders**: `{{stat}}` in a description or a usage, by stat, and, on the thirty samples, whether the
 *   character's derivation publishes each stat a listed element's hint names.
 * - **On the samples, what the sheet lists**: how many listed elements carry a sheet description, how its length
 *   compares with the full description's, which are marked `display="false"` (by type and by name), which have a
 *   description gated by level, and, in the multiclass samples, which of those a character level and a class level
 *   would read differently.
 *
 * Aurora's save records nothing of its sheet (no hint, no chosen text), so nothing here has a referee.
 *
 * Since ADR 0076 read them, it also asserts what holds against any corpus (ADR 0042), each with the perturbation that
 * fails it beside the assertion: every raw description reaches `Element.sheet.descriptions` in order with its own
 * attributes; on the samples, each shown text is the one the raw XML gives at the level its element's rules read, no
 * shown hint keeps a placeholder and none is a dash for a stat the derivation publishes, a hidden element leaves only a
 * section that declares `omitHidden`, and a sample packed and reopened with no source shows the same hints. The report
 * below the first run's findings reads the sheet as it is now drawn, so the display="false" counts by section are what
 * a section still lists.
 *
 * The first run, on AuroraLegacy/elements at `c28ce6c`, found:
 * - **The importer drops part of it.** 220 sheets have two to five `<description>`s, gated by `level=` (332 gates),
 *   and `parseSheet` keeps the first: 320 descriptions are dropped, and 12 that carry a `usage` or `action` of their
 *   own (Rage's `Unlimited` at 20). What it keeps is exact, CRLF aside. A sixth silently dropped construct.
 * - **`display="false"` means "not in the feature list", not "not on the sheet".** On the samples, 314 listed elements
 *   carry it: 188 in Features & Traits (Spellcasting, Ability Score Improvement, the subclass placeholders, Tough,
 *   Skill Expertise), and 116 in the Character header (every race, class, subclass and background), which Aurora's
 *   own sheet names in its header.
 * - **Sheet text is feature text.** A shown feature (class, subclass, racial, feat) carries one 302 times in 341; a
 *   proficiency, a spell, a language or a background never does, and their full descriptions are most of the text
 *   (proficiencies 139,015 characters over the samples, spells 133,053).
 * - **Every stat a shown sheet text names is published** by the character's derivation, `:half:up` read as the engine
 *   reads it: 107 listed elements name one. A later description names stats published only from its level on.
 * - **Which level gates a description matters once**: of 38 gated listed elements, one multiclass sample reads
 *   differently by character level and class level (Font of Magic, Paladin 3 / Sorcerer 3), and its text, the slot
 *   levels sorcery points can make, follows the sorcerer's own level.
 * - `usage` is a count per rest, `{{proficiency}}/Long Rest`, or a resource's name ("Channel Divinity", "Ki"); `action`
 *   is Action, Bonus Action, Reaction or Attack but for 8; `alt` is a shorter name ("Channel Divinity: Turn Undead" →
 *   "Turn Undead"); 545 descriptions carry an entity and 58 an `<i>`.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  BundleElementIndex,
  halfReference,
  readCharacterContainer,
  type Element,
  type Fetcher,
} from '@incudo/core';
import { CharacterBuilder, fillPlaceholders, packCharacter, type BuilderState, type SheetListedElement, type SheetSectionView } from '@incudo/ui';

import { runOracle } from './aurora-oracle.ts';
import { loadCorpus } from './corpus.ts';
import { corpusProvenance, corpusSkip, requireCorpus, savesSkip } from './real-data.ts';
import { readManifest, samplePath } from './sample-saves.ts';

const tally = (into: Map<string, number>, key: string, by = 1): void => void into.set(key, (into.get(key) ?? 0) + by);
const show = (m: Map<string, number>, limit = 40): string =>
  [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limit).map(([k, v]) => `${k} ${v}`).join(', ') || 'none';
const attributes = (text: string): Record<string, string> =>
  Object.fromEntries([...text.matchAll(/([\w-]+)\s*=\s*"([^"]*)"/g)].map((m) => [m[1]!, m[2]!]));
const placeholders = (text: string): string[] => [...text.matchAll(/\{\{\s*([^}]*?)\s*\}\}/g)].map((m) => m[1]!);
const plain = (html: string): string => html.replace(/<[^>]*>/g, ' ').replace(/&[a-z]+;|&#\d+;/g, ' ').replace(/\s+/g, ' ').trim();

/** One `<sheet>` as the file wrote it. */
interface RawSheet {
  attributes: Record<string, string>;
  descriptions: { attributes: Record<string, string>; text: string }[];
}

/** Every element's raw `<sheet>`, by id, from the XML the load read, and the load's elements. */
async function loadWithSheets(): Promise<{ elements: Awaited<ReturnType<typeof loadCorpus>>['library']['elements']; raw: Map<string, RawSheet> }> {
  const texts: string[] = [];
  const corpus = await loadCorpus(requireCorpus(), {
    wrap: (fetcher: Fetcher): Fetcher => ({
      conditional: fetcher.conditional,
      fetchText: async (url, options) => {
        const result = await fetcher.fetchText(url, options);
        if (/\.xml$/i.test(url)) texts.push(result.text);
        return result;
      },
    }),
  });
  const raw = new Map<string, RawSheet>();
  for (const file of texts) {
    // A commented-out description is content switching one off, not one (the corpus comments some out).
    const text = file.replace(/<!--[\s\S]*?-->/g, '');
    // Not a self-closing `<element … />` (the corpus has some), which would run on into the next element's body.
    // Quote-aware, since three ids end in `>`.
    for (const element of text.matchAll(/<element\b((?:[^>"]|"[^"]*")*?)(?<!\/)>([\s\S]*?)<\/element>/g)) {
      const id = attributes(element[1]!)['id'];
      const sheet = /<sheet\b([^>]*?)(?:\/>|>([\s\S]*?)<\/sheet>)/.exec(element[2]!);
      if (!id || !sheet) continue;
      raw.set(id, {
        attributes: attributes(sheet[1]!),
        descriptions: [...(sheet[2] ?? '').matchAll(/<description\b([^>]*?)(?:\/>|>([\s\S]*?)<\/description>)/g)].map((d) => ({
          attributes: attributes(d[1]!),
          text: (d[2] ?? '').trim(),
        })),
      });
    }
  }
  return { elements: corpus.library.elements, raw };
}

/** The description a sheet shows at `level`: the one with the highest `level=` at or below it, else the ungated one. */
function describedAt(sheet: RawSheet, level: number): string | undefined {
  let best: { level: number; text: string } | undefined;
  for (const d of sheet.descriptions) {
    const gate = Number(d.attributes['level'] ?? 0);
    if (gate <= level && (!best || gate >= best.level)) best = { level: gate, text: d.text };
  }
  return best?.text;
}

let shared: Promise<Awaited<ReturnType<typeof loadWithSheets>>> | undefined;
const load = (): Promise<Awaited<ReturnType<typeof loadWithSheets>>> => (shared ??= loadWithSheets());

test('what content writes in <sheet>, and what the importer keeps of it', { skip: corpusSkip }, async (t) => {
  t.diagnostic(corpusProvenance());
  const { elements, raw } = await load();
  const sheetAttributes = new Map<string, number>();
  const descriptionCounts = new Map<string, number>();
  const descriptionAttributes = new Map<string, number>();
  const gates = new Map<string, number>();
  const markup = new Map<string, number>();
  const usage = new Map<string, number>();
  const action = new Map<string, number>();
  const tokens = new Map<string, number>();
  const hiddenByType = new Map<string, number>();
  const byType = new Map<string, number>();
  const lost: string[] = [];
  let laterDescriptions = 0;
  let attributesOnDescriptions = 0;
  let sameAsDescription = 0;
  let withDescription = 0;
  let parsedNoRaw = 0;

  for (const [id, sheet] of raw) {
    const element = elements.get(id);
    if (element) tally(byType, element.type);
    for (const key of Object.keys(sheet.attributes)) tally(sheetAttributes, key);
    tally(descriptionCounts, String(sheet.descriptions.length));
    if (sheet.attributes['usage'] !== undefined) tally(usage, sheet.attributes['usage'].replace(/\d+/g, 'N'));
    if (sheet.attributes['action'] !== undefined) tally(action, sheet.attributes['action']);
    if (sheet.attributes['display'] === 'false' && element) tally(hiddenByType, element.type);
    for (const [at, d] of sheet.descriptions.entries()) {
      for (const key of Object.keys(d.attributes)) tally(descriptionAttributes, key);
      if (d.attributes['level'] !== undefined) tally(gates, d.attributes['level']);
      if (d.attributes['usage'] !== undefined || d.attributes['action'] !== undefined) attributesOnDescriptions++;
      if (d.attributes['usage'] !== undefined) tally(usage, `${d.attributes['usage'].replace(/\d+/g, 'N')} (on a description)`);
      for (const tag of d.text.matchAll(/<([a-zA-Z][\w-]*)/g)) tally(markup, tag[1]!.toLowerCase());
      if (/&[a-zA-Z#][\w]*;/.test(d.text)) tally(markup, 'an entity');
      if (at > 0) laterDescriptions++;
    }
    for (const text of [...sheet.descriptions.map((d) => d.text), ...Object.values(sheet.attributes)]) {
      for (const name of placeholders(text)) tally(tokens, name.replace(/\d+/g, 'N'));
    }
    const first = sheet.descriptions[0]?.text;
    if (first) {
      withDescription++;
      if (element?.description && plain(element.description) === plain(first)) sameAsDescription++;
      // What the importer kept: the first description, and nothing of a later one or a description's own attributes.
      // Line ends compared as the importer reads them (XML 1.0 §2.11): a CRLF file's text is not a different text.
      if (element?.sheet?.description?.trim() !== first.replace(/\r\n?/g, '\n')) lost.push(`${id}: ${JSON.stringify(first.slice(0, 60))} / ${JSON.stringify(element?.sheet?.description?.slice(0, 60))}`);
    }
  }
  const noRaw: string[] = [];
  for (const element of elements.all() as Iterable<Element>) {
    if (element.sheet && !raw.has(element.id)) {
      parsedNoRaw++;
      noRaw.push(element.id);
    }
  }
  t.diagnostic(`examples: ${lost.slice(0, 4).join(' | ')} || ${noRaw.slice(0, 4).join(', ')}`);

  t.diagnostic(`elements with a <sheet>: ${raw.size}, by type: ${show(byType, 14)}`);
  t.diagnostic(`its attributes: ${show(sheetAttributes)}`);
  t.diagnostic(`descriptions per sheet: ${show(descriptionCounts)}; attributes on a description: ${show(descriptionAttributes)}`);
  t.diagnostic(`the level= gates: ${show(gates)}`);
  t.diagnostic(`what the importer drops: ${laterDescriptions} descriptions after a sheet's first, and ${attributesOnDescriptions} with a usage or action of their own; first descriptions that differ from what it kept: ${lost.length}`);
  t.diagnostic(`sheets with a description: ${withDescription}; the same text as the element's own description: ${sameAsDescription}`);
  t.diagnostic(`markup inside a sheet description: ${show(markup)}`);
  t.diagnostic(`display="false", by type: ${show(hiddenByType, 14)}`);
  t.diagnostic(`usage, digits as N: ${show(usage, 30)}`);
  t.diagnostic(`action: ${show(action)}`);
  t.diagnostic(`placeholders in a description or an attribute, by stat (digits as N): ${show(tokens, 40)}`);
  t.diagnostic(`parsed elements with sheet hints and no raw <sheet> found: ${parsedNoRaw}`);
  assert.ok(raw.size > 0);
});

test('every <description> a <sheet> writes reaches the element, in order, with its level, usage and action', { skip: corpusSkip }, async (t) => {
  // What holds against any corpus (ADR 0042): the importer keeps what the file wrote, as the file wrote it, line ends read
  // as XML reads them. Fails with parseSheet keeping the first description only (220 sheets differ at `c28ce6c`), or
  // with a description's own `usage` left unread (8 elements, 11 descriptions).
  const { elements, raw } = await load();
  const decode = (text: string): string =>
    text.replace(/&#x([0-9a-f]+);|&#(\d+);|&(amp|lt|gt|quot|apos);/gi, (_, hex: string, dec: string, named: string) =>
      hex ? String.fromCodePoint(parseInt(hex, 16)) : dec ? String.fromCodePoint(Number(dec)) : ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" } as Record<string, string>)[named.toLowerCase()]!);
  const differ: string[] = [];
  let compared = 0;
  for (const [id, sheet] of raw) {
    const element = elements.get(id);
    if (!element) continue;
    const expected = sheet.descriptions.map((d) => ({
      text: d.text.replace(/\r\n?/g, '\n'),
      ...(d.attributes['level'] !== undefined ? { level: Number(d.attributes['level']) } : {}),
      ...(d.attributes['usage'] ? { usage: decode(d.attributes['usage']) } : {}),
      ...(d.attributes['action'] ? { action: decode(d.attributes['action']) } : {}),
    }));
    compared += expected.length;
    const actual = element.sheet?.descriptions ?? [];
    if (JSON.stringify(actual) !== JSON.stringify(expected)) differ.push(id);
    else if (expected.length && element.sheet?.description !== expected[0]!.text) differ.push(`${id} (first)`);
  }
  t.diagnostic(`sheet descriptions compared: ${compared}; differing: ${differ.length}${differ.length ? `: ${differ.slice(0, 6).join(', ')}` : ''}`);
  assert.ok(compared > 0, 'no sheet description was read: the corpus loaded nothing');
  assert.deepEqual(differ, []);
});

test('on the samples: what the sheet lists that has a hint, what it would say, and what it names', { skip: corpusSkip || savesSkip }, async (t) => {
  t.diagnostic(corpusProvenance());
  const { elements, raw } = await load();
  const hiddenNames = new Map<string, number>();
  const hiddenTypes = new Map<string, number>();
  const resolved = new Map<string, number>();
  const unresolved = new Map<string, number>();
  const hintFields = new Map<string, number>();
  const multiclassGated: string[] = [];
  const perSample: string[] = [];
  const renamed = new Map<string, number>();
  const hiddenSections = new Map<string, number>();
  const withTextByType = new Map<string, number>();
  const noTextByType = new Map<string, number>();
  const noTextCharsByType = new Map<string, number>();
  let listed = 0;
  let listedWithSheet = 0;
  let listedWithSheetText = 0;
  let withPlaceholders = 0;
  let gated = 0;
  let readDifferently = 0;

  for (const sample of readManifest().samples) {
    const run = await runOracle(samplePath(sample), elements, 'sample');
    const state = new CharacterBuilder(run.imported.character, run.system, run.elements).getState();
    const stats = state.derived.stats;
    const level = stats.get('level')?.value ?? 0;
    const classLevels = [...stats].filter(([key, s]) => /^level:[a-z ]+$/.test(key) && s.value > 0).map(([key, s]) => `${key.slice(6)} ${s.value}`);
    const multiclass = new Set(sample.split.map((run) => run.class)).size > 1;
    // Of what a sheet would show (listed and not hidden): its sheet text, the full text of those with none, and the full
    // text of all of them, as plain characters.
    let sheetChars = 0;
    let fallbackChars = 0;
    let fullChars = 0;
    let hidden = 0;
    const ids = [...new Set(state.sheet.sections.flatMap((s) => s.elements.map((e) => e.elementId)))];
    for (const id of ids) {
      listed++;
      const element = run.elements.get(id);
      const sheet = raw.get(id);
      if (!element) continue;
      if (sheet?.attributes['display'] === 'false') {
        hidden++;
        tally(hiddenTypes, element.type);
        tally(hiddenNames, element.name);
        for (const section of state.sheet.sections) if (section.elements.some((e) => e.elementId === id)) tally(hiddenSections, section.label);
      } else {
        const full = plain(element.description ?? '').length;
        const text = sheet && describedAt(sheet, level);
        fullChars += full;
        if (text) {
          sheetChars += plain(text).length;
          tally(withTextByType, element.type);
        } else {
          fallbackChars += full;
          tally(noTextByType, element.type);
          tally(noTextCharsByType, element.type, full);
        }
      }
      if (!sheet) continue;
      listedWithSheet++;
      for (const key of Object.keys(sheet.attributes)) tally(hintFields, key);
      if (sheet.descriptions.length) tally(hintFields, 'description');
      for (const key of ['alt', 'name']) if (sheet.attributes[key] && renamed.size < 12) tally(renamed, `${key}: ${element.name} → ${sheet.attributes[key]}`);
      if (describedAt(sheet, level)) listedWithSheetText++;
      if (sheet.descriptions.some((d) => d.attributes['level'] !== undefined)) {
        gated++;
        // Which level gates it is Aurora's to say and it says nothing; a class feature's rules read its class's level
        // (ADR 0015), a race's the character's. Where the two readings would show different text, it matters.
        const atCharacter = describedAt(sheet, level);
        const atClass = classLevels.map((c) => describedAt(sheet, Number(c.split(' ').pop())));
        if (multiclass && atClass.some((text) => text !== atCharacter)) {
          readDifferently++;
          const gates = sheet.descriptions.map((d) => d.attributes['level'] ?? '-').join('/');
          multiclassGated.push(`${sample.id} (level ${level}; ${classLevels.join(', ')}): ${element.name} [${gates}]`);
        }
      }
      // In the text that would be shown at the character's level: a later description names stats published from later.
      const names = [...placeholders(describedAt(sheet, level) ?? ''), ...Object.values(sheet.attributes).flatMap(placeholders)];
      if (names.length) withPlaceholders++;
      for (const name of names) {
        // `:half` and `:half:up` are read where a reference is evaluated (ADR 0046), so a placeholder reads them too.
        const base = name.toLowerCase().replace(/:half(:up)?$/, '');
        tally(stats.has(base) ? resolved : unresolved, name);
      }
    }
    perSample.push(`${sample.id} ${ids.length} listed (${hidden} hidden): ${sheetChars} sheet + ${fallbackChars} full where none = ${sheetChars + fallbackChars}, against ${fullChars} full`);
  }

  t.diagnostic(`listed elements over the samples: ${listed}; with a <sheet>: ${listedWithSheet}; with a sheet description at the character's level: ${listedWithSheetText}`);
  t.diagnostic(`what their hints carry: ${show(hintFields)}`);
  t.diagnostic(`per sample, plain-text characters of the listed elements' sheet text (the full description where there is none) against their full descriptions: ${perSample.join('; ')}`);
  t.diagnostic(`shown and with a sheet description, by type: ${show(withTextByType)}`);
  t.diagnostic(`shown and with none, by type: ${show(noTextByType)}; their full descriptions' characters, by type: ${show(noTextCharsByType)}`);
  t.diagnostic(`listed and marked display="false", by type: ${show(hiddenTypes)}; by the section of this sheet listing it: ${show(hiddenSections)}`);
  t.diagnostic(`listed and marked display="false", by name (samples carrying it): ${show(hiddenNames, 60)}`);
  t.diagnostic(`listed with a description gated by level: ${gated}; in a multiclass sample, read differently at the character's level and at a class's: ${readDifferently}${multiclassGated.length ? `: ${multiclassGated.join(' | ')}` : ''}`);
  t.diagnostic(`a listed element's other name on the sheet, examples: ${[...renamed.keys()].join('; ') || 'none'}`);
  t.diagnostic(`listed elements whose hint names a stat: ${withPlaceholders}; those the derivation publishes (\`:half\` read as the engine reads it): ${show(resolved)}`);
  t.diagnostic(`and that it does not: ${show(unresolved)}`);
});

/** Every listed element of a sheet, the character's own sections and each held creature's, with where it is listed. */
function listedOf(state: BuilderState): { where: string; element: SheetListedElement }[] {
  const out: { where: string; element: SheetListedElement }[] = [];
  const add = (sections: readonly SheetSectionView[], prefix: string): void => {
    for (const section of sections) for (const element of section.elements) out.push({ where: `${prefix}${section.label}`, element });
  };
  add(state.sheet.sections, '');
  for (const creature of state.companions?.creatures ?? []) add(creature.sections, `${creature.name} / `);
  return out;
}

test('on the samples, what the sheet shows of the hints: chosen by gate level, filled, hidden only where a section says', { skip: corpusSkip || savesSkip }, async (t) => {
  // What holds against any corpus (ADR 0042), per sample:
  // - each listed element's text is the description the raw XML gives at the level its rules read (`gateLevels`), read
  //   independently of the importer, and none for a hidden element a section lists anyway (fails with the text chosen
  //   by the character's level: sample 17's Font of Magic; or with a hidden element given its line: every 2014 class);
  // - no shown text, usage or action keeps a `{{`, and every stat the view says is unpublished really is (fails with a
  //   placeholder left in place, or with `:half:up` not read: `level:wizard:half:up` reads as unpublished);
  // - a section that does not declare `omitHidden` lists every element of its types the sheet may list, hidden or not,
  //   and one that does lists none that is hidden (fails with the hint honoured everywhere: every race and class
  //   leaves the Character header; or with `omitHidden` unread: Spellcasting stays in Features & Traits);
  // - packed and reopened with no source, every listed element carries the same hints (fails with a save embedding an
  //   element without its later descriptions).
  t.diagnostic(corpusProvenance());
  const { elements, raw } = await load();
  const system = (await runOracle(samplePath(readManifest().samples[0]!), elements, 'sample')).system;
  const wrongText: string[] = [];
  const leftBraces: string[] = [];
  const wronglyUnfilled: string[] = [];
  const unfilled = new Map<string, number>();
  const hiddenWhereNotOmitted: string[] = [];
  const missingWhereNotOmitted: string[] = [];
  const hiddenShown: string[] = [];
  const offline: string[] = [];
  const shownHints = new Map<string, number>();
  const omittedBySection = new Map<string, number>();
  const withheld = new Map<string, number>();
  let listed = 0;
  let withText = 0;

  for (const sample of readManifest().samples) {
    const run = await runOracle(samplePath(sample), elements, 'sample');
    const builder = new CharacterBuilder(run.imported.character, run.system, run.elements);
    const state = builder.getState();
    const { derived } = state;
    const kind = derived.kind;
    const listable = derived.elements;

    for (const { where, element } of listedOf(state)) {
      listed++;
      const held = run.elements.get(element.elementId);
      const sheet = raw.get(element.elementId);
      for (const key of ['sheetName', 'text', 'usage', 'action'] as const) if (element[key] !== undefined) tally(shownHints, key);
      if (element.text !== undefined) withText++;
      for (const field of [element.text, element.usage, element.action]) {
        if (field?.includes('{{')) leftBraces.push(`${sample.id} ${element.name}: ${field.slice(0, 60)}`);
      }
      for (const stat of element.unfilled ?? []) {
        tally(unfilled, stat);
        const half = halfReference(stat);
        if (derived.stats.has(stat.toLowerCase()) || (half && derived.stats.has(half.base))) wronglyUnfilled.push(`${sample.id} ${element.name}: ${stat}`);
      }
      // The choice, against the raw XML read by this file rather than the importer. A creature's scope reads its own
      // gate levels; only the character's own sections are compared here, where `derived.gateLevels` is the answer.
      if (!where.includes(' / ') && held && sheet && sheet.descriptions.length) {
        const level = derived.gateLevels.get(element.elementId) ?? 0;
        const lines = describedAt(sheet, level)?.split(/\r\n?|\n/).map((line) => line.trim()).filter(Boolean).join('\n');
        // A hidden element a section lists anyway (a header's class) is named with no line: the line is for a list
        // content keeps it out of.
        const hidden = sheet.attributes['display'] === 'false';
        if (hidden && lines) tally(withheld, where);
        const expected = lines && !hidden ? fillPlaceholders(lines, derived.stats, true).text : undefined;
        if (element.text !== expected) wrongText.push(`${sample.id} ${element.name} at ${level}`);
      }
    }

    // What each section lists against what it may list: every element of its types, less what it says to leave out.
    for (const def of kind.sheet.sections) {
      const types = def.types ?? [];
      if (!types.length || def.perBlock) continue;
      // A section listing the bag (ADR 0098) lists a held item through its bag entry rather than as an element.
      const shown = new Set(
        state.sheet.sections
          .filter((s) => s.id === def.id)
          .flatMap((s) => [...s.elements.map((e) => e.elementId), ...(s.bag ?? []).map((e) => e.elementId)]),
      );
      if (def.bag) {
        for (const entry of state.character.inventory ?? []) for (const a of entry.adorners ?? []) if (shown.has(entry.elementId)) shown.add(a.elementId);
      }
      for (const element of listable.filter((e) => types.includes(e.type))) {
        const hidden = element.sheet?.display === false;
        if (def.omitHidden) {
          if (hidden && shown.has(element.id)) hiddenShown.push(`${sample.id} ${def.label}: ${element.name}`);
          if (hidden) tally(omittedBySection, def.label);
          if (!hidden && !shown.has(element.id)) missingWhereNotOmitted.push(`${sample.id} ${def.label}: ${element.name}`);
        } else if (!shown.has(element.id)) {
          (hidden ? hiddenWhereNotOmitted : missingWhereNotOmitted).push(`${sample.id} ${def.label}: ${element.name}`);
        }
      }
    }

    // Packed and reopened with no source: the save's embedded elements carry every description (ADR 0012).
    const packed = packCharacter(state.character, run.system, run.elements, { generator: 'test', extraIds: run.imported.extraIds });
    const { container } = readCharacterContainer(packed.files);
    const reopened = new CharacterBuilder(container!.character, run.system, new BundleElementIndex(container!.content.elements)).getState();
    const hints = (s: BuilderState): string => JSON.stringify(listedOf(s));
    if (hints(reopened) !== hints(state)) offline.push(sample.id);
  }

  t.diagnostic(`listed elements over the samples, creatures' included: ${listed}; with sheet text: ${withText}; hints shown: ${show(shownHints)}`);
  t.diagnostic(`hidden elements a section leaves out, by section: ${show(omittedBySection)}`);
  t.diagnostic(`placeholders nothing publishes, by stat: ${show(unfilled)}`);
  t.diagnostic(`hidden elements listed anyway whose sheet text is withheld, by section: ${show(withheld)}`);
  assert.ok(system && listed > 0, 'the samples listed nothing');
  assert.deepEqual(wrongText, [], 'a text is not the one the raw XML gives at its gate level');
  assert.deepEqual(leftBraces, [], 'a shown hint keeps a placeholder');
  assert.deepEqual(wronglyUnfilled, [], 'a placeholder is written as a dash for a stat the derivation publishes');
  assert.deepEqual(hiddenWhereNotOmitted, [], 'a hidden element left a section that does not declare omitHidden');
  assert.deepEqual(hiddenShown, [], 'a section that declares omitHidden lists a hidden element');
  assert.deepEqual(missingWhereNotOmitted, [], 'a section left out an element that is not hidden');
  assert.deepEqual(offline, [], 'the hints differ once the sample is packed and reopened with no source');
});
