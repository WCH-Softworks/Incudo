/**
 * What a PDF character sheet could be filled from, measured before deciding what a PDF export adds to printing.
 *
 * Phase 5's PDF item reads "fillable official sheet + a clean Incudo sheet". A clean sheet is the print layout (ADRs
 * 0077, 0078) saved as PDF, which the platform's dialog already does. The official sheet is a different thing: a form
 * of fixed boxes, published by Wizards of the Coast. This asks how much of that form the sheet document
 * (`sheetDocument`, ADR 0075) could fill, character by character, over the thirty samples (found with `samplesWhere`),
 * and what each other kind's document has, since no official form exists for them.
 *
 * **The form is described here, not read.** The 2014 fillable sheet (`dnd_5e_charactersheet_formfillable.pdf` on D&D
 * Beyond's character sheet page, its notice "Permission is granted to photocopy this document for personal use") was
 * read once, by hand, outside the repository: 334 fields, 210 text and 124 check boxes, three US Letter pages, Helvetica
 * at automatic size, no XFA. It is not committed and nothing here downloads it. `OFFICIAL_2014` below lists its boxes in
 * this file's own words, with how many fields each has and the size of the large ones, so the test runs with no copy of
 * it anywhere. The 2024 sheet on the same page has no form fields at all (read the same way), so it has no list.
 *
 * Each box is one of three things for a character:
 *
 * - **filled**: the document holds a value for it, for this character.
 * - **empty**: the document would fill it, and this character has nothing there (no alignment chosen, no spells).
 * - **not in the document**: nothing the Sheet shows says it. Where the character or its derivation does hold it (the
 *   an imported save's personality text, the prepared lists), the report says so: those are things a
 *   form export would have to read from outside the document, which ADR 0075 decision 1 rules out for every renderer.
 *
 * And where the form's shape does not fit: a level with more spells than the form has lines, a second casting block on
 * a form with one, more than three weapons, and how many characters each large box would be asked to hold against what
 * it can (an estimate: Helvetica averages about half an em a character, at 7 pt with 8 pt lines, the size below which
 * the form's automatic sizing stops being read comfortably on paper).
 *
 * Report-only (ADR 0042): `ℹ` lines, nothing asserted but that every sample was read. Written for ADR 0079.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { BundleElementIndex, resolveCharacterKind, type ElementIndex } from '@incudo/core';
import {
  CharacterBuilder,
  listedName,
  listedUsage,
  newCharacterOfKind,
  sheetDocument,
  type SheetDocument,
  type SheetSectionView,
} from '@incudo/ui';

import { runOracle, type OracleRun } from './aurora-oracle.ts';
import { loadShippedSystem } from './node-system.ts';
import { corpusProvenance, corpusSkip, realElements, savesSkip } from './real-data.ts';
import { samplePath, samplesWhere } from './sample-saves.ts';

type Diagnostic = { diagnostic: (s: string) => void };

const range = (values: number[]): string => {
  if (!values.length) return '—';
  const sorted = [...values].sort((a, b) => a - b);
  const lo = sorted[0]!;
  const hi = sorted[sorted.length - 1]!;
  return lo === hi ? String(lo) : `${lo} to ${hi} (median ${sorted[Math.floor(sorted.length / 2)]})`;
};

const ABILITIES = ['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma'];
const SKILLS = [
  'acrobatics', 'animal handling', 'arcana', 'athletics', 'deception', 'history', 'insight', 'intimidation',
  'investigation', 'medicine', 'nature', 'perception', 'performance', 'persuasion', 'religion', 'sleight of hand',
  'stealth', 'survival',
];

/** Spell lines the 2014 form has per spell level, cantrips first (100 in all); every levelled line has a prepared box. */
const SPELL_LINES = [8, 12, 13, 13, 13, 9, 9, 9, 7, 7];

