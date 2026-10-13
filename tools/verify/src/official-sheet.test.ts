/**
 * "Fill the official sheet…": the 5e form map, every sample's values, and filling a form — ADR 0079 decisions 3 and 5.
 *
 * **No copy of the form is here, and nothing here downloads one.** The map (`systems/dnd5e/forms/official-2014.json`)
 * names the 2014 fillable sheet's fields, which describes the form and does not copy it; a stand-in form is built in this
 * file from that list alone (blank Letter pages, every field by name and type, no artwork) so the filler is exercised in
 * CI. A person with their own copy may point `INCUDO_OFFICIAL_SHEET` at it in `.env.local`, and the last test fills it
 * for every sample; with nothing named it is skipped, and named and missing it fails.
 *
 * What is asserted holds against any corpus (ADR 0042): every value is read back from the sample's own document, never
 * pinned. Counts are printed as `ℹ` lines.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PDFButton, PDFCheckBox, PDFDocument, PDFName, PDFString, PDFTextField, StandardFonts, decodePDFRawStream, type PDFRawStream } from 'pdf-lib';

import type { JsonSchema } from '@incudo/core';
import {
  CharacterBuilder,
  checkFormMap,
  diceTotal,
  formValues,
  listedName,
  recogniseForm,
  sheetDocument,
  type FormMap,
  type FormValues,
  type SheetDocument,
} from '@incudo/ui';

import { fillForm, readFormFields } from '@incudo/desktop/official-form';
import { runOracle } from './aurora-oracle.ts';
import { repoRoot } from './node-system.ts';
import { corpusProvenance, corpusSkip, officialSheetSkip, realElements, requireOfficialSheet, savesSkip } from './real-data.ts';
import { samplePath, samplesWhere } from './sample-saves.ts';

type Diagnostic = { diagnostic: (s: string) => void };

const readJson = (path: string): unknown => JSON.parse(readFileSync(join(repoRoot(), path), 'utf8'));
const schema = readJson('schemas/form-map.schema.json') as JsonSchema;
const raw = readJson('systems/dnd5e/forms/official-2014.json');

function shippedMap(): FormMap {
  const checked = checkFormMap(raw, schema);
  assert.deepEqual(checked.errors, []);
  return checked.value!;
}

const groupsRule = (map: FormMap) => map.fill.find((r) => 'groups' in r) as Extract<FormMap['fill'][number], { groups: unknown }>;

// The form's counts as ADR 0079 measured them (pdf-sheet.test.ts lists its boxes in its own words): 334 fields, 210 text
// and 124 boxes, two of which a PDF library reads as push buttons (the portrait and the faction symbol); 100 spell lines,
// 8 cantrips and 12, 13, 13, 13, 9, 9, 9, 7, 7 by level, and a prepared box on each of the 92 levelled ones.
test('the 5e form map checks, and describes the 2014 sheet as it was measured', () => {
  const map = shippedMap();
  const types = Object.values(map.fields);
  assert.equal(types.length, 334);
  assert.equal(types.filter((t) => t === 'text').length, 210);
  assert.equal(types.filter((t) => t === 'check').length, 122);
  assert.equal(types.filter((t) => t === 'button').length, 2);
  const levels = groupsRule(map).groups.levels;
  assert.deepEqual(Object.keys(levels), ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9']);
  assert.deepEqual(Object.values(levels).map((l) => l.lines.length), [8, 12, 13, 13, 13, 9, 9, 9, 7, 7]);
  assert.equal(levels['0']!.prepared, undefined);
  assert.equal(Object.values(levels).reduce((n, l) => n + (l.prepared?.length ?? 0), 0), 92);
  assert.deepEqual([map.system, map.kinds], ['dnd5e', ['pc']]);
  assert.match(map.download, /^https:\/\/www\.dndbeyond\.com\//);
});

/** What the document says the form should hold, worked out here from the document rather than through the map's rules. */
function expected(doc: SheetDocument, map: FormMap): { classLine: string; dice: string; marks: number; spells: number; placed: number; prepared: number; blocks: number } {
  const section = (id: string) => doc.sections.filter((s) => (s.section ?? s.id) === id);
  const classes = (section('identity')[0]?.elements ?? []).filter((e) => e.type === 'Class');
  const marks = [...section('saves'), ...section('skills')].flatMap((s) => s.rows).filter((r) => r.mark).length;
  const spells = section('spells')[0]?.elements ?? [];
  const levels = groupsRule(map).groups.levels;
  let placed = 0;
  let prepared = 0;
  const seen = new Map<string, number>();
  for (const spell of spells) {
    const level = spell.group?.value ?? '';
    const at = seen.get(level) ?? 0;
    seen.set(level, at + 1);
    if (levels[level] && at < levels[level]!.lines.length) {
      placed++;
      if (spell.prepared && levels[level]!.prepared) prepared++;
    }
  }
  return {
    classLine: classes.map((e) => listedName(e)).join(' / '),
    dice: diceTotal(classes.flatMap((e) => (e.dice ? [e.dice] : []))),
    marks,
    spells: spells.length,
    placed,
    prepared,
    blocks: section('spellcasting').length,
  };
}

