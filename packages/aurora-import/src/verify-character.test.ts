/**
 * The differential verification, checked on its judgement rather than on its arithmetic.
 *
 * What matters here is the classification. A check that calls a missing book an engine bug
 * cries wolf; one that calls an engine bug a missing book is worse. Each test below pins one
 * of those calls.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  deriveCharacter,
  createCharacter,
  MapElementIndex,
  setChoice,
  type Character,
  type Element,
  type GameSystem,
} from '@incudo/core';
import { parseAuroraSave } from './parse-save.ts';
import { compareWithAurora, summarizeDifferences } from './verify-character.ts';

function element(id: string, type: string, rules: Element['rules'] = []): Element {
  return {
    id,
    type,
    name: id,
    source: 'Test',
    setters: {},
    rules,
    supports: [],
    origin: { sourceId: 'test', format: 'aurora' },
  };
}

function grant(id: string, key = 'grant-0'): Element['rules'][number] {
  return { kind: 'grant', key, type: '', id };
}

/** An element declaring one named block, which is what `blockStats` iterates (ADR 0020). */
function caster(id: string, blockName: string, ability: string): Element {
  return { ...element(id, 'Feature'), spellcasting: [{ name: blockName, ability }] };
}

const SYSTEM: GameSystem = {
  formatVersion: 1,
  id: 'test',
  name: 'Test',
  version: '1.0.0',
  elementTypes: [{ name: 'Thing' }, { name: 'Item' }, { name: 'Feature' }],
  stats: [
    { name: 'wisdom', default: 10 },
    { name: 'wisdom:modifier', derive: { kind: 'number', value: 2 } },
    { name: 'proficiency', default: 3 },
  ],
  characterKinds: [
    {
      id: 'pc',
      name: 'PC',
      default: true,
      progression: { kind: 'none' },
      elementTypes: ['Thing', 'Item', 'Feature'],
      buildSteps: [{ id: 'b', label: 'B', types: ['Thing'] }],
      // ADR 0020: the DC the verifier compares is one the *system* publishes. Writing it
      // out here is the point — the test system says 8 + proficiency + the block's ability
      // modifier, and the verifier reads whatever comes out rather than recomputing it.
      blockStats: [
        {
          stat: '{name}:spellcasting:dc',
          value: {
            kind: 'binary',
            op: '+',
            left: { kind: 'number', value: 8 },
            right: {
              kind: 'binary',
              op: '+',
              left: { kind: 'ref', stat: 'proficiency' },
              right: { kind: 'ref', stat: '{ability}:modifier' },
            },
          },
        },
        {
          stat: '{name}:spellcasting:attack',
          value: {
            kind: 'binary',
            op: '+',
            left: { kind: 'ref', stat: 'proficiency' },
            right: { kind: 'ref', stat: '{ability}:modifier' },
          },
        },
      ],
      sheet: { sections: [{ id: 's', label: 'S', types: ['Thing'] }] },
    },
  ],
};

function saveXml(body: { sum: string[]; equipment?: string[]; magic?: string }): string {
  const items = (body.equipment ?? [])
    .map((id) => `<item identifier="u" name="i" id="${id}" />`)
    .join('');
  return `<character version="1.0.3"><build>
    <elements level-count="1">
      <element type="Thing" name="Pick" requiredLevel="1" checksum="x" registered="ID_PICKED" />
      ${body.sum.map((id) => `<element type="Thing" name="${id}" id="${id}" />`).join('')}
    </elements>
    <equipment>${items}</equipment>
    <sum element-count="${body.sum.length}">
      ${body.sum.map((id) => `<element type="Thing" id="${id}" />`).join('')}
    </sum>
    <magic>${body.magic ?? ''}</magic>
  </build></character>`;
}

function derive(character: Character, index: MapElementIndex) {
  return deriveCharacter(character, SYSTEM, index);
}

function picked(): Character {
  return setChoice(createCharacter('test', 'pc'), 'build/thing', ['ID_PICKED']);
}

