/**
 * docs/SYSTEM-GUIDE.md cannot drift from the format: every code block in it is read here.
 *
 * A block's fence says what it is, after the language:
 *
 * - `json system`: a whole definition. It validates, with no warning, and later blocks may name it in `extends`.
 * - `json overlay`: a whole overlay of a shipped system or of an earlier block. It validates, with no warning.
 * - `json refused` / `json warns`: a whole definition or overlay that is refused, or that loads with warnings. The next block
 *   is `text problem`, and it is exactly what the app prints for it, a line per problem.
 * - `json slip`: text that is not JSON. The next block is `text problem`, the app's sentence for it.
 * - `json $defs/<name>`: a fragment, valid against that part of the schema.
 * - `xml content`: a content file. It parses with no diagnostic, and every element's type is declared by the guide's
 *   `json system` block.
 * - `text sheet`: what the Sheet reads for the character the guide builds from that system and that content.
 *
 * Any other `json` or `xml` block fails, so an example cannot slip in unread.
 *
 * Perturbations, each run and failing here: a fragment's field renamed; the worked example's Health formula naming
 * `mihgt`; a problem line in the guide edited; the content file's Calling typed `calling`; the sheet block edited.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { BundleElementIndex, readJsonText, validateGameSystem, validateJson, type Element, type GameSystem } from '@incudo/core';
import { parseAuroraElements } from '@incudo/aurora-import';
import { CharacterBuilder, describeSystemErrors, newCharacterOfKind, syntaxProblem, systemProblemLine } from '@incudo/ui';

import { loadSchemas, loadFixtureSystem, loadShippedSystem } from './node-system.ts';

const schemas = await loadSchemas();
const guide = await readFile(new URL('../../../docs/SYSTEM-GUIDE.md', import.meta.url), 'utf8');

interface Block {
  lang: string;
  tag: string;
  text: string;
  line: number;
}

const blocks: Block[] = [];
{
  const fence = /^```(\S*)[ \t]*([^\n]*)\r?\n([\s\S]*?)^```[ \t]*\r?$/gm;
  for (const match of guide.matchAll(fence)) {
    blocks.push({
      lang: match[1]!,
      tag: match[2]!.trim(),
      text: match[3]!.replace(/\r\n/g, '\n'),
      line: guide.slice(0, match.index).split('\n').length,
    });
  }
}

const known = new Map<string, GameSystem>();
for (const system of [await loadShippedSystem('dnd5e'), await loadFixtureSystem('cairn')]) known.set(system.id, system);

/** The lines the app prints for a definition's errors, or for its warnings when it loaded. */
function problemLines(text: string): { valid: boolean; errors: string[]; warnings: string[]; system?: GameSystem } {
  const parsed = readJsonText(text);
  assert.ok(parsed.ok, !parsed.ok ? parsed.message : '');
  const result = validateGameSystem(parsed.value, schemas, { parent: (id) => known.get(id) });
  const lines = (errors: typeof result.errors) =>
    describeSystemErrors(errors, parsed.value, parsed.positions, result.overlay).map(systemProblemLine);
  return { valid: result.valid, errors: lines(result.errors), warnings: lines(result.warnings), system: result.value };
}

const where = (block: Block) => `the ${block.lang} ${block.tag} block at docs/SYSTEM-GUIDE.md:${block.line}`;

test('every json and xml block in the guide says what it is', () => {
  assert.ok(blocks.length > 0);
  const allowed = /^(system|overlay|refused|warns|slip|\$defs\/[A-Za-z]+)$/;
  for (const block of blocks) {
    if (block.lang === 'json') assert.match(block.tag, allowed, where(block));
    if (block.lang === 'xml') assert.equal(block.tag, 'content', where(block));
    if (block.lang === 'text' && block.tag !== '') assert.match(block.tag, /^(problem|sheet)$/, where(block));
  }
});