interface SampleFill {
  id: string;
  doc: SheetDocument;
  values: FormValues;
}

let fills: Promise<SampleFill[]> | undefined;
function sampleFills(): Promise<SampleFill[]> {
  fills ??= (async () => {
    const map = shippedMap();
    const elements = await realElements();
    const out: SampleFill[] = [];
    for (const sample of samplesWhere(() => true)) {
      const run = await runOracle(samplePath(sample), elements, 'sample');
      const doc = sheetDocument(new CharacterBuilder(run.imported.character, run.system, run.elements).getState());
      out.push({ id: sample.id, doc, values: formValues(doc, map) });
    }
    return out;
  })();
  return fills;
}

test("every sample fills the form as its own sheet reads, and names what it leaves off", { skip: corpusSkip || savesSkip }, async (t: Diagnostic) => {
  t.diagnostic(corpusProvenance());
  const map = shippedMap();
  const all = await sampleFills();
  assert.ok(all.length > 0, 'samples were read');
  const notes = new Map<string, number>();
  const filled: number[] = [];
  for (const { id, doc, values } of all) {
    const want = expected(doc, map);
    assert.equal(values.text['CharacterName'], doc.name.trim(), `${id}: the name`);
    assert.equal(values.text['ClassLevel'], want.classLine, `${id}: class and level`);
    assert.equal(values.text['HDTotal'], want.dice, `${id}: hit dice`);
    // The check boxes are the save and skill marks and the prepared spells that have a line, and nothing else.
    assert.equal(values.checked.length, want.marks + want.prepared, `${id}: boxes ticked`);
    assert.equal(new Set(values.checked).size, values.checked.length, `${id}: no box ticked twice`);
    // Every spell is on a line of its level or counted in a note, never dropped silently.
    const leftSpells = values.leftOff.reduce((n, note) => n + (/^(\d+) of \d+ Spells \(/.exec(note) ? Number(/^(\d+)/.exec(note)![1]) : 0), 0);
    assert.equal(want.placed + leftSpells, want.spells, `${id}: spells placed or named`);
    // A second casting block is named, once each.
    const blockNotes = values.leftOff.filter((note) => note.startsWith('Spellcasting')).length;
    assert.equal(blockNotes, Math.max(0, want.blocks - 1), `${id}: casting blocks past the first`);
    // Only fields the form has, of the type written.
    for (const field of Object.keys(values.text)) assert.equal(map.fields[field], 'text', `${id}: ${field}`);
    for (const field of values.checked) assert.equal(map.fields[field], 'check', `${id}: ${field}`);
    filled.push(Object.keys(values.text).length + values.checked.length);
    for (const note of values.leftOff) {
      const kind = note.replace(/^\d+ of \d+ /, 'N of M ').replace(/\(Level \d\)/, '(Level n)');
      notes.set(kind, (notes.get(kind) ?? 0) + 1);
    }
  }
  // Features and Traits takes whole texts where they all fit and the lines otherwise (ADR 0114): both happen on the
  // samples. Fails if the rule's describe is dropped (no sample whole) or the fit check is (no sample with lines alone).
  const features = all.map(({ values }) => [values.text['Features and Traits'] ?? '', values.text['Feat+Traits'] ?? ''].join(' '));
  const whole = all.filter(({ doc }, i) => (doc.descriptions?.groups.find((g) => g.label === 'Features & Traits')?.entries ?? []).some((e) => features[i]!.includes(`${e.name}: `)));
  t.diagnostic(`Features and Traits written whole on ${whole.length} of ${all.length} samples: ${whole.map((s) => s.id).join(', ')}`);
  assert.ok(whole.length > 0 && whole.length < all.length, 'some samples fit whole and some do not');
  const sorted = [...filled].sort((a, b) => a - b);
  t.diagnostic(`${all.length} samples; fields filled ${sorted[0]} to ${sorted[sorted.length - 1]} (median ${sorted[Math.floor(sorted.length / 2)]}) of 334`);
  for (const [note, n] of [...notes].sort((a, b) => b[1] - a[1])) t.diagnostic(`left off on ${n} samples: ${note}`);
});

// --- filling a form ---------------------------------------------------------------------------------

/**
 * A stand-in for the form, built from the map's field list: three blank Letter pages, every field by name and type, the
 * large boxes multi-line, and junk typed into it, as a copy a user once filled in by hand would have.
 */
async function standIn(map: FormMap): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const pages = [pdf.addPage([612, 792]), pdf.addPage([612, 792]), pdf.addPage([612, 792])];
  const form = pdf.getForm();
  const multiline = new Set(map.fill.flatMap((r) => ('flow' in r ? r.flow.fields : [])));
  Object.entries(map.fields).forEach(([name, type], i) => {
    const page = pages[i % 3]!;
    const at = { x: 20 + (i % 10) * 58, y: 20 + Math.floor(i / 30) * 60, width: 50, height: multiline.has(name) ? 50 : 12 };
    if (type === 'text') {
      const field = form.createTextField(name);
      if (multiline.has(name)) field.enableMultiline();
      field.setText('typed by hand');
      field.addToPage(page, at);
    } else if (type === 'check') {
      const box = form.createCheckBox(name);
      box.addToPage(page, { ...at, width: 8, height: 8 });
      box.check();
    } else {
      form.createButton(name).addToPage(name, page, at);
    }
  });
  form.updateFieldAppearances(await pdf.embedFont(StandardFonts.Helvetica));
  // As on the 2014 sheet, most text fields have no default appearance of their own and inherit the form's, automatic
  // size: a filler that can only change a field's own size fails on them (found on a real copy, not on this stand-in).
  form.acroForm.dict.set(PDFName.of('DA'), PDFString.of('/Helv 0 Tf 0 g'));
  for (const field of form.getFields()) if (field instanceof PDFTextField) field.acroField.dict.delete(PDFName.of('DA'));
  return pdf.save();
}