test('agreement is agreement', () => {
  const index = new MapElementIndex();
  index.addAll([element('ID_PICKED', 'Thing')]);
  const save = parseAuroraSave(saveXml({ sum: ['ID_PICKED'] }));

  const result = compareWithAurora(save, derive(picked(), index), { index });
  assert.deepEqual(result.differences, []);
  assert.equal(result.mismatches, 0);
  assert.equal(result.agrees, true);
});

test('a grant that did not fire is a real difference — the case worth catching', () => {
  const index = new MapElementIndex();
  // The corpus has both, but nothing grants the second, so Incudo never reaches it.
  index.addAll([element('ID_PICKED', 'Thing'), element('ID_EXPECTED', 'Thing')]);
  const save = parseAuroraSave(saveXml({ sum: ['ID_PICKED', 'ID_EXPECTED'] }));

  const result = compareWithAurora(save, derive(picked(), index), { index });
  assert.equal(result.mismatches, 1);
  assert.equal(result.differences[0]!.kind, 'element-missing');
  assert.equal(result.differences[0]!.elementId, 'ID_EXPECTED');
});

test('a gate that should have held and did not is caught too, and names the granter', () => {
  const index = new MapElementIndex();
  index.addAll([element('ID_PICKED', 'Thing', [grant('ID_UNEXPECTED')]), element('ID_UNEXPECTED', 'Thing')]);
  const save = parseAuroraSave(saveXml({ sum: ['ID_PICKED'] }));

  const result = compareWithAurora(save, derive(picked(), index), { index });
  assert.equal(result.mismatches, 1);
  const [difference] = result.differences;
  assert.equal(difference!.kind, 'element-extra');
  // The granter is what makes the line actionable: every extra across the eight sample
  // saves turned out to be a grant added upstream after the save was written.
  assert.ok(difference!.message.includes('ID_PICKED'), difference!.message);
});

test('a book that is not loaded is a fact about sources, not an engine failure', () => {
  const index = new MapElementIndex();
  index.addAll([element('ID_PICKED', 'Thing')]);
  const save = parseAuroraSave(saveXml({ sum: ['ID_PICKED', 'ID_FROM_A_BOOK_NOT_LOADED'] }));

  const result = compareWithAurora(save, derive(picked(), index), { index });
  assert.equal(result.mismatches, 0, 'reported, not counted');
  assert.equal(result.agrees, true);
  assert.equal(result.differences[0]!.kind, 'content-missing');
});

test('an absence is explained by its ancestor, so one missing book is one report', () => {
  const index = new MapElementIndex();
  // ID_CHILD and ID_GRANDCHILD are in the corpus; the thing that would grant them is not.
  index.addAll([
    element('ID_PICKED', 'Thing'),
    element('ID_CHILD', 'Thing'),
    element('ID_GRANDCHILD', 'Thing'),
  ]);
  const save = parseAuroraSave(`<character version="1.0.3"><build>
    <elements level-count="1">
      <element type="Thing" name="Pick" requiredLevel="1" checksum="x" registered="ID_PICKED" />
      <element type="Thing" name="Missing" id="ID_NOT_LOADED">
        <element type="Thing" name="Child" id="ID_CHILD">
          <element type="Thing" name="Grandchild" id="ID_GRANDCHILD" />
        </element>
      </element>
    </elements>
    <sum element-count="4">
      <element type="Thing" id="ID_PICKED" /><element type="Thing" id="ID_NOT_LOADED" />
      <element type="Thing" id="ID_CHILD" /><element type="Thing" id="ID_GRANDCHILD" />
    </sum>
  </build></character>`);

  const result = compareWithAurora(save, derive(picked(), index), { index });
  assert.equal(result.mismatches, 0, 'all three trace back to one absent element');
  assert.equal(summarizeDifferences(result).get('content-missing'), 3);
  assert.ok(
    result.differences.find((d) => d.elementId === 'ID_GRANDCHILD')!.message.includes('ID_NOT_LOADED'),
    'and the report says which ancestor',
  );
});

