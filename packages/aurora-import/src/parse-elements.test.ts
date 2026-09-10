/**
 * The elements parser, on the four constructs it used to walk straight past.
 *
 * All four were found by pointing the differential verification at real saves and then
 * counting what the corpus actually contains: 3,611 element-level `<supports>` blocks, 1,845
 * element-level `<requirements>`, 171 `<append>`, and 79 `equipped=` attributes of which not
 * one is `"true"`. None were being read, and the first of those meant no
 * `<select supports="…">` had ever matched anything.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseAuroraElements } from './parse-elements.ts';

const OPTIONS = { sourceId: 'test', fileUrl: 'test.xml' };

function parse(body: string) {
  return parseAuroraElements(`<elements>${body}</elements>`, OPTIONS);
}

test('`<supports>` beside `<rules>` is where the corpus actually puts it', () => {
  const file = parse(`
    <element name="Human Variant" type="Race Variant" id="ID_VARIANT">
      <supports>Human</supports>
      <supports>Variant</supports>
      <rules />
    </element>`);
  assert.deepEqual(file.elements[0]!.supports, ['Human', 'Variant']);
});

test('`<supports>` inside `<rules>` still works, so neither form silently stops matching', () => {
  const file = parse(`
    <element name="Thing" type="Thing" id="ID_THING">
      <supports>Outside</supports>
      <rules><supports>Inside</supports></rules>
    </element>`);
  assert.deepEqual(file.elements[0]!.supports.sort(), ['Inside', 'Outside']);
});

test('`<requirements>` on the element gates the element, not one of its rules', () => {
  const file = parse(`
    <element name="Human Variant" type="Race Variant" id="ID_VARIANT">
      <requirements>ID_INTERNAL_OPTION_ALLOW_FEATS</requirements>
      <rules />
    </element>`);
  assert.deepEqual(file.elements[0]!.requirements, {
    kind: 'has',
    id: 'ID_INTERNAL_OPTION_ALLOW_FEATS',
  });
});

test('an element with no requirements block has none, rather than an empty one', () => {
  const file = parse('<element name="Thing" type="Thing" id="ID_THING"><rules /></element>');
  assert.equal(file.elements[0]!.requirements, undefined);
});

test('`<append>` comes out unapplied, because its target may be in another file', () => {
  const file = parse(`
    <element name="Martial Ranged" type="Proficiency" id="ID_MARTIAL_RANGED"><rules /></element>
    <append id="ID_DECLARED_ELSEWHERE">
      <supports>Extra Tag</supports>
      <rules><grant type="Proficiency" id="ID_REVOLVER" /></rules>
    </append>`);

  assert.equal(file.elements.length, 1, 'an append is not an element');
  assert.equal(file.appends.length, 1);
  const [append] = file.appends;
  assert.equal(append!.id, 'ID_DECLARED_ELSEWHERE');
  assert.deepEqual(append!.supports, ['Extra Tag']);
  assert.equal(append!.rules.length, 1);
  assert.equal(append!.fileUrl, 'test.xml');
});

test('an `<append>` with no id is reported rather than dropped in silence', () => {
  const file = parse('<append><rules /></append>');
  assert.equal(file.appends.length, 0);
  assert.equal(file.diagnostics.filter((d) => d.message.includes('<append> has no id')).length, 1);
});

test('a file with nothing to append still reports an empty list, not undefined', () => {
  const file = parse('<element name="Thing" type="Thing" id="ID_THING"><rules /></element>');
  assert.deepEqual(file.appends, []);
});

test('a requirements expression that will not parse is an error naming the element', () => {
  const file = parse(`
    <element name="Thing" type="Thing" id="ID_BROKEN">
      <requirements>((((</requirements>
      <rules />
    </element>`);
  const errors = file.diagnostics.filter((d) => d.level === 'error');
  assert.equal(errors.length, 1);
  assert.equal(errors[0]!.elementId, 'ID_BROKEN');
});

test('`equipped=` is a condition, not a boolean — the corpus has 79 and none says "true"', () => {
  const file = parse(`
    <element name="Unarmored Defense" type="Class Feature" id="ID_UD">
      <rules>
        <stat name="ac:calculation" value="ac:unarmored defense barbarian"
              bonus="calculation" equipped="[armor:none]" />
        <grant type="Proficiency" id="ID_P" equipped="!([armor:heavy]||[shield:any])" />
      </rules>
    </element>`);
  const rules = file.elements[0]!.rules;
  const statRule = rules.find((r) => r.kind === 'stat')!;
  const grantRule = rules.find((r) => r.kind === 'grant')!;
  // Read as a boolean this was `false`, 79 times out of 79, and nothing read it either — so
  // every one of those rules applied unconditionally (ADR 0021).
  assert.deepEqual(statRule.equipped, { kind: 'equals', stat: 'armor', value: 'none' });
  assert.deepEqual(grantRule.equipped, {
    kind: 'not',
    child: {
      kind: 'or',
      children: [
        { kind: 'equals', stat: 'armor', value: 'heavy' },
        { kind: 'equals', stat: 'shield', value: 'any' },
      ],
    },
  });
});

test('a rule with no `equipped=` has none, rather than a false that reads like a decision', () => {
  const file = parse(`
    <element name="Thing" type="Thing" id="ID_THING">
      <rules><stat name="ac" value="1" /></rules>
    </element>`);
  const rule = file.elements[0]!.rules.find((r) => r.kind === 'stat')!;
  assert.equal(rule.equipped, undefined);
});