/** A filled form read back: text by field, the ticked boxes, and whether every filled field has an appearance drawn. */
async function readBack(bytes: Uint8Array): Promise<{ text: Record<string, string>; checked: string[]; withoutAppearance: string[]; sizes: Record<string, number> }> {
  const pdf = await PDFDocument.load(bytes);
  const text: Record<string, string> = {};
  const checked: string[] = [];
  const withoutAppearance: string[] = [];
  const sizes: Record<string, number> = {};
  for (const field of pdf.getForm().getFields()) {
    if (field instanceof PDFTextField) {
      const value = field.getText();
      if (value) {
        text[field.getName()] = value;
        if (!field.acroField.getWidgets().every((w) => w.getNormalAppearance())) withoutAppearance.push(field.getName());
        const size = /([\d.]+) Tf/.exec(field.acroField.getDefaultAppearance() ?? '')?.[1];
        if (size !== undefined) sizes[field.getName()] = Number(size);
      }
    } else if (field instanceof PDFCheckBox && field.isChecked()) checked.push(field.getName());
  }
  return { text, checked: checked.sort(), withoutAppearance, sizes };
}

test('the stand-in form is recognised, a form of other fields is not, and filling it writes exactly the values', { skip: corpusSkip || savesSkip }, async (t: Diagnostic) => {
  const map = shippedMap();
  const form = await standIn(map);
  assert.deepEqual(recogniseForm(await readFormFields(form), map), { ok: true });
  // A form missing one field, or with a name's trailing space trimmed, is not the sheet.
  const trimmed = await PDFDocument.load(form);
  trimmed.getForm().removeField(trimmed.getForm().getTextField('Race '));
  trimmed.getForm().createTextField('Race').addToPage(trimmed.getPage(0), { x: 1, y: 1, width: 5, height: 5 });
  assert.equal(recogniseForm(await readFormFields(await trimmed.save()), map).ok, false);
  await assert.rejects(readFormFields(new TextEncoder().encode('not a pdf')), /could not be read as a PDF/);

  const all = await sampleFills();
  const before = createHash('sha256').update(form).digest('hex');
  for (const { id, values } of all) {
    const back = await readBack(await fillForm(form, values));
    // Fails if a field the character leaves empty keeps what was typed by hand, a value is changed on the way, a box
    // stays ticked or is not ticked, an appearance is not drawn, or a flow's size is not written.
    assert.deepEqual(back.text, values.text, `${id}: text`);
    assert.deepEqual(back.checked, [...values.checked].sort(), `${id}: boxes`);
    assert.deepEqual(back.withoutAppearance, [], `${id}: appearances`);
    for (const [field, size] of Object.entries(values.fontSizes)) if (values.text[field]) assert.equal(back.sizes[field], size, `${id}: ${field} size`);
  }
  assert.equal(createHash('sha256').update(form).digest('hex'), before, 'the copy filled is left as it was');
  t.diagnostic(`${all.length} samples filled into the stand-in and read back`);
});