test('every definition, overlay and fragment in the guide is what it says, and every problem line is what the app prints', () => {
  const schema = schemas.system as Parameters<typeof validateJson>[1];
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]!;
    if (block.lang !== 'json') continue;
    if (block.tag.startsWith('$defs/')) {
      const value = JSON.parse(block.text) as unknown;
      assert.deepEqual(validateJson(value, { $ref: `#/${block.tag}` }, { root: schema }), [], where(block));
      continue;
    }
    if (block.tag === 'slip') {
      const parsed = readJsonText(block.text);
      assert.equal(parsed.ok, false, `${where(block)} is JSON`);
      const next = blocks[i + 1];
      assert.ok(next && next.lang === 'text' && next.tag === 'problem', `${where(block)} is not followed by a text problem block`);
      if (!parsed.ok) assert.deepEqual(next.text.trimEnd().split('\n'), [systemProblemLine(syntaxProblem(parsed))], where(next));
      continue;
    }
    const got = problemLines(block.text);
    if (block.tag === 'system' || block.tag === 'overlay') {
      assert.deepEqual(got.errors, [], where(block));
      assert.deepEqual(got.warnings, [], where(block));
      if (block.tag === 'overlay') assert.ok(got.system?.extends, `${where(block)} is not an overlay`);
      else assert.equal(got.system?.extends, undefined, `${where(block)} is an overlay`);
      known.set(got.system!.id, got.system!);
      continue;
    }
    const next = blocks[i + 1];
    assert.ok(next && next.lang === 'text' && next.tag === 'problem', `${where(block)} is not followed by a text problem block`);
    const printed = next.text.trimEnd().split('\n');
    if (block.tag === 'refused') {
      assert.equal(got.valid, false, `${where(block)} validates`);
      assert.deepEqual(printed, got.errors, where(next));
    } else {
      assert.equal(got.valid, true, `${where(block)} is refused: ${got.errors.join('; ')}`);
      assert.ok(got.warnings.length > 0, `${where(block)} has no warning`);
      assert.deepEqual(printed, got.warnings, where(next));
    }
  }
});

test("the guide's worked example builds the character its sheet block shows, from its content block", () => {
  const systems = blocks.filter((b) => b.lang === 'json' && b.tag === 'system');
  const contents = blocks.filter((b) => b.lang === 'xml' && b.tag === 'content');
  const sheets = blocks.filter((b) => b.lang === 'text' && b.tag === 'sheet');
  assert.equal(systems.length, 1, 'the guide has one whole system, the worked example');
  assert.equal(contents.length, 1);
  assert.equal(sheets.length, 1);

  const system = validateGameSystem(JSON.parse(systems[0]!.text), schemas).value!;
  const parsed = parseAuroraElements(contents[0]!.text, { sourceId: 'guide', fileUrl: 'local:guide.xml' });
  assert.deepEqual(parsed.diagnostics, [], where(contents[0]!));
  const declared = new Set(system.elementTypes.map((t) => t.name));
  for (const element of parsed.elements) assert.ok(declared.has(element.type), `${element.id}'s type "${element.type}" is not declared`);

  // The recipe the guide gives in words: the 14, 12 and 10 with 14 on Might and 12 on Wits, then the first of each step.
  const kind = system.characterKinds.find((k) => k.default)!;
  const builder = new CharacterBuilder(newCharacterOfKind(system, kind.id), system, new BundleElementIndex(parsed.elements as Element[]));
  builder.setGenerationMethod('scores', 'array');
  builder.setBudgetStat('scores', 'might', 14);
  builder.setBudgetStat('scores', 'agility', 10);
  builder.setBudgetStat('scores', 'wits', 12);
  builder.confirmBudget('scores');
  for (const step of ['calling', 'traits', 'gear']) {
    const decision = builder.getState().decisions.find((d) => d.stepId === step);
    assert.ok(decision, `nothing to choose for ${step}`);
    builder.choose(decision.id, [decision.candidates[0]!]);
  }
  const state = builder.getState();
  assert.deepEqual(state.decisions, []);
  assert.deepEqual(state.derived.problems, []);
  const sheet = state.sheet.sections.map((section) =>
    `${section.label}: ${[
      ...section.rows.map((row) => `${row.label} ${row.value}${row.beside !== undefined ? ` (${row.beside})` : ''}`),
      ...section.elements.map((element) => element.name),
    ].join(', ')}`,
  );
  assert.deepEqual(sheets[0]!.text.trimEnd().split('\n'), sheet, where(sheets[0]!));
});
