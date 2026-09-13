/**
 * The elements parser, on the five constructs it used to walk straight past.
 *
 * All five were found by pointing the differential verification at real saves and then
 * counting what the corpus actually contains: 3,611 element-level `<supports>` blocks, 1,845
 * element-level `<requirements>`, 171 `<append>`, 79 `equipped=` attributes of which not
 * one is `"true"`, and 17 `<spellcasting><list>` children (ADR 0030). None were being read,
 * and the first of those meant no `<select supports="…">` had ever matched anything.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { declaredBlocks } from '@incudo/core';

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

test('a `<supports>` block is a comma-separated list, not one tag', () => {
  // The fifth construct, and the one that survived the other four being fixed: the blocks were
  // read and then stored whole. This is Acrobatics as the corpus actually writes it.
  const file = parse(`
    <element name="Acrobatics" type="Proficiency" id="ID_PROFICIENCY_SKILL_ACROBATICS">
      <supports>Skill,Dexterity,ID_PROFICIENCY_SKILL,ID_CLASS_ROGUE,Rogue, PHB24 Rogue</supports>
    </element>`);

  assert.deepEqual(file.elements[0]!.supports, [
    'Skill',
    'Dexterity',
    'ID_PROFICIENCY_SKILL',
    'ID_CLASS_ROGUE',
    'Rogue',
    // Trimmed, and the internal space kept: only commas separate.
    'PHB24 Rogue',
  ]);
});

test('the list form works inside `<rules>` too, and yields one rule per tag', () => {
  const file = parse(`
    <element name="Thing" type="Item" id="ID_THING">
      <rules><supports>Alpha, Beta</supports></rules>
    </element>`);

  const element = file.elements[0]!;
  assert.deepEqual(element.supports, ['Alpha', 'Beta']);
  assert.deepEqual(
    element.rules.filter((r) => r.kind === 'supports').map((r) => r.tag),
    ['Alpha', 'Beta'],
  );
});

test('splitting cannot lose a tag, because a joined one was never matchable', () => {
  // The argument that made this safe to change in a frozen package. `parseSupports` treats a
  // comma as AND, so a select's operand can never itself contain a comma — which means an
  // element tag containing one could not be matched by anything, ever. Splitting only adds
  // tags that were previously unreachable.
  const file = parse(`
    <element name="Skill" type="Proficiency" id="ID_S">
      <supports>Skill,Rogue</supports>
    </element>`);
  const tags = new Set(file.elements[0]!.supports.map((t) => t.toLowerCase()));

  assert.ok(tags.has('skill') && tags.has('rogue'));
  assert.ok(!tags.has('skill,rogue'), 'the joined form is gone, and nothing could have used it');
});

test('empty and whitespace-only entries are dropped rather than becoming blank tags', () => {
  const file = parse(`
    <element name="Thing" type="Item" id="ID_THING">
      <supports>Alpha,,  ,Beta,</supports>
    </element>`);
  assert.deepEqual(file.elements[0]!.supports, ['Alpha', 'Beta']);
});

// --- <spellcasting><list> — the fifth dropped construct (ADR 0030) -----------------------

test('a spellcasting block keeps its <list> child, which is not always its name', () => {
  const file = parse(`
    <element name="Spellcasting" type="Class Feature" id="ID_EK">
      <spellcasting name="Eldritch Knight" ability="Intelligence" allowReplace="true">
        <list>Wizard,(Abjuration||Evocation)</list>
      </spellcasting>
    </element>`);

  const [block] = file.elements[0]!.spellcasting!;
  assert.equal(block!.name, 'Eldritch Knight');
  assert.equal(block!.list, 'Wizard,(Abjuration||Evocation)');
});

test('a block with no <list> carries none rather than an empty string', () => {
  // 74 of the corpus's 91 named blocks are this shape, and the difference matters: an empty
  // string would resolve a "{list}" placeholder and shadow the fallback to the block's name.
  const file = parse(`
    <element name="Spellcasting" type="Class Feature" id="ID_CLERIC">
      <spellcasting name="Cleric" ability="Wisdom" prepare="true" />
    </element>`);
  assert.equal(file.elements[0]!.spellcasting![0]!.list, undefined);
});

test('the list reaches the neutral view of a block, where a filter can read it', () => {
  const file = parse(`
    <element name="Spellcasting" type="Class Feature" id="ID_AT">
      <spellcasting name="Arcane Trickster" ability="Intelligence">
        <list>Wizard,(Enchantment||Illusion)</list>
      </spellcasting>
    </element>`);
  const [block] = declaredBlocks(file.elements[0]!);
  assert.equal(block!.attributes['list'], 'Wizard,(Enchantment||Illusion)');
});
