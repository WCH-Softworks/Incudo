/**
 * The elements parser, on the six constructs it used to walk straight past.
 *
 * All six were found by pointing the differential verification at real saves and then
 * counting what the corpus actually contains: 3,611 element-level `<supports>` blocks, 1,845
 * element-level `<requirements>`, 171 `<append>`, 79 `equipped=` attributes of which not
 * one is `"true"`, 17 `<spellcasting><list>` children (ADR 0030), and 346 `<select>`s whose
 * candidates are inline `<item>` text rather than element references (2,258 items — a
 * background's suggested Personality Trait, Ideal, Bond, Flaw, and similar). None were being
 * read; the first meant no `<select supports="…">` had ever matched anything, and the last
 * meant every one of those 346 selects offered nothing at all.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { declaredBlocks, candidatesFor, MapElementIndex, type SelectRule } from '@incudo/core';

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

test('a <select>\'s nested <item>s become elements, keyed off the owner and the select name', () => {
  const file = parse(`
    <element name="Acolyte" type="Background" id="ID_BACKGROUND_ACOLYTE" source="Player's Handbook">
      <rules>
        <select type="List" name="Ideal" number="1">
          <item id="1">Tradition. The ancient ways must be upheld.</item>
          <item id="2">Charity. I always try to help those in need.</item>
        </select>
      </rules>
    </element>`);

  // The select rule itself is unaffected — it still just names its type and number.
  // (Synthesized items land in `file.elements` ahead of their owner: `parseRules` pushes
  // them while parsing the owner's own rules, before the owner itself is pushed.)
  const owner = file.elements.find((e) => e.id === 'ID_BACKGROUND_ACOLYTE')!;
  assert.equal(owner.rules.length, 1);
  assert.equal(owner.rules[0]!.kind, 'select');

  const items = file.elements.filter((e) => e.id !== owner!.id);
  assert.equal(items.length, 2);
  assert.deepEqual(
    items.map((e) => e.id).sort(),
    ['ID_BACKGROUND_ACOLYTE/list:Ideal/1', 'ID_BACKGROUND_ACOLYTE/list:Ideal/2'],
  );
  const first = items.find((e) => e.id === 'ID_BACKGROUND_ACOLYTE/list:Ideal/1')!;
  assert.equal(first.type, 'List');
  assert.equal(first.name, 'Tradition. The ancient ways must be upheld.');
  assert.equal(first.source, "Player's Handbook", 'inherits the owner\'s source, not "Unknown"');
  assert.deepEqual(first.rules, [], 'flavor text, no mechanical effect');
});

test('two backgrounds\' "Ideal" pools do not leak into each other, though both share type List', () => {
  // Every one of the 346 `type="List"` selects in the corpus shares that one type and none
  // declares its own `supports=`, so `candidatesFor`'s plain `elements.byType("List")` would
  // return all 2,258 items from every background's table for any of them. A `supports` tag
  // scoped to (owner, select name) is what keeps Acolyte's Ideal pool from also offering
  // Noble's.
  const acolyte = parse(`
    <element name="Acolyte" type="Background" id="ID_BACKGROUND_ACOLYTE">
      <rules>
        <select type="List" name="Ideal" number="1">
          <item id="1">Tradition. The ancient ways must be upheld.</item>
        </select>
      </rules>
    </element>`);
  const noble = parse(`
    <element name="Noble" type="Background" id="ID_BACKGROUND_NOBLE">
      <rules>
        <select type="List" name="Ideal" number="1">
          <item id="1">Noblesse oblige. It is my duty to protect those beneath me.</item>
        </select>
      </rules>
    </element>`);

  const index = new MapElementIndex();
  for (const element of [...acolyte.elements, ...noble.elements]) index.add(element);

  const acolyteOwner = acolyte.elements.find((e) => e.id === 'ID_BACKGROUND_ACOLYTE')!;
  const acolyteIdeal = acolyteOwner.rules.find((r) => r.kind === 'select') as SelectRule;
  const candidates = candidatesFor(acolyteIdeal, index);

  assert.deepEqual(
    candidates.map((c) => c.id),
    ['ID_BACKGROUND_ACOLYTE/list:Ideal/1'],
    'only Acolyte\'s own Ideal, not Noble\'s, despite both being type List',
  );
});

test('an <item> with no id is reported rather than silently dropped', () => {
  const file = parse(`
    <element name="Acolyte" type="Background" id="ID_BACKGROUND_ACOLYTE">
      <rules>
        <select type="List" name="Ideal">
          <item>No id on this one.</item>
        </select>
      </rules>
    </element>`);
  assert.equal(file.elements.length, 1, 'nothing was synthesized for the id-less item');
  assert.equal(
    file.diagnostics.filter((d) => d.message.includes('has no id and was skipped')).length,
    1,
  );
});

test('an <item> with no text is reported rather than becoming a blank candidate', () => {
  const file = parse(`
    <element name="Acolyte" type="Background" id="ID_BACKGROUND_ACOLYTE">
      <rules>
        <select type="List" name="Ideal">
          <item id="1"></item>
        </select>
      </rules>
    </element>`);
  assert.equal(file.elements.length, 1);
  assert.equal(
    file.diagnostics.filter((d) => d.message.includes('has no text and was skipped')).length,
    1,
  );
});

test('an <item>\'s text survives inline markup, in order — Ghosts of Saltmarsh wraps a lead word', () => {
  // background-smuggler.xml wraps the lead word of each Ideal in <strong>, the one exception
  // to "plain text" the corpus has. `.text` only accumulates text nodes directly under
  // <item>, so it would silently drop anything inside the nested tag; `innerXml` is the raw,
  // order-preserving source, so stripping tags recovers the whole sentence in the right order.
  const file = parse(`
    <element name="Smuggler" type="Background" id="ID_BACKGROUND_SMUGGLER">
      <rules>
        <select type="List" name="Ideal">
          <item id="1"><strong>Wealth.</strong> Heaps of coins are the only true measure of success.</item>
        </select>
      </rules>
    </element>`);
  const item = file.elements.find((e) => e.id === 'ID_BACKGROUND_SMUGGLER/list:Ideal/1')!;
  assert.equal(item.name, 'Wealth. Heaps of coins are the only true measure of success.');
});
