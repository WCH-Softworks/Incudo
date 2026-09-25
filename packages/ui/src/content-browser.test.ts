/**
 * Looking through what is loaded — ADR 0053.
 *
 * No game in the fixture: the types are the fixture system's, and "Book" is a publication only because the
 * system marks it. The official corpus is measured in `tools/verify/src/content-browser.test.ts`.
 *
 * Each test names the perturbation that fails it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { MapElementIndex, type Element, type ElementIndex, type ElementType, type GameSystem } from '@incudo/core';
import {
  ContentCatalog,
  contentCatalog,
  descriptionText,
  excerpt,
  fileWithinSource,
} from './content-browser.ts';

function element(id: string, type: string, name: string, extra: Partial<Element> = {}): Element {
  return {
    id,
    type,
    name,
    source: 'The Book',
    setters: {},
    rules: [],
    supports: [],
    origin: { sourceId: 'one', fileUrl: 'https://host/content/one/things.xml', format: 'incudo' },
    ...extra,
  };
}

const SYSTEM: GameSystem = {
  formatVersion: 1,
  id: 'test',
  name: 'Test',
  version: '1.0.0',
  elementTypes: [
    { name: 'Book', publication: true },
    { name: 'Gadget', plural: 'Gadgets', browsable: true },
    { name: 'Kit', plural: 'Kits', browsable: true },
    { name: 'Part', plural: 'Parts' },
  ],
  stats: [],
  characterKinds: [],
} as unknown as GameSystem;

function catalog(elements: Element[]): ContentCatalog {
  const index = new MapElementIndex();
  index.addAll(elements);
  return new ContentCatalog(index, SYSTEM);
}

const RANKED = [
  element('SPARK', 'Gadget', 'Spark', { description: '<p>Sets a small <b>fire</b>.</p>' }),
  element('BONFIRE', 'Gadget', 'Bonfire'),
  element('WALL', 'Gadget', 'Wall of Fire'),
  element('FIREBALL', 'Gadget', 'Fireball'),
  element('FIRE', 'Gadget', 'Fire'),
  element('FIRE_EMBER', 'Gadget', 'Ember'),
  element('SPELL_FIRE_BOLT', 'Gadget', 'Bolt'),
];

// Perturbations: sort the result by name alone; drop the word-start rank; make the id rank "includes".
test('a query ranks the exact name, then a prefix, a word start, every word, the id, and the description', () => {
  const result = catalog(RANKED).search({ text: 'Fire' });
  assert.deepEqual(
    result.rows.map((row) => [row.id, row.matched]),
    [
      ['FIRE', 'name'],
      ['FIREBALL', 'name'],
      ['WALL', 'name'],
      ['BONFIRE', 'name'],
      ['FIRE_EMBER', 'id'],
      ['SPARK', 'description'],
    ],
  );
  assert.equal(result.count, 6);
  // An id is found by typing it from its start: SPELL_FIRE_BOLT holds "fire" and is not a match.
  assert.ok(!result.rows.some((row) => row.id === 'SPELL_FIRE_BOLT'));
  assert.ok(catalog(RANKED).search({ text: 'spell_fire' }).rows.some((row) => row.id === 'SPELL_FIRE_BOLT'));
});

// Perturbation: bucket by rank alone (the order is then by name and label, and the undeclared row comes first).
test('within a rank, browsable types come first, then other declared types, then undeclared ones', () => {
  const result = catalog([
    element('ODD', 'Oddity', 'Rope'),
    element('PART', 'Part', 'Rope'),
    element('KIT', 'Kit', 'Rope'),
    element('KIT2', 'Kit', 'Rope ladder'),
  ]).search({ text: 'rope' });
  assert.deepEqual(result.rows.map((row) => row.id), ['KIT', 'PART', 'ODD', 'KIT2']);
});

// Perturbations: search the raw HTML (markup then matches); keep the words as one phrase.
test('every word must be present, in any order, and markup is neither a match nor a barrier', () => {
  const found = catalog([
    element('A', 'Kit', 'Master of the Shield'),
    element('B', 'Kit', 'Plain', { description: '<p>The <i>shield</i> master reads this.</p>' }),
    element('C', 'Kit', 'Shield'),
  ]).search({ text: '  shield   MASTER ' });
  assert.deepEqual(found.rows.map((row) => row.id), ['A', 'B']);
  assert.match(found.rows[1]!.excerpt ?? '', /shield master reads this/);

  // Markup is not text: a word found only in a tag or an attribute matches nothing.
  const markup = catalog([element('D', 'Kit', 'Plain', { description: '<div element="ID_X"><strong>Bold</strong> words</div>' })]);
  assert.equal(markup.search({ text: 'strong' }).count, 0);
  assert.equal(markup.search({ text: 'element' }).count, 0);
  assert.equal(markup.search({ text: 'bold words' }).count, 1);
});

// Perturbation: ignore `descriptions: false`.
test('descriptions can be left out of a search', () => {
  const result = catalog(RANKED).search({ text: 'fire', descriptions: false });
  assert.ok(!result.rows.some((row) => row.matched === 'description'));
  assert.equal(result.count, 5);
});

// Perturbation: list rows when idle; take the group from `selectable`; label by name instead of `plural`.
test('with nothing asked, nothing is listed and every type is counted, browsable first and undeclared last', () => {
  const result = catalog([
    element('K1', 'Kit', 'Rope'),
    element('K2', 'Kit', 'Lamp'),
    element('P1', 'Part', 'Cog'),
    element('G1', 'Gadget', 'Winch'),
    element('X1', 'Oddity', 'Something content made up'),
  ]).search({ text: '' });
  assert.equal(result.idle, true);
  assert.deepEqual(result.rows, []);
  assert.deepEqual(
    result.types.map((type) => [type.type, type.label, type.group, type.count]),
    [
      ['Gadget', 'Gadgets', 'browsable', 1],
      ['Kit', 'Kits', 'browsable', 2],
      ['Part', 'Parts', 'declared', 1],
      ['Oddity', 'Oddity', 'undeclared', 1],
    ],
  );
});

// Perturbation: count types after the type filter; drop a chosen type that has no match.
test('a type narrows the rows, the type counts ignore it, and a chosen type with no match stays listed', () => {
  const elements = [
    element('K1', 'Kit', 'Rope'),
    element('K2', 'Kit', 'Rope ladder'),
    element('G1', 'Gadget', 'Rope winch'),
    element('P1', 'Part', 'Cog'),
  ];
  const result = catalog(elements).search({ text: 'rope', type: 'Kit' });
  assert.deepEqual(result.rows.map((row) => row.id), ['K1', 'K2']);
  assert.deepEqual(
    result.types.map((type) => [type.type, type.count]),
    [
      ['Gadget', 1],
      ['Kit', 2],
    ],
  );
  const none = catalog(elements).search({ text: 'rope', type: 'Part' });
  assert.equal(none.count, 0);
  assert.deepEqual(none.types.find((type) => type.type === 'Part')?.count, 0);

  // A type and no text lists that type, alphabetically, and is not idle.
  const kits = catalog(elements).search({ text: '', type: 'Kit' });
  assert.equal(kits.idle, false);
  assert.deepEqual(kits.rows.map((row) => [row.id, row.matched]), [['K1', undefined], ['K2', undefined]]);
});

// Perturbation: join `source` to the book exactly (case matters); count books after the book filter.
test('books are joined ignoring case, shown as the book spells itself, and a source naming none as written', () => {
  const browse = catalog([
    element('BOOK', 'Book', 'The Book', { source: 'The Book' }),
    element('A', 'Kit', 'Rope', { source: 'the book' }),
    element('B', 'Kit', 'Rope two', { source: 'Internal' }),
    element('C', 'Gadget', 'Rope three', { source: 'The Book' }),
  ]);
  const result = browse.search({ text: 'rope', book: 'the book' });
  assert.deepEqual(result.rows.map((row) => [row.id, row.book]), [
    ['A', 'The Book'],
    ['C', 'The Book'],
  ]);
  assert.deepEqual(
    result.books.map((book) => [book.key, book.name, book.count]),
    [
      ['internal', 'Internal', 1],
      ['the book', 'The Book', 2],
    ],
  );
  // A book and no text lists what the book holds.
  assert.equal(browse.search({ text: '', book: 'internal' }).count, 1);
});

// Perturbation: ignore `limit`; report the page's length as the count.
test('a page is cut at the limit and the count is every match', () => {
  const many = Array.from({ length: 250 }, (_, at) => element(`K${at}`, 'Kit', `Rope ${String(at).padStart(3, '0')}`));
  const first = catalog(many).search({ text: 'rope' });
  assert.equal(first.rows.length, 100);
  assert.equal(first.count, 250);
  assert.equal(first.rows[0]!.name, 'Rope 000');
  assert.equal(catalog(many).search({ text: 'rope', limit: 300 }).rows.length, 250);
});

// Perturbations: follow a select whose filter is an `and`, a `$(…)` or a negation; stop reading the owner's name.
test('an element names the selects that offer it by filtering on exactly one tag it carries', () => {
  const owner = element('OWNER', 'Kit', 'Traveller', {
    rules: [
      { kind: 'select', key: 'select:Motto', type: 'Oddity', name: 'Motto', number: 1, supports: { kind: 'tag', tag: 'OWNER:list:Motto' } },
      {
        kind: 'select',
        key: 'select:Both',
        type: 'Kit',
        name: 'Both',
        number: 1,
        supports: { kind: 'and', children: [{ kind: 'tag', tag: 'Shared' }, { kind: 'tag', tag: 'Other' }] },
      },
      { kind: 'select', key: 'select:Listed', type: 'Kit', name: 'Listed', number: 1, supports: { kind: 'tag', tag: '$(list)' } },
      { kind: 'select', key: 'select:Not', type: 'Kit', name: 'Not', number: 1, supports: { kind: 'tag', tag: '!Shared' } },
    ],
  });
  const other = element('SECOND', 'Gadget', 'Workshop', {
    rules: [{ kind: 'select', key: 'select:Pick', type: 'Kit', name: 'Pick', number: 1, supports: { kind: 'tag', tag: 'shared' } }],
  });
  const item = element('OWNER/list:Motto/1', 'Oddity', 'Never twice the same road.', { supports: ['OWNER:list:Motto'] });
  const kit = element('ROPE', 'Kit', 'Rope', { supports: ['Shared', 'Other', '$(list)'] });
  const browse = catalog([owner, other, item, kit]);

  assert.deepEqual(browse.describe(item.id)?.offeredBy, [{ ownerId: 'OWNER', ownerName: 'Traveller', select: 'Motto' }]);
  assert.deepEqual(browse.describe(kit.id)?.offeredBy, [{ ownerId: 'SECOND', ownerName: 'Workshop', select: 'Pick' }]);
  assert.equal(browse.describe('NOTHING'), undefined);
});

// Perturbation: report the source string instead of the book; drop the file.
test('the detail says the type, the book and where the element was loaded from', () => {
  const browse = catalog([
    element('BOOK', 'Book', 'The Book'),
    element('A', 'Part', 'Cog', { source: 'THE BOOK' }),
    element('G', 'Oddity', 'Made at load', { origin: { sourceId: 'generated', format: 'aurora' } }),
  ]);
  const detail = browse.describe('A')!;
  assert.deepEqual(
    [detail.typeLabel, detail.group, detail.book, detail.sourceId, detail.fileUrl],
    ['Parts', 'declared', 'The Book', 'one', 'https://host/content/one/things.xml'],
  );
  const generated = browse.describe('G')!;
  assert.equal(generated.group, 'undeclared');
  assert.equal(generated.fileUrl, undefined);
});

/** An index whose `all()` hands out the very array its type list is, as a native store might. */
class SharedArrayIndex implements ElementIndex {
  readonly list: Element[];
  constructor(list: Element[]) {
    this.list = list;
  }
  get(id: string): Element | undefined {
    return this.list.find((element) => element.id === id);
  }
  all(): Iterable<Element> {
    return this.list;
  }
  byType(type: ElementType): Element[] {
    return type === 'Kit' ? this.list : [];
  }
  bySupport(): Element[] {
    return [];
  }
}