/** A large multi-line box: its size in points, and about how many characters it holds at 7 pt. */
const box = (width: number, height: number): number => Math.floor(width / 3.5) * Math.floor(height / 8);

type Verdict = 'filled' | 'partial' | 'empty' | 'absent';

interface Box {
  page: 1 | 2 | 3;
  name: string;
  text: number;
  checks: number;
  /** Characters it holds at 7 pt, for the large boxes. */
  holds?: number;
  /** What the document gives it for this character; absent when the document never does. */
  read?: (d: Read) => Verdict;
}

/** What the boxes read: the document, and the derivation only to say what the document leaves out. */
interface Read {
  doc: SheetDocument;
  section: (id: string) => SheetSectionView | undefined;
  row: (id: string, stat: string) => string | undefined;
  /** Whether the section lists an element of one of these types (read from the index only to name the type). */
  lists: (id: string, types: string[]) => boolean;
  /** What does not fit the form's shape for this character, by box name. */
  partial: Set<string>;
}

const rowsFilled = (d: Read, id: string, stats: string[]): Verdict =>
  stats.every((s) => d.row(id, s) !== undefined) ? 'filled' : 'absent';
const listed = (d: Read, id: string): Verdict => ((d.section(id)?.elements.length ?? 0) > 0 ? 'filled' : 'empty');
const ofType = (d: Read, types: string[]): Verdict => (d.lists('identity', types) ? 'filled' : 'empty');
/** A verdict downgraded to `partial` where the form's shape does not fit this character. */
const fit = (d: Read, name: string, v: Verdict): Verdict => (v === 'filled' && d.partial.has(name) ? 'partial' : v);