test('what an item brought is not compared, because there is no inventory yet', () => {
  const index = new MapElementIndex();
  index.addAll([
    element('ID_PICKED', 'Thing'),
    element('ID_ITEM', 'Item', [grant('ID_ITEM_EFFECT')]),
    element('ID_ITEM_EFFECT', 'Thing'),
  ]);
  const save = parseAuroraSave(
    saveXml({ sum: ['ID_PICKED', 'ID_ITEM', 'ID_ITEM_EFFECT'], equipment: ['ID_ITEM'] }),
  );

  const result = compareWithAurora(save, derive(picked(), index), { index });
  assert.equal(result.mismatches, 0);
  // Both the item and what it granted — the closure, not just the id in the bag.
  assert.equal(summarizeDifferences(result).get('not-modelled'), 2);
});

test('the save DC compared is the one the system published, not one the check invented', () => {
  const index = new MapElementIndex();
  index.addAll([element('ID_PICKED', 'Thing', [grant('ID_CASTER')]), caster('ID_CASTER', 'C', 'Wisdom')]);
  // The system publishes c:spellcasting:dc as 8 + proficiency 3 + wisdom modifier 2 = 13,
  // and c:spellcasting:attack as 5. Aurora says 15 and 7.
  const save = parseAuroraSave(
    saveXml({
      sum: ['ID_PICKED', 'ID_CASTER'],
      magic: '<spellcasting name="C" ability="Wisdom" dc="15" attack="7" source="ID_CASTER" />',
    }),
  );

  const derived = derive(picked(), index);
  assert.equal(derived.stats.get('c:spellcasting:dc')?.value, 13, 'the stat exists at all');
  assert.equal(derived.stats.get('c:spellcasting:attack')?.value, 5);

  const result = compareWithAurora(save, derived, { index });
  const stat = result.differences.filter((d) => d.kind === 'stat-mismatch');
  assert.equal(stat.length, 2, 'the DC and the attack bonus');
  assert.equal(stat[0]!.expected, 15);
  assert.equal(stat[0]!.actual, 13);
});

test('a block declaring no ability publishes nothing, and says so', () => {
  const index = new MapElementIndex();
  const extension: Element = {
    ...element('ID_CASTER', 'Feature'),
    spellcasting: [{ name: 'C' }],
  };
  index.addAll([element('ID_PICKED', 'Thing', [grant('ID_CASTER')]), extension]);

  const derived = derive(picked(), index);
  assert.equal(derived.stats.get('c:spellcasting:dc'), undefined);
  // Reported rather than silently skipped: a caster with no DC on the sheet should be able
  // to find out why without reading the engine.
  assert.ok(
    derived.problems.some(
      (p) => p.code === 'unresolved-interpolation' && p.message.includes('{ability}:modifier'),
    ),
    JSON.stringify(derived.problems),
  );
});

test('a DC the bag contributes to is not compared, because the two numbers differ honestly', () => {
  const index = new MapElementIndex();
  index.addAll([
    element('ID_PICKED', 'Thing', [grant('ID_CASTER')]),
    caster('ID_CASTER', 'C', 'Wisdom'),
    element('ID_TOME', 'Item', [
      { kind: 'stat', key: 'stat-0', name: 'wisdom', value: { kind: 'number', value: 2 } },
    ]),
  ]);
  const save = parseAuroraSave(
    saveXml({
      sum: ['ID_PICKED', 'ID_CASTER'],
      equipment: ['ID_TOME'],
      magic: '<spellcasting name="C" ability="Wisdom" dc="15" attack="7" source="ID_CASTER" />',
    }),
  );

  const result = compareWithAurora(save, derive(picked(), index), { index });
  assert.equal(result.mismatches, 0);
  assert.ok(
    result.differences.some((d) => d.kind === 'not-modelled' && d.elementId === 'ID_TOME'),
    'and it names the item responsible',
  );
});

test('spell slots stay a note when no loaded system declares a table', () => {
  const index = new MapElementIndex();
  index.addAll([element('ID_PICKED', 'Thing'), element('ID_CASTER', 'Feature')]);
  const save = parseAuroraSave(
    saveXml({
      sum: ['ID_PICKED'],
      magic:
        '<spellcasting name="C" ability="Wisdom" source="ID_CASTER"><slots s1="4" s2="2" /></spellcasting>',
    }),
  );

  const result = compareWithAurora(save, derive(picked(), index), { index });
  assert.equal(result.mismatches, 0);
  assert.equal(summarizeDifferences(result).get('not-modelled'), 1);
});