// Perturbation: sort `index.all()` itself rather than a copy of it.
test('building and searching never reorders what the index hands the builder', () => {
  const list = [element('Z', 'Kit', 'Zither'), element('A', 'Kit', 'Anvil'), element('M', 'Kit', 'Mallet')];
  const index = new SharedArrayIndex(list);
  const before = index.byType('Kit').map((kit) => kit.id);
  const browse = new ContentCatalog(index, SYSTEM);
  browse.search({ text: 'a' });
  browse.search({ text: '', type: 'Kit' });
  browse.describe('Z');
  assert.deepEqual(index.byType('Kit').map((kit) => kit.id), before);
  assert.deepEqual(browse.search({ text: '', type: 'Kit' }).rows.map((row) => row.id), ['A', 'M', 'Z']);
});

// Perturbations: build a new catalog on every call; reuse the last catalog built, whatever its index.
test('one catalog per index, and a new index gets a new one', () => {
  const first = new MapElementIndex();
  first.add(element('A', 'Kit', 'Rope'));
  const second = new MapElementIndex();
  second.add(element('B', 'Kit', 'Lamp'));
  assert.equal(contentCatalog(first, SYSTEM), contentCatalog(first, SYSTEM));
  assert.notEqual(contentCatalog(first, SYSTEM), contentCatalog(second, SYSTEM));
  assert.equal(contentCatalog(second, SYSTEM).search({ text: 'lamp' }).count, 1);
});