/** The 2014 fillable sheet's boxes, in this file's words. Field counts sum to the form's 210 text and 124 check boxes. */
const OFFICIAL_2014: Box[] = [
  { page: 1, name: 'character name', text: 1, checks: 0, read: (d) => (d.doc.name.trim() ? 'filled' : 'empty') },
  { page: 1, name: 'class and level', text: 1, checks: 0, read: (d) => fit(d, 'class and level', d.lists('identity', ['Class']) && d.row('combat', 'level') ? 'filled' : 'absent') },
  { page: 1, name: 'background', text: 1, checks: 0, read: (d) => ofType(d, ['Background']) },
  { page: 1, name: 'player name', text: 1, checks: 0 },
  { page: 1, name: 'race', text: 1, checks: 0, read: (d) => ofType(d, ['Race']) },
  { page: 1, name: 'alignment', text: 1, checks: 0, read: (d) => ofType(d, ['Alignment']) },
  { page: 1, name: 'experience points', text: 1, checks: 0 },
  { page: 1, name: 'inspiration', text: 1, checks: 0 },
  { page: 1, name: 'ability scores and modifiers', text: 12, checks: 0, read: (d) => (d.section('abilities')?.rows.every((r) => r.beside) ? 'filled' : 'absent') },
  { page: 1, name: 'proficiency bonus', text: 1, checks: 0, read: (d) => rowsFilled(d, 'combat', ['proficiency']) },
  { page: 1, name: 'saving throws', text: 6, checks: 0, read: (d) => rowsFilled(d, 'saves', ABILITIES.map((a) => `${a}:save`)) },
  { page: 1, name: 'saving throw proficiency marks', text: 0, checks: 6, read: (d) => (d.section('saves')?.rows.some((r) => r.mark) ? 'filled' : 'empty') },
  { page: 1, name: 'skills', text: 18, checks: 0, read: (d) => rowsFilled(d, 'skills', SKILLS) },
  { page: 1, name: 'skill proficiency marks', text: 0, checks: 18, read: (d) => (d.section('skills')?.rows.some((r) => r.mark) ? 'filled' : 'empty') },
  { page: 1, name: 'passive Perception', text: 1, checks: 0, read: (d) => rowsFilled(d, 'senses', ['perception:passive']) },
  { page: 1, name: 'armour class, initiative, speed', text: 3, checks: 0, read: (d) => rowsFilled(d, 'combat', ['ac', 'initiative', 'speed']) },
  { page: 1, name: 'hit point maximum', text: 1, checks: 0, read: (d) => rowsFilled(d, 'combat', ['hp']) },
  { page: 1, name: 'current and temporary hit points', text: 2, checks: 0 },
  { page: 1, name: 'hit dice', text: 2, checks: 0 },
  { page: 1, name: 'death saves', text: 0, checks: 6 },
  { page: 1, name: 'personality, ideals, bonds, flaws', text: 4, checks: 0 },
  { page: 1, name: 'three weapons: name', text: 3, checks: 0, read: (d) => (['primary', 'secondary'].some((s) => (d.row('worn', s) ?? 'none') !== 'none') ? 'filled' : 'empty') },
  { page: 1, name: 'three weapons: attack bonus and damage', text: 6, checks: 0 },
  { page: 1, name: 'attacks and spellcasting', text: 1, checks: 0, holds: box(166, 113) },
  { page: 1, name: 'coins', text: 5, checks: 0 },
  { page: 1, name: 'equipment', text: 1, checks: 0, holds: box(120, 163), read: (d) => listed(d, 'inventory') },
  { page: 1, name: 'other proficiencies and languages', text: 1, checks: 0, holds: box(166, 129), read: (d) => fit(d, 'other proficiencies and languages', listed(d, 'proficiencies')) },
  { page: 1, name: 'features and traits', text: 1, checks: 0, holds: box(166, 369), read: (d) => fit(d, 'features and traits', listed(d, 'features')) },
  { page: 2, name: 'character name (again)', text: 1, checks: 0, read: (d) => (d.doc.name.trim() ? 'filled' : 'empty') },
  { page: 2, name: 'age, height, weight, eyes, skin, hair', text: 6, checks: 0 },
  { page: 2, name: 'portrait', text: 0, checks: 1 },
  { page: 2, name: 'allies and organisations, faction name, faction symbol', text: 2, checks: 1 },
  { page: 2, name: 'backstory', text: 1, checks: 0, holds: box(164, 370) },
  { page: 2, name: 'additional features and traits', text: 1, checks: 0, holds: box(353, 205) },
  { page: 2, name: 'treasure', text: 1, checks: 0, holds: box(353, 152) },
  { page: 3, name: 'spellcasting class, ability, save DC, attack bonus', text: 4, checks: 0, read: (d) => fit(d, 'spellcasting class, ability, save DC, attack bonus', d.doc.sections.some((s) => s.id.startsWith('spellcasting')) ? 'filled' : 'empty') },
  { page: 3, name: 'spell slots per level', text: 9, checks: 0, read: (d) => (d.doc.sections.some((s) => s.id.includes('slots') && s.rows.length) ? 'filled' : 'empty') },
  { page: 3, name: 'slots expended per level', text: 9, checks: 0 },
  { page: 3, name: 'spells, by level', text: 100, checks: 0, read: (d) => fit(d, 'spells, by level', listed(d, 'spells')) },
  { page: 3, name: 'spell prepared marks', text: 0, checks: 92 },
];

test('the 2014 fillable sheet as listed here has the form\'s 334 fields', () => {
  assert.equal(OFFICIAL_2014.reduce((n, b) => n + b.text, 0), 210);
  assert.equal(OFFICIAL_2014.reduce((n, b) => n + b.checks, 0), 124);
  assert.equal(SPELL_LINES.reduce((a, b) => a + b, 0), 100);
});

/** Characters a listed section would write into a box: names, usage and sheet lines, one line each. */
function listedChars(section: SheetSectionView | undefined): number {
  if (!section) return 0;
  let n = 0;
  for (const e of section.elements) {
    n += listedName(e).length + (listedUsage(e)?.length ?? 0) + 2;
    if (e.text) n += e.text.replace(/<[^>]*>/g, '').length;
  }
  for (const r of section.rows) n += r.label.length + r.value.length + 2;
  return n;
}