/** How many lines a field's appearance draws, by its text-showing operators. */
function drawnLines(pdf: PDFDocument, field: PDFTextField): number {
  const ref = field.acroField.getWidgets()[0]!.getNormalAppearance();
  const stream = pdf.context.lookup(ref as never) as PDFRawStream;
  const content = Buffer.from(decodePDFRawStream(stream).decode()).toString('latin1');
  // pdf-lib writes each line as a hex string, `<…> Tj`.
  return (content.match(/\bTj\b/g) ?? []).length;
}

test('your own copy of the official sheet is recognised and filled for every sample, within its boxes', { skip: officialSheetSkip || corpusSkip || savesSkip }, async (t: Diagnostic) => {
  const map = shippedMap();
  const copy = new Uint8Array(readFileSync(requireOfficialSheet()));
  const before = createHash('sha256').update(copy).digest('hex');
  assert.deepEqual(recogniseForm(await readFormFields(copy), map), { ok: true });
  const flows = map.fill.flatMap((r) => ('flow' in r ? r.flow.fields.map((f, i) => ({ field: f, ...r.flow.capacity[i]! })) : []));
  const heights = new Map<string, number>();
  {
    const pdf = await PDFDocument.load(copy);
    for (const { field } of flows) heights.set(field, pdf.getForm().getTextField(field).acroField.getWidgets()[0]!.getRectangle().height);
  }
  let most = 0;
  for (const { id, values } of await sampleFills()) {
    const filled = await fillForm(copy, values);
    const back = await readBack(filled);
    assert.deepEqual(back.text, values.text, `${id}: text`);
    assert.deepEqual(back.checked, [...values.checked].sort(), `${id}: boxes`);
    assert.deepEqual(back.withoutAppearance, [], `${id}: appearances`);
    // What a flow put in a box is drawn within it: no more lines than fit its height at its size.
    const pdf = await PDFDocument.load(filled);
    for (const { field, fontSize } of flows) {
      if (!values.text[field]) continue;
      const lines = drawnLines(pdf, pdf.getForm().getTextField(field));
      const fit = Math.floor((heights.get(field)! - 2) / (fontSize * 1.15));
      most = Math.max(most, lines / fit);
      assert.ok(lines <= fit, `${id}: ${field} draws ${lines} lines, ${fit} fit`);
    }
    // Nothing a PDF library reads as a button is written to.
    for (const field of (await PDFDocument.load(filled)).getForm().getFields()) if (field instanceof PDFButton) assert.equal(values.text[field.getName()], undefined);
  }
  assert.equal(createHash('sha256').update(copy).digest('hex'), before, 'your copy is left as it was');
  t.diagnostic(`the fullest box drew ${Math.round(most * 100)}% of the lines it holds`);
});