// --- spell slots (ADR 0018) -------------------------------------------------

/**
 * A system that publishes slots, with the three stats the comparison asks about supplied as
 * plain defaults. What produces them in `systems/dnd5e` is a table indexed by a caster level
 * that `trackStats` assembles; what is under test here is the *choice between pools*, so the
 * numbers are handed over directly.
 */
function slotSystem(stats: Record<string, number>): GameSystem {
  return {
    ...SYSTEM,
    stats: [
      ...SYSTEM.stats,
      ...Object.entries(stats).map(([name, value]) => ({ name, default: value })),
    ],
  };
}

function deriveWith(system: GameSystem, index: MapElementIndex) {
  return deriveCharacter(picked(), system, index);
}

function casterSave(slots: string): ReturnType<typeof parseAuroraSave> {
  return parseAuroraSave(
    saveXml({
      sum: ['ID_PICKED'],
      magic: `<spellcasting name="Warlock" ability="Wisdom" source="ID_CASTER">${slots}</spellcasting>`,
    }),
  );
}

function casterIndex(): MapElementIndex {
  const index = new MapElementIndex();
  index.addAll([element('ID_PICKED', 'Thing'), element('ID_CASTER', 'Feature')]);
  return index;
}

test('a class table the system publishes is compared, and agreeing is silent', () => {
  const system = slotSystem({ 'warlock:spellcasting:slots:1': 4, 'warlock:spellcasting:slots:2': 2 });
  const result = compareWithAurora(
    casterSave('<slots s1="4" s2="2" />'),
    deriveWith(system, casterIndex()),
    { index: casterIndex() },
  );
  assert.deepEqual(result.differences, []);
});

test('a class table that disagrees is a real mismatch, and says which pool it read', () => {
  const system = slotSystem({ 'warlock:spellcasting:slots:1': 4, 'warlock:spellcasting:slots:2': 4 });
  const result = compareWithAurora(
    casterSave('<slots s1="4" s2="2" />'),
    deriveWith(system, casterIndex()),
    { index: casterIndex() },
  );
  assert.equal(result.mismatches, 1);
  const [difference] = result.differences;
  assert.equal(difference!.kind, 'stat-mismatch');
  assert.equal(difference!.expected, '4/2/0/0/0/0/0/0/0');
  assert.equal(difference!.actual, '4/4/0/0/0/0/0/0/0');
  assert.ok(difference!.message.includes('its own class table'), difference!.message);
});

test('a caster level moves the comparison to the shared pool', () => {
  const system = slotSystem({
    'warlock:spellcasting:slots:1': 2,
    'spellcasting:slots:1': 4,
    'spellcasting:slots:2': 3,
  });
  const result = compareWithAurora(
    casterSave('<slots s1="4" s2="3" />'),
    deriveWith(system, casterIndex()),
    { index: casterIndex() },
  );
  assert.deepEqual(result.differences, [], 'the shared pool is what Aurora recorded');
});

test('a solo caster keeps its own table however large the shared pool is', () => {
  // Pact magic. Without the flag the two pools are indistinguishable and this would be
  // compared against 4/3, which is a different character's spell slots.
  const system = slotSystem({
    'warlock:spellcasting:slots:5': 4,
    'warlock:spellcasting:solo': 1,
    'spellcasting:slots:1': 4,
    'spellcasting:slots:2': 3,
  });
  const result = compareWithAurora(
    casterSave('<slots s5="4" />'),
    deriveWith(system, casterIndex()),
    { index: casterIndex() },
  );
  assert.deepEqual(result.differences, []);
});

test('the stat names are configuration, not knowledge of the game', () => {
  const system = slotSystem({ 'pool/warlock/1': 3 });
  const result = compareWithAurora(
    casterSave('<slots s1="3" />'),
    deriveWith(system, casterIndex()),
    {
      index: casterIndex(),
      stats: { slots: { own: (name, level) => `pool/${name.toLowerCase()}/${level}` } },
    },
  );
  assert.deepEqual(result.differences, [], 'and the other two keys keep their defaults');
});