/** Text the document would write that Helvetica's WinAnsi encoding cannot (the form's font, unembedded). */
function outsideWinAnsi(doc: SheetDocument): Set<string> {
  // WinAnsi is Latin-1 plus these, at 0x80 to 0x9F.
  const extra = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ');
  const found = new Set<string>();
  const scan = (s: string | undefined) => {
    for (const ch of s ?? '') {
      const c = ch.codePointAt(0)!;
      if ((c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff) || c === 0x0a || extra.has(ch)) continue;
      found.add(ch);
    }
  };
  scan(doc.title);
  for (const s of doc.sections) {
    for (const r of s.rows) scan(`${r.label}${r.value}${r.beside ?? ''}`);
    for (const e of s.elements) scan(`${listedName(e)}${listedUsage(e) ?? ''}${(e.text ?? '').replace(/<[^>]*>/g, '')}`);
    for (const p of s.printed) scan(`${p.label}${p.text}`);
  }
  return found;
}

interface SampleReading {
  id: string;
  verdicts: Map<string, Verdict>;
  fields: { filled: number; partial: number; empty: number; absent: number };
  blocks: number;
  overSpellLines: string[];
  unknownSpellLevels: number;
  weapons: number;
  multiclass: boolean;
  chars: Map<string, number>;
  freeformKeys: string[];
  prepared: number;
  proficiencyMarks: number;
  hasPortrait: boolean;
  outside: Set<string>;
}

function readSample(run: OracleRun, id: string, multiclass: boolean): SampleReading {
  const builder = new CharacterBuilder(run.imported.character, run.system, run.elements);
  const doc = sheetDocument(builder.getState());
  const section = (sid: string) => doc.sections.find((s) => s.id === sid);
  // Spells by level: the document lists names only, so the level is read from the element, which a form export could not.
  const perLevel = new Array<number>(10).fill(0);
  let unknownSpellLevels = 0;
  for (const e of section('spells')?.elements ?? []) {
    const level = Number(run.elements.get(e.elementId)?.setters.level?.value);
    if (Number.isInteger(level) && level >= 0 && level <= 9) perLevel[level]!++;
    else unknownSpellLevels++;
  }
  const overSpellLines = perLevel.flatMap((n, level) => (n > SPELL_LINES[level]! ? [`level ${level}: ${n} of ${SPELL_LINES[level]}`] : []));
  const blocks = doc.sections.filter((s) => s.id.startsWith('spellcasting')).length;

  const weapons = (section('inventory')?.elements ?? []).filter((e) => run.elements.get(e.elementId)?.type === 'Weapon').length;
  const chars = new Map<string, number>([
    ['features and traits', listedChars(section('features'))],
    ['other proficiencies and languages', listedChars(section('proficiencies'))],
    ['equipment', listedChars(section('inventory')) + listedChars(section('worn'))],
  ]);

  const partial = new Set<string>();
  if (multiclass) partial.add('class and level');
  if (blocks > 1) partial.add('spellcasting class, ability, save DC, attack bonus');
  if (overSpellLines.length) partial.add('spells, by level');
  for (const b of OFFICIAL_2014) if (b.holds && (chars.get(b.name) ?? 0) > b.holds) partial.add(b.name);

  const read: Read = {
    doc,
    section,
    row: (sid, stat) => section(sid)?.rows.find((r) => r.stat === stat)?.value,
    lists: (sid, types) => (section(sid)?.elements ?? []).some((e) => types.includes(run.elements.get(e.elementId)?.type ?? '')),
    partial,
  };
  const verdicts = new Map<string, Verdict>();
  const fields = { filled: 0, partial: 0, empty: 0, absent: 0 };
  for (const b of OFFICIAL_2014) {
    const v = b.read?.(read) ?? 'absent';
    verdicts.set(b.name, v);
    fields[v] += b.text + b.checks;
  }
  const stats = run.derived.stats;
  const proficiencyMarks = [...ABILITIES.map((a) => `${a}:save:proficiency`), ...SKILLS.map((s) => `${s}:proficiency`)].filter(
    (s) => (stats.get(s)?.value ?? 0) > 0,
  ).length;
  const character = run.imported.character;
  return {
    id,
    verdicts,
    fields,
    blocks,
    overSpellLines,
    unknownSpellLevels,
    weapons,
    multiclass,
    chars,
    freeformKeys: Object.keys(character.freeform ?? {}).filter((k) => (character.freeform[k] ?? '').trim() !== ''),
    prepared: Object.values(character.prepared ?? {}).reduce((n, list) => n + list.length, 0),
    proficiencyMarks,
    hasPortrait: Boolean(character.assets?.portrait),
    outside: outsideWinAnsi(doc),
  };
}