// Perturbations: drop the entity decoding; replace a tag with nothing instead of a space.
test('a description as plain text has no tags, decoded entities and single spaces', () => {
  assert.equal(
    descriptionText('<p>Rope&nbsp;&amp;&#32;lamp</p><p>and<br/>winch &#x2014; &bogus;</p>'),
    'Rope & lamp and winch — &bogus;',
  );
});

// Perturbation: cut from the start of the text instead of around the word.
test('an excerpt is cut around the first word found, marked where it was cut', () => {
  const text = `${'a'.repeat(200)} the winch turns ${'b'.repeat(200)}`;
  const cut = excerpt(text, ['winch']);
  assert.ok(cut.startsWith('…') && cut.endsWith('…'), cut);
  assert.match(cut, /the winch turns/);
  assert.equal(excerpt('short text', ['absent']), 'short text');
});

// Perturbation: always return the whole address; strip a prefix that is not the index's folder.
test('a file is shown as a path within its source when it sits under the index', () => {
  assert.equal(fileWithinSource('https://host/repo/core/spells.xml', 'https://host/repo/top.index'), 'core/spells.xml');
  assert.equal(fileWithinSource('https://elsewhere/spells.xml', 'https://host/repo/top.index'), 'https://elsewhere/spells.xml');
  assert.equal(fileWithinSource('C:\\corpus\\core\\a.xml', 'C:\\corpus\\top.index'), 'core\\a.xml');
  assert.equal(fileWithinSource('https://host/a.xml', undefined), 'https://host/a.xml');
});