/** The importer's personal text, by what it is (its key's first word), and on how many samples. */
function freeformFamilies(readings: SampleReading[]): string {
  const family = (key: string): string => {
    if (key.startsWith('currency.')) return 'coins';
    if (key.startsWith('attacks.')) return 'attack notes';
    if (key.startsWith('background-') || /\.(Personality Trait|Ideal|Bond|Flaw)(\.\d+)?$/.test(key)) return 'personality, ideals, bonds, flaws';
    if (key.startsWith('background.feature.')) return 'background feature text';
    if (key.startsWith('list.')) return 'other background tables';
    return key;
  };
  const on = new Map<string, number>();
  for (const r of readings) for (const f of new Set(r.freeformKeys.map(family))) on.set(f, (on.get(f) ?? 0) + 1);
  return [...on].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([f, n]) => `${f} ${n}`).join(', ') || 'none';
}

test('the samples against the 2014 fillable sheet: what the sheet document fills, and where the form does not fit', { skip: corpusSkip || savesSkip }, async (t: Diagnostic) => {
  t.diagnostic(corpusProvenance());
  const elements = await realElements();
  const readings: SampleReading[] = [];
  for (const sample of samplesWhere(() => true)) {
    const run = await runOracle(samplePath(sample), elements, 'sample');
    readings.push(readSample(run, sample.id, sample.split.length > 1 || new Set(sample.split.map((s) => s.class)).size > 1));
  }
  assert.ok(readings.length > 0, 'samples were read');

  const n = readings.length;
  t.diagnostic(`${n} samples; form fields 334 (210 text, 124 check boxes)`);
  t.diagnostic(
    `fields per sample: filled ${range(readings.map((r) => r.fields.filled))}, filled in part (the form's shape does not fit) ${range(readings.map((r) => r.fields.partial))}, empty for that character ${range(readings.map((r) => r.fields.empty))}, ` +
      `not in the document ${range(readings.map((r) => r.fields.absent))}`,
  );
  for (const b of OFFICIAL_2014) {
    const counts = { filled: 0, partial: 0, empty: 0, absent: 0 };
    for (const r of readings) counts[r.verdicts.get(b.name)!]++;
    const verdict = counts.absent === n ? 'not in the document' : `filled ${counts.filled}${counts.partial ? `, in part ${counts.partial}` : ''}, empty ${counts.empty}${counts.absent ? `, not in the document ${counts.absent}` : ''}`;
    t.diagnostic(`page ${b.page} · ${b.name} (${b.text} text, ${b.checks} check): ${verdict}`);
  }

  t.diagnostic(`class and level: ${readings.filter((r) => r.multiclass).length} multiclass samples, whose levels per class the document does not hold (it has the character level and the class names)`);
  t.diagnostic(`casting blocks per sample (the form has one): ${range(readings.map((r) => r.blocks))}; samples with more than one ${readings.filter((r) => r.blocks > 1).length}`);
  const over = readings.filter((r) => r.overSpellLines.length);
  t.diagnostic(`spells: samples with a level holding more spells than the form has lines ${over.length}${over.length ? ` (${over.map((r) => `${r.id}: ${r.overSpellLines.join(', ')}`).join('; ')})` : ''}; spells with no level setter ${readings.reduce((a, r) => a + r.unknownSpellLevels, 0)}`);
  t.diagnostic(`spell levels are not in the document: the Spells section lists names, and filling the form by level reads each element`);
  t.diagnostic(`weapons carried per sample (the form has three lines) ${range(readings.map((r) => r.weapons))}; samples with more than three ${readings.filter((r) => r.weapons > 3).length}`);
  for (const b of OFFICIAL_2014.filter((x) => x.holds && x.read)) {
    const values = readings.map((r) => r.chars.get(b.name) ?? 0);
    t.diagnostic(`${b.name}: characters a sample would write ${range(values)}; the box holds about ${b.holds} at 7 pt; samples over it ${values.filter((v) => v > b.holds!).length}`);
  }
  t.diagnostic(`proficiency marks in the derivation per sample ${range(readings.map((r) => r.proficiencyMarks))}, which the document carries since ADR 0079 decision 6 (the form has 24 boxes for them); held outside the document: prepared spells recorded on ${readings.filter((r) => r.prepared).length} samples, ${range(readings.filter((r) => r.prepared).map((r) => r.prepared))} each; personal text (freeform) on ${readings.filter((r) => r.freeformKeys.length).length} samples, what it holds ${freeformFamilies(readings)}; a portrait on ${readings.filter((r) => r.hasPortrait).length}`);
  const outside = new Set(readings.flatMap((r) => [...r.outside]));
  t.diagnostic(`characters the form's font (Helvetica, WinAnsi, not embedded) cannot write: on ${readings.filter((r) => r.outside.size).length} samples, ${[...outside].map((c) => `U+${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`).join(' ') || 'none'}`);
});

test('the other kinds: no official form, and what the document gives a clean sheet', { skip: corpusSkip }, async (t: Diagnostic) => {
  t.diagnostic(corpusProvenance());
  const system = await loadShippedSystem('dnd5e');
  const elements = await realElements();
  for (const kindId of ['npc', 'legendary']) {
    const kind = resolveCharacterKind(system, kindId);
    const step = kind.buildSteps.find((s) => (s.required || s.pick) && s.types.length > 0 && !s.budget && !s.multiple)!;
    const sections: number[] = [];
    const ids = new Map<string, number>();
    const outside = new Set<string>();
    for (const creature of step.types.flatMap((type) => elements.byType(type))) {
      const builder = new CharacterBuilder(newCharacterOfKind(system, kindId), system, elements);
      builder.choose(`build/${step.id}`, [creature.id]);
      builder.setName(creature.name);
      const doc = sheetDocument(builder.getState());
      sections.push(doc.sections.length);
      for (const s of doc.sections) ids.set(s.id, (ids.get(s.id) ?? 0) + 1);
      for (const c of outsideWinAnsi(doc)) outside.add(c);
    }
    t.diagnostic(`${kind.name}: ${sections.length} sheets, sections each ${range(sections)}; ${[...ids].map(([id, c]) => `${id} ${c}`).join(', ')}`);
    t.diagnostic(`${kind.name}: characters outside WinAnsi ${[...outside].map((c) => `U+${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`).join(' ') || 'none'}`);
  }
  const cairn = await loadShippedSystem('cairn');
  const cairnKind = resolveCharacterKind(cairn, cairn.characterKinds[0]!.id);
  const index: ElementIndex = new BundleElementIndex([]);
  const doc = sheetDocument(new CharacterBuilder(newCharacterOfKind(cairn, cairnKind.id), cairn, index).getState());
  t.diagnostic(`Cairn ${cairnKind.name}: sections ${doc.sections.map((s) => `${s.id} (${s.rows.length} rows)`).join(', ')}`);
});
